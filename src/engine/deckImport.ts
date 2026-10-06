export type ParsedDeckCard = {
  quantity: number
  name: string
  /** Empty when the line named no printing (a bare "1 Counterspell") — the card is then looked up
   *  by name and Scryfall picks the printing. `collectorNumber` can be empty on its own too, for a
   *  line that gives a set but no number. */
  set: string
  collectorNumber: string
  /** First non-special tag on the line (e.g. "Ramp", "Burn") — used as this app's card category. */
  category?: string
  isCommander: boolean
  /** True for Archidekt's built-in "Maybeboard" category, any category named "Sideboard", or any
   *  category (built-in or custom) Archidekt marks excluded from the deck count (`{noDeck}` in the
   *  plain-text export, `includedInDeck: false` in the API) — these cards aren't actually in the
   *  100/60, so they land in the sideboard instead of the mainboard. */
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
//
// Everything but the name is optional, so the plainer list formats other tools export parse too:
// "1 Command Tower (cmm) 380" (no `x`), "1x Counterspell" (no printing), a bare "Counterspell"
// (one copy), and any finish marker in the `*F*` position (`*E*` for etched). A line that names
// no printing is looked up by name instead — see cardIdentifierFor below. This matters because a
// line that fails to match here used to be dropped without a word: it never reached the import's
// "couldn't find" list, so the deck just came out short.
const LINE_PATTERN =
  /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([a-zA-Z0-9]+)\)(?:\s+((?![*[^])\S+))?)?(?:\s+\*[A-Za-z]+\*)*(?:\s+\[(.+)\])?(?:\s+\^[^^]*\^)?$/

// Section headers the plain list formats use in place of per-line tags ("Sideboard", "Commander:",
// Arena's "Deck"). A header applies to every line after it until the next one.
type Section = 'main' | 'commander' | 'sideboard' | 'ignored'
const SECTION_HEADERS: Record<string, Section> = {
  deck: 'main',
  main: 'main',
  mainboard: 'main',
  maindeck: 'main',
  commander: 'commander',
  commanders: 'commander',
  sideboard: 'sideboard',
  maybeboard: 'sideboard',
  companion: 'sideboard',
  // Arena/Moxfield exports open with "About" then "Name <deck name>" — not cards.
  about: 'ignored',
}

function parseSectionHeader(line: string): Section | undefined {
  return SECTION_HEADERS[line.replace(/:$/, '').trim().toLowerCase()]
}

type ParsedTag = { name: string; excludedFromDeck: boolean }

// Archidekt's own site excludes these category names from a deck's size/legality count even when
// the category's own `includedInDeck` flag reads true — confirmed against a real deck (a plain
// user-created "Sideboard" category defaulted to `includedInDeck: true`, since Archidekt only
// flips that flag automatically for its own built-in "Maybeboard", yet the site's displayed
// "Deck size" still excluded the Sideboard cards). Users name a category "Sideboard" expecting it
// to behave like one without ever touching the deck-inclusion toggle, so this app has to special-
// case the name too, not just the flag, to land those cards in the sideboard instead of mainboard.
const EXCLUDED_CATEGORY_NAMES = new Set(['maybeboard', 'sideboard'])

function isExcludedCategoryName(name: string): boolean {
  return EXCLUDED_CATEGORY_NAMES.has(name.toLowerCase())
}

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
    (data.categories ?? [])
      .filter((c) => c.name && (c.includedInDeck === false || isExcludedCategoryName(c.name)))
      .map((c) => c.name as string),
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

/**
 * Parses a plain-text decklist: Archidekt's export format, plus the simpler "1 Card Name" and
 * "1 Card Name (SET) 123" lists other tools produce. Every non-blank line that isn't a section
 * header or a comment becomes an entry — one that can't be resolved shows up in the import's
 * "couldn't find" list rather than vanishing.
 */
export function parseArchidektExport(text: string): ParsedDeckCard[] {
  const results: ParsedDeckCard[] = []
  let section: Section = 'main'

  // A pasted file can start with a byte-order mark, which would otherwise glue itself to the
  // first card's quantity and stop that line matching.
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      // "About" covers only the header block at the top of the file; the blank line after it
      // is where the cards start.
      if (section === 'ignored') section = 'main'
      continue
    }
    if (line.startsWith('//') || line.startsWith('#')) continue

    const header = parseSectionHeader(line)
    if (header) {
      section = header
      continue
    }
    if (section === 'ignored') continue

    const match = line.match(LINE_PATTERN)
    if (!match) continue

    const [, quantity, name, set, collectorNumber, tagsRaw] = match
    const tags = parseTags(tagsRaw)
    const isCommander = section === 'commander' || tags.some((tag) => tag.name === 'Commander')
    const isMaybeboard = section === 'sideboard' || tags.some((tag) => tag.excludedFromDeck || isExcludedCategoryName(tag.name))
    const category = tags.find((tag) => tag.name !== 'Commander' && !isExcludedCategoryName(tag.name))?.name

    results.push({
      quantity: quantity ? Math.max(1, Number(quantity)) : 1,
      name,
      set: (set ?? '').toLowerCase(),
      collectorNumber: collectorNumber ?? '',
      category,
      isCommander,
      isMaybeboard,
      sourceLine: line,
    })
  }

  return results
}

/** The Scryfall `/cards/collection` identifier for a parsed entry: the exact printing when the
 *  line gave one, otherwise the card's name (optionally narrowed to a set). */
export function cardIdentifierFor(entry: ParsedDeckCard): { set: string; collector_number: string } | { name: string; set?: string } {
  if (entry.set && entry.collectorNumber) return { set: entry.set, collector_number: entry.collectorNumber }
  return entry.set ? { name: entry.name, set: entry.set } : { name: entry.name }
}

/** Minimal shape needed to correlate a resolved Scryfall card back to the ParsedDeckCard entry
 *  that requested it — just the printing identity, not the full ScryfallCard type (which lives in
 *  api/scryfallTypes.ts; this module stays free of any actual API dependency). */
export type ResolvedPrinting = { set?: string; collector_number?: string; name?: string }

function printingKey(set: string, collectorNumber: string): string {
  return `${set.toLowerCase()}::${collectorNumber}`
}

/** Case- and accent-insensitive, so a list typed without diacritics ("Lim-Dul's Vault") still
 *  matches the card Scryfall returned for it. */
function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
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
 *
 * An entry that named no printing (see cardIdentifierFor) has nothing but its name to go on, so
 * those — and only those — are matched by name, against either the full name or the front face
 * (a double-faced card listed as "Delver of Secrets" comes back as "Delver of Secrets // Insectile
 * Aberration").
 */
export function matchParsedCards<T extends ResolvedPrinting>(
  parsed: ParsedDeckCard[],
  resolved: T[],
): { matches: { parsed: ParsedDeckCard; card: T }[]; missing: ParsedDeckCard[] } {
  const byIdentifier = new Map(resolved.map((card) => [printingKey(card.set ?? '', card.collector_number ?? ''), card]))
  const byName = new Map<string, T[]>()
  for (const card of resolved) {
    if (!card.name) continue
    for (const key of new Set([nameKey(card.name), nameKey(card.name.split(' // ')[0])])) {
      byName.set(key, [...(byName.get(key) ?? []), card])
    }
  }

  const missing: ParsedDeckCard[] = []
  const matches: { parsed: ParsedDeckCard; card: T }[] = []
  for (const entry of parsed) {
    let card: T | undefined
    if (entry.set && entry.collectorNumber) {
      card = byIdentifier.get(printingKey(entry.set, entry.collectorNumber))
    } else {
      const candidates = byName.get(nameKey(entry.name)) ?? []
      card = (entry.set ? candidates.find((c) => c.set?.toLowerCase() === entry.set) : undefined) ?? candidates[0]
    }
    if (card) matches.push({ parsed: entry, card })
    else missing.push(entry)
  }
  return { matches, missing }
}
