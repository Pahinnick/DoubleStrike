import type { Color } from './colors'

export const FORMATS = [
  'standard',
  'pioneer',
  'modern',
  'legacy',
  'vintage',
  'commander',
  'pauper',
  'brawl',
  'alchemy',
  'historic',
  'penny',
] as const

export type Format = (typeof FORMATS)[number]

/** Matches Scryfall's own comparator vocabulary so query clauses read exactly like scryfall.com/advanced. */
export type NumericComparator = '=' | '!=' | '<' | '<=' | '>' | '>='

export const NUMERIC_COMPARATORS: { value: NumericComparator; label: string }[] = [
  { value: '=', label: '=' },
  { value: '!=', label: '≠' },
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
]

/** Scryfall's three color/identity match modes: exactly these, at least these, at most these. */
export type ColorMatch = '=' | '>=' | '<='

export const RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const
export type Rarity = (typeof RARITIES)[number]

/**
 * Sort options exposed in the UI. Every value except "type" maps directly to one of Scryfall's
 * `order` values for /cards/search (a curated subset of the full list, matching what
 * scryfall.com's own sort dropdown offers). Scryfall has no server-side "sort by type" — `type`
 * is a client-side-only sort applied to fetched results in useCardSearch.ts.
 */
export const SORT_ORDERS = [
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
  { value: 'cmc', label: 'Mana value' },
  { value: 'power', label: 'Power' },
  { value: 'toughness', label: 'Toughness' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'color', label: 'Color' },
  { value: 'released', label: 'Release date' },
  { value: 'edhrec', label: 'EDHREC rank' },
] as const
export type SortOrder = (typeof SORT_ORDERS)[number]['value']

export type SearchFilters = {
  format?: Format
  colors: Color[]
  colorMatch: ColorMatch
  colorIdentity: Color[]
  colorIdentityMatch: ColorMatch
  /** Type-line words (e.g. ["Legendary", "Creature"]) — each becomes its own `t:` clause (see
   *  buildScryfallQuery) so a card must match all of them, not just contain the words somewhere. */
  types: string[]
  /** Free text searched against a card's oracle/rules text (Scryfall's `o:` clause) — deliberately
   *  separate from the main name/text search box up top, which despite its label only ever
   *  matches a card's *name*: Scryfall's default unprefixed search does not look at rules text at
   *  all (confirmed against the live API — a bare `flying` query returns the ~10 cards actually
   *  named that, not the thousands of creatures with the flying keyword). This is the only way to
   *  find "cards that say X", e.g. keywords, reminder text, or a specific triggered ability. */
  cardText: string
  cmcComparator?: NumericComparator
  cmcValue?: number
  powerComparator?: NumericComparator
  powerValue?: number
  toughnessComparator?: NumericComparator
  toughnessValue?: number
  loyaltyComparator?: NumericComparator
  loyaltyValue?: number
  rarity?: Rarity
  set: string
  sort?: SortOrder
}

export const EMPTY_FILTERS: SearchFilters = {
  colors: [],
  // "At most these" is the deck-building default: with colors (or color identity) selected it
  // means "castable with just these colors" (colorless included), which is what filtering while
  // building a deck wants.
  colorMatch: '<=',
  colorIdentity: [],
  colorIdentityMatch: '<=',
  types: [],
  cardText: '',
  set: '',
}

/** Builds a Scryfall search query string from free text plus structured filters. */
export function buildScryfallQuery(text: string, filters: SearchFilters): string {
  const clauses: string[] = []
  const trimmedText = text.trim()
  if (trimmedText.length > 0) clauses.push(trimmedText)
  if (filters.format) clauses.push(`f:${filters.format}`)
  if (filters.colors.length > 0) clauses.push(`c${filters.colorMatch}${filters.colors.join('')}`)
  if (filters.colorIdentity.length > 0) clauses.push(`id${filters.colorIdentityMatch}${filters.colorIdentity.join('')}`)
  // Each type gets its own t: clause rather than one clause with all the words in it — Scryfall's
  // query parser splits on whitespace outside quotes, so a single unquoted `t:legendary creature`
  // clause silently turned into a `t:legendary` type filter plus a bare `creature` text search
  // (matching name/oracle text too, not just the type line). Quoting only the multi-word entries
  // (a handful of subtypes, e.g. "Time Lord") keeps single-word clauses readable.
  for (const type of filters.types) {
    const word = type.trim()
    if (word.length === 0) continue
    clauses.push(`t:${word.includes(' ') ? `"${word}"` : word}`)
  }
  if (filters.cardText.trim().length > 0) {
    // Always quoted, even for a single word — quoting a lone word is a no-op in Scryfall's syntax,
    // but for a phrase it's what makes "when this creature enters" one required substring instead
    // of several independently-required bare words (each of which, unprefixed, would search names
    // again — the exact bug already fixed for multi-word types, see the `types` loop above).
    // Stripped quotes guard against the user's own input breaking out of the wrapping quotes.
    clauses.push(`o:"${filters.cardText.trim().replace(/"/g, '')}"`)
  }
  if (filters.cmcValue !== undefined) clauses.push(`cmc${filters.cmcComparator ?? '='}${filters.cmcValue}`)
  if (filters.powerValue !== undefined) clauses.push(`pow${filters.powerComparator ?? '='}${filters.powerValue}`)
  if (filters.toughnessValue !== undefined) clauses.push(`tou${filters.toughnessComparator ?? '='}${filters.toughnessValue}`)
  if (filters.loyaltyValue !== undefined) clauses.push(`loy${filters.loyaltyComparator ?? '='}${filters.loyaltyValue}`)
  if (filters.rarity) clauses.push(`r:${filters.rarity}`)
  if (filters.set.trim().length > 0) clauses.push(`s:${filters.set.trim()}`)
  return clauses.join(' ')
}
