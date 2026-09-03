import { describe, expect, it } from 'vitest'
import {
  buildScryfallQuery,
  EMPTY_FILTERS,
  formatPriceCap,
  nearestPriceCapIndex,
  PRICE_CAP_STEPS,
  type SearchFilters,
} from './scryfallQuery'

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

const filters = (overrides: Partial<SearchFilters> = {}): SearchFilters => ({ ...EMPTY_FILTERS, ...overrides })

describe('buildScryfallQuery price cap', () => {
  it('adds a usd<= clause for a cap', () => {
    expect(buildScryfallQuery('bolt', filters({ maxUsd: 5 }))).toBe('bolt usd<=5')
  })

  it('adds nothing when uncapped', () => {
    expect(buildScryfallQuery('bolt', filters())).toBe('bolt')
  })

  it('keeps a sub-dollar cap intact rather than rounding it away', () => {
    expect(buildScryfallQuery('', filters({ maxUsd: 0.25 }))).toBe('usd<=0.25')
  })

  it('treats a zero cap as a real cap, not as "no cap"', () => {
    // `undefined` is the only "uncapped" value — a falsy-check here would silently drop the clause.
    expect(buildScryfallQuery('', filters({ maxUsd: 0 }))).toBe('usd<=0')
  })

  it('combines with the other clauses', () => {
    const query = buildScryfallQuery('', filters({ format: 'commander', types: ['Creature'], maxUsd: 2 }))
    expect(query).toBe('f:commander t:Creature usd<=2')
  })
})

describe('PRICE_CAP_STEPS', () => {
  it('ends at an uncapped stop, which is the default position', () => {
    expect(PRICE_CAP_STEPS[PRICE_CAP_STEPS.length - 1]).toBeUndefined()
  })

  it('is strictly ascending, so the slider reads left-to-right as cheap-to-expensive', () => {
    const caps = PRICE_CAP_STEPS.slice(0, -1) as number[]
    expect(caps.every((cap, i) => i === 0 || cap > caps[i - 1])).toBe(true)
  })

  it('has exactly one uncapped stop', () => {
    expect(PRICE_CAP_STEPS.filter((cap) => cap === undefined)).toHaveLength(1)
  })
})

describe('formatPriceCap', () => {
  it('labels the uncapped stop', () => {
    expect(formatPriceCap(undefined)).toBe('Any')
  })

  it('shows cents below a dollar and whole dollars above', () => {
    expect(formatPriceCap(0.25)).toBe('$0.25')
    expect(formatPriceCap(0.5)).toBe('$0.50')
    expect(formatPriceCap(5)).toBe('$5')
    expect(formatPriceCap(100)).toBe('$100')
  })
})

describe('nearestPriceCapIndex', () => {
  const capAt = (index: number) => PRICE_CAP_STEPS[index]

  it('parks an uncapped filter at the far end', () => {
    expect(nearestPriceCapIndex(undefined)).toBe(PRICE_CAP_STEPS.length - 1)
  })

  it('lands exactly on a value that is one of the steps', () => {
    expect(capAt(nearestPriceCapIndex(5))).toBe(5)
    expect(capAt(nearestPriceCapIndex(0.25))).toBe(0.25)
  })

  it('snaps a typed value that is not a step to the closest one', () => {
    // $7 sits between the $5 and $10 stops, nearer $5.
    expect(capAt(nearestPriceCapIndex(7))).toBe(5)
    expect(capAt(nearestPriceCapIndex(9))).toBe(10)
  })

  it('breaks a tie toward the cheaper step', () => {
    // $7.50 is equidistant from $5 and $10; presenting it as the pricier stop would overstate it.
    expect(capAt(nearestPriceCapIndex(7.5))).toBe(5)
  })

  it('clamps beyond either end rather than falling off', () => {
    expect(capAt(nearestPriceCapIndex(0))).toBe(0.25)
    expect(capAt(nearestPriceCapIndex(9999))).toBe(100)
  })

  it('never returns the uncapped index for a real cap, which would read as "Any"', () => {
    for (const cap of [0, 0.3, 7, 250, 9999]) {
      expect(nearestPriceCapIndex(cap)).not.toBe(PRICE_CAP_STEPS.length - 1)
    }
  })
})
