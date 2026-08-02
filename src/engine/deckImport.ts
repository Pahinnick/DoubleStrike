export type ParsedDeckCard = {
  quantity: number
  name: string
  set: string
  collectorNumber: string
  /** First non-special tag on the line (e.g. "Ramp", "Burn") — used as this app's card category. */
  category?: string
  isCommander: boolean
  /** True for Archidekt's built-in "Maybeboard" category or any category (built-in or custom)
   *  Archidekt marks excluded from the deck count (`{noDeck}` in the plain-text export,
   *  `includedInDeck: false` in the API) — these cards aren't actually in the 100/60, so they
   *  land in the sideboard instead of the mainboard. */
  isMaybeboard: boolean
  /** The literal text line this entry was parsed from — only set by the plain-text export parser
   *  (parseArchidektExport); undefined for JSON/API imports, which have no raw text line to show.
   *  Surfaced in ImportDeckModal next to a failed entry's suggestions so it's easy to see exactly
   *  what didn't match (e.g. a typo'd set code or collector number). */
  sourceLine?: string
}

// Matches Archidekt's plain-text export: "1x Card Name (set) 123 *F* [Tag1,Tag2{sub}] ^Label,#rrggbb^"
// The foil indicator (`*F*`, on by default whenever any card in the export owns a foil printing)
// and the trailing color-tag label (`^...^`, on whenever a card has an Archidekt color tag set) are
// both optional and ignored — this app has no foil/color-tag concept, but a line carrying either
// has to still match or the whole card silently disappears from the import (see deckImport.test.ts).
const LINE_PATTERN = /^(\d+)x\s+(.+?)\s+\(([a-zA-Z0-9]+)\)\s+(\S+)(?:\s+\*F\*)?(?:\s+\[(.+)\])?(?:\s+\^[^^]*\^)?$/

type ParsedTag = { name: string; excludedFromDeck: boolean }

// Archidekt marks a category "not part of the 100/60" by suffixing every card line's tag with
// `{noDeck}` (alongside its own built-in "Maybeboard" category, which always carries the same
// marker) — a custom category name like "Chaseboard{noDeck}{noPrice}" is just as excluded as the
// literal "Maybeboard" tag, so both need to flag isMaybeboard, not just the literal name.
function parseTag(tag: string): ParsedTag {
  const excludedFromDeck = /\{noDeck\}/.test(tag)
  return { name: tag.replace(/\{[^}]*\}/g, '').trim(), excludedFromDeck }
}

function parseTags(raw: string | undefined): ParsedTag[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((tag) => parseTag(tag))
    .filter((tag) => tag.name.length > 0)
}

/**
 * Extracts the numeric deck id from an Archidekt deck URL (or accepts a bare id). Handles
 * `archidekt.com/decks/19263728/slug`, `.../decks/19263728`, the `/api/decks/19263728/`
 * form, and a plain `19263728`. Returns null if no id is found.
 */
export function parseArchidektDeckId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed
  const match = trimmed.match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/i)
  return match ? match[1] : null
}

// Minimal shape of the fields we read from Archidekt's `/api/decks/{id}/` response. The real
// payload is far larger; everything else is ignored.
type ArchidektDeckResponse = {
  name?: string
  categories?: { name?: string; includedInDeck?: boolean }[] | null
  cards?: {
    quantity?: number
    categories?: string[] | null
    card?: {
      collectorNumber?: string
      oracleCard?: { name?: string } | null
      edition?: { editioncode?: string } | null
    } | null
  }[] | null
}

/**
 * Transforms Archidekt's deck API JSON into the same ParsedDeckCard[] the plain-text export
 * parser produces, so both import paths feed one pipeline. Cards in any category Archidekt marks
 * `includedInDeck: false` (the built-in "Maybeboard" and any custom exclusion categories) are
 * flagged as maybeboard; the card's own `category` is the first tag that isn't Commander or an
 * excluded one. Entries missing a name/set/collector number are skipped rather than throwing.
 */
export function parseArchidektDeckJson(data: ArchidektDeckResponse): { name?: string; cards: ParsedDeckCard[] } {
  const excludedCategories = new Set(
    (data.categories ?? []).filter((c) => c.includedInDeck === false && c.name).map((c) => c.name as string),
  )

  const cards: ParsedDeckCard[] = []
  for (const entry of data.cards ?? []) {
    const name = entry.card?.oracleCard?.name
    const set = entry.card?.edition?.editioncode
    const collectorNumber = entry.card?.collectorNumber
    if (!name || !set || !collectorNumber) continue

    const tags = entry.categories ?? []
    const isCommander = tags.includes('Commander')
    const isMaybeboard = tags.some((tag) => excludedCategories.has(tag))
    const category = tags.find((tag) => tag !== 'Commander' && !excludedCategories.has(tag))

    cards.push({
      quantity: entry.quantity && entry.quantity > 0 ? entry.quantity : 1,
      name,
      set: set.toLowerCase(),
      collectorNumber,
      category,
      isCommander,
      isMaybeboard,
    })
  }

  return { name: data.name, cards }
}

/** Parses Archidekt's plain-text decklist export format. Unparseable lines are skipped rather than throwing. */
export function parseArchidektExport(text: string): ParsedDeckCard[] {
  const results: ParsedDeckCard[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const match = line.match(LINE_PATTERN)
    if (!match) continue

    const [, quantity, name, set, collectorNumber, tagsRaw] = match
    const tags = parseTags(tagsRaw)
    const isCommander = tags.some((tag) => tag.name === 'Commander')
    const isMaybeboard = tags.some((tag) => tag.name === 'Maybeboard' || tag.excludedFromDeck)
    const category = tags.find((tag) => tag.name !== 'Commander' && tag.name !== 'Maybeboard')?.name

    results.push({
      quantity: Number(quantity),
      name,
      set: set.toLowerCase(),
      collectorNumber,
      category,
      isCommander,
      isMaybeboard,
      sourceLine: line,
    })
  }

  return results
}

/** Minimal shape needed to correlate a resolved Scryfall card back to the ParsedDeckCard entry
 *  that requested it — just the printing identity, not the full ScryfallCard type (which lives in
 *  api/scryfallTypes.ts; this module stays free of any actual API dependency). */
export type ResolvedPrinting = { set?: string; collector_number?: string }

function printingKey(set: string, collectorNumber: string): string {
  return `${set.toLowerCase()}::${collectorNumber}`
}

/**
 * Correlates Scryfall's `/cards/collection` response back to the ParsedDeckCard entries that
 * requested them, by (set, collector_number) — NOT by card name. Scryfall's collection endpoint
 * doesn't guarantee positional alignment with the request array once unresolvable identifiers are
 * dropped, so *some* correlation is unavoidable — but naming was the wrong key: a deck running two
 * different printings/arts of the same card (e.g. two different Plains prints) would collapse both
 * ParsedDeckCard entries onto whichever one Scryfall's card object happened to occupy in a
 * name-keyed lookup, silently dropping the other printing's copies entirely (see the "Total lands"-
 * adjacent report: a 12-Plains deck split across two prints imported as just 6).
 */
export function matchParsedCards<T extends ResolvedPrinting>(
  parsed: ParsedDeckCard[],
  resolved: T[],
): { matches: { parsed: ParsedDeckCard; card: T }[]; missing: ParsedDeckCard[] } {
  const byIdentifier = new Map(resolved.map((card) => [printingKey(card.set ?? '', card.collector_number ?? ''), card]))
  const missing: ParsedDeckCard[] = []
  const matches: { parsed: ParsedDeckCard; card: T }[] = []
  for (const entry of parsed) {
    const card = byIdentifier.get(printingKey(entry.set, entry.collectorNumber))
    if (card) matches.push({ parsed: entry, card })
    else missing.push(entry)
  }
  return { matches, missing }
}
