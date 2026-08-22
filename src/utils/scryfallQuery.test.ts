import { describe, expect, it } from 'vitest'
import { buildScryfallQuery, EMPTY_FILTERS } from './scryfallQuery'

describe('buildScryfallQuery', () => {
  it('returns just the text when no filters are set', () => {
    expect(buildScryfallQuery('bolt', EMPTY_FILTERS)).toBe('bolt')
  })

  it('returns an empty string when nothing is provided', () => {
    expect(buildScryfallQuery('', EMPTY_FILTERS)).toBe('')
  })

  it('combines text, format, colors, type, and mana value', () => {
    const query = buildScryfallQuery('dragon', {
      ...EMPTY_FILTERS,
      format: 'modern',
      colors: ['U', 'R'],
      types: ['creature'],
      cmcComparator: '>=',
      cmcValue: 2,
    })
    expect(query).toBe('dragon f:modern c<=UR t:creature cmc>=2')
  })

  it('gives each selected type its own t: clause, so a card must match all of them', () => {
    const query = buildScryfallQuery('', { ...EMPTY_FILTERS, types: ['Legendary', 'Creature'] })
    expect(query).toBe('t:Legendary t:Creature')
  })

  it('quotes a multi-word type so it stays one clause instead of splitting into a bare text search', () => {
    const query = buildScryfallQuery('', { ...EMPTY_FILTERS, types: ['Time Lord'] })
    expect(query).toBe('t:"Time Lord"')
  })

  it('quotes a card-text search into an o: clause, even a single word', () => {
    expect(buildScryfallQuery('', { ...EMPTY_FILTERS, cardText: 'flying' })).toBe('o:"flying"')
  })

  it('keeps a card-text phrase as one clause instead of splitting on whitespace', () => {
    const query = buildScryfallQuery('', { ...EMPTY_FILTERS, cardText: 'draw a card' })
    expect(query).toBe('o:"draw a card"')
  })

  it('strips stray quotes out of a card-text search so they cannot break out of the wrapping quotes', () => {
    const query = buildScryfallQuery('', { ...EMPTY_FILTERS, cardText: '"draw a card"' })
    expect(query).toBe('o:"draw a card"')
  })

  it('omits clauses for unset filter fields', () => {
    const query = buildScryfallQuery('', { ...EMPTY_FILTERS, format: 'commander' })
    expect(query).toBe('f:commander')
  })

  it('defaults the color match to "at most" when unspecified by the caller', () => {
    const query = buildScryfallQuery('', { ...EMPTY_FILTERS, colors: ['W'] })
    expect(query).toBe('c<=W')
  })

  it('supports exact and at-least color match modes', () => {
    expect(buildScryfallQuery('', { ...EMPTY_FILTERS, colors: ['W'], colorMatch: '=' })).toBe('c=W')
    expect(buildScryfallQuery('', { ...EMPTY_FILTERS, colors: ['W'], colorMatch: '>=' })).toBe('c>=W')
  })

  it('builds a color identity clause, independent of the colors clause', () => {
    const query = buildScryfallQuery('', {
      ...EMPTY_FILTERS,
      colorIdentity: ['U', 'B'],
      colorIdentityMatch: '<=',
    })
    expect(query).toBe('id<=UB')
  })

  it('builds power, toughness, and loyalty comparator clauses', () => {
    const query = buildScryfallQuery('', {
      ...EMPTY_FILTERS,
      powerComparator: '>=',
      powerValue: 4,
      toughnessComparator: '<',
      toughnessValue: 3,
      loyaltyComparator: '=',
      loyaltyValue: 5,
    })
    expect(query).toBe('pow>=4 tou<3 loy=5')
  })

  it('defaults numeric comparators to "=" when only a value is given', () => {
    expect(buildScryfallQuery('', { ...EMPTY_FILTERS, cmcValue: 3 })).toBe('cmc=3')
  })

  it('builds rarity and set clauses', () => {
    const query = buildScryfallQuery('', { ...EMPTY_FILTERS, rarity: 'mythic', set: 'mh3' })
    expect(query).toBe('r:mythic s:mh3')
  })
})
