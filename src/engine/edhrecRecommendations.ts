import { edhrecSlug } from '../api/edhrec'
import type { ScryfallCard } from '../api/scryfallTypes'
import { getCardUsdPrice } from '../utils/price'
import { compareMissingLast } from './similarCardSort'

/** One recommended card from an EDHREC commander page's card lists. */
export type EdhrecCardRec = {
  /** EDHREC's `id` is a Scryfall *card* id (a specific printing), so it resolves directly through
   *  api/scryfall.ts#getCardsByIdentifiers with an `{ id }` identifier — no name matching needed. */
  scryfallId: string
  name: string
  /** Decks running this commander that play this card. */
  numDecks: number
  /** Decks running this commander that legally *could* play it — the denominator for inclusion. */
  potentialDecks: number
  /** EDHREC's own measure of how much more this card shows up with this commander than without.
   *  Can be negative for a card that's popular generally but off-theme here. */
  synergy: number
}

/** One of the page's ranked lists, e.g. "High Synergy Cards" or "Instants". */
export type EdhrecCardList = {
  /** EDHREC's own list key, e.g. "highsynergycards" — stable, unlike the display header. */
  tag: string
  header: string
  cards: EdhrecCardRec[]
}

export type EdhrecCommanderData = {
  lists: EdhrecCardList[]
}

/**
 * EDHREC's slug for a commander, or for a partner/Background pair.
 *
 * A pair's page lives under a single canonical ordering, which is alphabetical by slug — but this
 * is only ever a *candidate*: api/edhrec.ts#fetchEdhrecCommanderPage follows EDHREC's own
 * `redirect` response, so the guess being wrong costs one extra request rather than a dead end.
 */
export function commanderSlugCandidate(names: string[]): string {
  return names
    .map((name) => edhrecSlug(name))
    .filter((slug) => slug.length > 0)
    .sort()
    .join('-')
}

/** Share of decks that could play this card and do — 0 when EDHREC reports no potential decks. */
export function inclusionRate(rec: EdhrecCardRec): number {
  return rec.potentialDecks > 0 ? rec.numDecks / rec.potentialDecks : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseCardRec(raw: unknown): EdhrecCardRec | null {
  if (!isRecord(raw)) return null
  const { id, name, num_decks: numDecks, potential_decks: potentialDecks, synergy } = raw
  // id and name are the only genuinely required fields — a card we can't resolve or label is
  // useless. The three statistics each fall back to 0 so one missing number doesn't drop an
  // otherwise-valid recommendation off the list.
  if (typeof id !== 'string' || id.length === 0) return null
  if (typeof name !== 'string' || name.length === 0) return null
  return {
    scryfallId: id,
    name,
    numDecks: typeof numDecks === 'number' ? numDecks : 0,
    potentialDecks: typeof potentialDecks === 'number' ? potentialDecks : 0,
    synergy: typeof synergy === 'number' ? synergy : 0,
  }
}

/**
 * Pulls the recommendation lists out of a raw EDHREC commander page.
 *
 * Defensive throughout: this is an undocumented endpoint that backs edhrec.com's own pages, so
 * anything unrecognised is skipped rather than thrown on. Returns null when the payload carries no
 * usable list at all, which callers cache as a real "nothing here" answer.
 */
export function parseCommanderPage(payload: unknown): EdhrecCommanderData | null {
  if (!isRecord(payload)) return null
  const container = payload.container
  if (!isRecord(container)) return null
  const jsonDict = container.json_dict
  if (!isRecord(jsonDict)) return null
  const rawLists = jsonDict.cardlists
  if (!Array.isArray(rawLists)) return null

  const lists: EdhrecCardList[] = []
  for (const rawList of rawLists) {
    if (!isRecord(rawList)) continue
    const { tag, header, cardviews } = rawList
    if (typeof tag !== 'string' || !Array.isArray(cardviews)) continue
    const cards = cardviews.map(parseCardRec).filter((rec): rec is EdhrecCardRec => rec !== null)
    if (cards.length === 0) continue
    lists.push({ tag, header: typeof header === 'string' && header.length > 0 ? header : tag, cards })
  }

  return lists.length > 0 ? { lists } : null
}

/**
 * Deck counts from the Top Commanders page, keyed by lowercased card name.
 *
 * Keyed by name rather than by the cardview's `id` because that id is one specific *printing* —
 * fine for the recommendation lists, where it's the card being resolved, but the commander browser
 * matches against whatever printing Scryfall's search returned, which is often a different one.
 * The deck count lives on the oracle card anyway, so the name is the right key (this is the same
 * choice storage/commanderPopularityCache.ts makes).
 */
/** The Top Commanders entries, most-commanded first. EDHREC already returns them in order; sorting
 *  explicitly means the browser's ordering doesn't silently depend on that staying true. */
export function topCommandersRanked(data: EdhrecCommanderData): EdhrecCardRec[] {
  return data.lists
    .flatMap((list) => list.cards)
    .slice()
    .sort((a, b) => b.numDecks - a.numDecks || a.name.localeCompare(b.name))
}

export function topCommanderDeckCounts(commanders: EdhrecCardRec[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const card of commanders) {
    counts.set(card.name.toLowerCase(), card.numDecks)
    // Partner and double-faced entries come through as "Front // Back"; index the front face too
    // so a Scryfall result carrying just the front name still matches.
    const front = card.name.split(' // ')[0].trim().toLowerCase()
    if (front !== card.name.toLowerCase() && !counts.has(front)) counts.set(front, card.numDecks)
  }
  return counts
}

export type EdhrecSort = 'inclusion' | 'synergy' | 'name' | 'cmc' | 'price-asc' | 'price-desc'

/** Sort choices for the recommendations list — order is display order, first is default. */
export const EDHREC_SORT_OPTIONS: { value: EdhrecSort; label: string }[] = [
  { value: 'inclusion', label: 'Most included' },
  { value: 'synergy', label: 'Highest synergy' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'cmc', label: 'Mana value' },
  { value: 'price-asc', label: 'Price (low to high)' },
  { value: 'price-desc', label: 'Price (high to low)' },
]

/** A recommendation paired with the Scryfall card it resolved to. */
export type EdhrecMatch = { rec: EdhrecCardRec; card: ScryfallCard }

/** Returns a new sorted array — never mutates the input, matching sortSimilarMatches. Name is the
 *  tiebreak everywhere so equal-ranked cards land in a stable order. */
export function sortEdhrecMatches<T extends EdhrecMatch>(matches: T[], sort: EdhrecSort): T[] {
  const byName = (a: T, b: T) => a.rec.name.localeCompare(b.rec.name)
  const sorted = [...matches]

  switch (sort) {
    case 'inclusion':
      return sorted.sort((a, b) => inclusionRate(b.rec) - inclusionRate(a.rec) || byName(a, b))
    case 'synergy':
      return sorted.sort((a, b) => b.rec.synergy - a.rec.synergy || byName(a, b))
    case 'name':
      return sorted.sort(byName)
    case 'cmc':
      return sorted.sort((a, b) => a.card.cmc - b.card.cmc || byName(a, b))
    case 'price-asc':
    case 'price-desc':
      return sorted.sort(
        (a, b) => compareMissingLast(getCardUsdPrice(a.card), getCardUsdPrice(b.card), sort === 'price-asc') || byName(a, b),
      )
  }
}
