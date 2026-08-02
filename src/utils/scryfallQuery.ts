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
  type: string
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
  type: '',
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
  if (filters.type.trim().length > 0) clauses.push(`t:${filters.type.trim()}`)
  if (filters.cmcValue !== undefined) clauses.push(`cmc${filters.cmcComparator ?? '='}${filters.cmcValue}`)
  if (filters.powerValue !== undefined) clauses.push(`pow${filters.powerComparator ?? '='}${filters.powerValue}`)
  if (filters.toughnessValue !== undefined) clauses.push(`tou${filters.toughnessComparator ?? '='}${filters.toughnessValue}`)
  if (filters.loyaltyValue !== undefined) clauses.push(`loy${filters.loyaltyComparator ?? '='}${filters.loyaltyValue}`)
  if (filters.rarity) clauses.push(`r:${filters.rarity}`)
  if (filters.set.trim().length > 0) clauses.push(`s:${filters.set.trim()}`)
  return clauses.join(' ')
}
