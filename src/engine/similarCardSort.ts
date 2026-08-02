import type { ScryfallCard } from '../api/scryfallTypes'
import { getCardUsdPrice } from '../utils/price'

export type SimilarSort = 'match' | 'edhrec' | 'name' | 'cmc' | 'price-asc' | 'price-desc'

/** Sort choices for the Similar Cards suggestion list — order is display order, first is default. */
export const SIMILAR_SORT_OPTIONS: { value: SimilarSort; label: string }[] = [
  { value: 'match', label: 'Best match' },
  { value: 'edhrec', label: 'Most played (EDHREC)' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'cmc', label: 'Mana value' },
  { value: 'price-asc', label: 'Price (low to high)' },
  { value: 'price-desc', label: 'Price (high to low)' },
]

export type SortableMatch = { card: ScryfallCard; matchCount: number }

/** Cards missing the value sort last in BOTH directions, rather than being treated as 0. Scryfall
 *  omits `prices.usd` for cards with no listing and `edhrec_rank` for cards EDHREC has no data on;
 *  reading either absence as zero would park those cards at the top of a "cheapest" or
 *  "most played" sort — exactly where they'd be most misleading. Returns 0 when neither side has
 *  the value so the caller's name tiebreak still applies. */
function compareMissingLast(a: number | undefined, b: number | undefined, ascending: boolean): number {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return ascending ? a - b : b - a
}

/** Returns a new sorted array — never mutates the input, since callers pass derived/filtered lists
 *  that React also holds. Name is the tiebreak for every mode so equal-ranked cards land in a
 *  stable, predictable order rather than whatever the tag index happened to emit. */
export function sortSimilarMatches<T extends SortableMatch>(matches: T[], sort: SimilarSort): T[] {
  const byName = (a: T, b: T) => a.card.name.localeCompare(b.card.name)
  const sorted = [...matches]

  switch (sort) {
    case 'match':
      return sorted.sort((a, b) => b.matchCount - a.matchCount || byName(a, b))
    // Ascending, because EDHREC rank 1 is the MOST-played card — "most played first" is the
    // low end of this scale, the opposite of how the price sorts read.
    case 'edhrec':
      return sorted.sort((a, b) => compareMissingLast(a.card.edhrec_rank, b.card.edhrec_rank, true) || byName(a, b))
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
