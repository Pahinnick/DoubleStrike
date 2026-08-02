import { describe, expect, it } from 'vitest'
import type { ScryfallCard } from '../api/scryfallTypes'
import { sortSimilarMatches, type SortableMatch } from './similarCardSort'

function match(name: string, matchCount: number, cmc: number, usd?: string | null, edhrecRank?: number): SortableMatch {
  const card = {
    id: name,
    oracle_id: name,
    name,
    layout: 'normal',
    cmc,
    type_line: 'Instant',
    color_identity: [],
    legalities: {},
    ...(usd === undefined ? {} : { prices: { usd } }),
    ...(edhrecRank === undefined ? {} : { edhrec_rank: edhrecRank }),
  } as ScryfallCard
  return { card, matchCount }
}

const names = (result: SortableMatch[]) => result.map((m) => m.card.name)

describe('sortSimilarMatches', () => {
  it('sorts by descending match count, then name', () => {
    const input = [match('Zed', 2, 0), match('Ada', 5, 0), match('Bob', 2, 0)]
    expect(names(sortSimilarMatches(input, 'match'))).toEqual(['Ada', 'Bob', 'Zed'])
  })

  it('sorts by EDHREC rank ascending, since rank 1 is the most-played card', () => {
    const input = [match('Obscure', 0, 0, null, 29141), match('SolRing', 0, 0, null, 1), match('Bolt', 0, 0, null, 160)]
    expect(names(sortSimilarMatches(input, 'edhrec'))).toEqual(['SolRing', 'Bolt', 'Obscure'])
  })

  it('parks cards with no EDHREC rank last, not first as a rank-0 would', () => {
    const input = [match('Unranked', 0, 0, null), match('SolRing', 0, 0, null, 1), match('Obscure', 0, 0, null, 29141)]
    expect(names(sortSimilarMatches(input, 'edhrec'))).toEqual(['SolRing', 'Obscure', 'Unranked'])
  })

  it('breaks EDHREC ties by name when neither card is ranked', () => {
    const input = [match('Zed', 0, 0, null), match('Ada', 0, 0, null)]
    expect(names(sortSimilarMatches(input, 'edhrec'))).toEqual(['Ada', 'Zed'])
  })

  it('sorts by name', () => {
    const input = [match('Zed', 9, 0), match('Ada', 1, 0)]
    expect(names(sortSimilarMatches(input, 'name'))).toEqual(['Ada', 'Zed'])
  })

  it('sorts by ascending mana value, then name', () => {
    const input = [match('Zed', 0, 1), match('Ada', 0, 6), match('Bob', 0, 1)]
    expect(names(sortSimilarMatches(input, 'cmc'))).toEqual(['Bob', 'Zed', 'Ada'])
  })

  it('sorts by price in both directions', () => {
    const input = [match('Mid', 0, 0, '5.00'), match('Cheap', 0, 0, '0.25'), match('Pricey', 0, 0, '40.00')]
    expect(names(sortSimilarMatches(input, 'price-asc'))).toEqual(['Cheap', 'Mid', 'Pricey'])
    expect(names(sortSimilarMatches(input, 'price-desc'))).toEqual(['Pricey', 'Mid', 'Cheap'])
  })

  it('parks cards with no price last in BOTH price directions', () => {
    const input = [match('NoPrice', 0, 0, null), match('Cheap', 0, 0, '0.25'), match('Pricey', 0, 0, '40.00')]
    expect(names(sortSimilarMatches(input, 'price-asc'))).toEqual(['Cheap', 'Pricey', 'NoPrice'])
    expect(names(sortSimilarMatches(input, 'price-desc'))).toEqual(['Pricey', 'Cheap', 'NoPrice'])
  })

  it('falls back to the foil price when Scryfall lists no non-foil price', () => {
    const foilOnly = match('FoilOnly', 0, 0, null)
    foilOnly.card.prices = { usd: null, usd_foil: '3.00' }
    const input = [foilOnly, match('Cheap', 0, 0, '1.00')]
    expect(names(sortSimilarMatches(input, 'price-asc'))).toEqual(['Cheap', 'FoilOnly'])
  })

  it('breaks ties by name when neither card has a price', () => {
    const input = [match('Zed', 0, 0, null), match('Ada', 0, 0, null)]
    expect(names(sortSimilarMatches(input, 'price-asc'))).toEqual(['Ada', 'Zed'])
  })

  it('does not mutate the input array', () => {
    const input = [match('Zed', 1, 0), match('Ada', 9, 0)]
    const before = names(input)
    sortSimilarMatches(input, 'match')
    expect(names(input)).toEqual(before)
  })
})
