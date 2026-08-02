import { describe, expect, it } from 'vitest'
import { HIGH_CONFIDENCE_THRESHOLD, probCastableByTurn } from './castability'
import { parseManaCost } from './manaCost'
import { averageManaValue, recommendTotalLands, splitLandsByColorNeed } from './manaRecommendation'
import type { ManaBase } from './manaSources'

describe('averageManaValue', () => {
  it('is 0 for an empty deck', () => {
    expect(averageManaValue([])).toBe(0)
  })

  it('weights by quantity', () => {
    // Three copies of a 1-drop, one copy of a 5-drop: (3*1 + 1*5) / 4 = 2
    expect(averageManaValue([{ cmc: 1, quantity: 3 }, { cmc: 5, quantity: 1 }])).toBeCloseTo(2, 10)
  })
})

describe('recommendTotalLands', () => {
  it('recommends more lands for a higher average mana value', () => {
    const low = recommendTotalLands(2, 100)
    const high = recommendTotalLands(4, 100)
    expect(high).toBeGreaterThan(low)
  })

  it('the recommendation actually clears the confidence threshold at that average mana value', () => {
    const deckSize = 100
    const avgCmc = 3
    const lands = recommendTotalLands(avgCmc, deckSize)
    const req = parseManaCost('{3}')
    const manaBase: ManaBase = { totalLands: lands, lands: [{ quantity: lands, colors: [] }], exact: true }
    expect(probCastableByTurn(req, manaBase, deckSize, avgCmc, true)).toBeGreaterThanOrEqual(HIGH_CONFIDENCE_THRESHOLD)
  })

  it('recommends fewer additional lands when the deck already runs ramp', () => {
    const deckSize = 100
    const withoutRamp = recommendTotalLands(3, deckSize)
    const withRamp = recommendTotalLands(3, deckSize, [{ quantity: 8, colors: [] }])
    expect(withRamp).toBeLessThan(withoutRamp)
  })
})

describe('splitLandsByColorNeed', () => {
  it('returns empty when there are no colored pips', () => {
    expect(splitLandsByColorNeed(38, {})).toEqual({})
  })

  it('gives everything to a mono-colored deck', () => {
    expect(splitLandsByColorNeed(24, { G: 30 })).toEqual({ G: 24 })
  })

  it('splits proportionally to pip counts', () => {
    expect(splitLandsByColorNeed(30, { U: 20, G: 10 })).toEqual({ U: 20, G: 10 })
  })

  it('rounds each color independently', () => {
    // 5 lands over 2:1 pips → exact shares 3.33/1.67 → round to 3/2 independently.
    expect(splitLandsByColorNeed(5, { U: 2, G: 1 })).toEqual({ U: 3, G: 2 })
  })

  it('deliberately allows per-color targets to sum to more than totalLands — a dual land can cover two colors\' targets at once, so this is a source-count target per color, not a disjoint-slot count', () => {
    // Even 50/50 split of 3 lands: each color independently wants ~1.5 → rounds to 2, summing to
    // 4 > 3. Real coverage: 3 WU duals alone would give both colors a source count of 3, clearing
    // both targets — nobody needs 4 physical lands just because two colors each "want" 2.
    const split = splitLandsByColorNeed(3, { W: 1, U: 1 })
    expect(split).toEqual({ W: 2, U: 2 })
    const sum = Object.values(split).reduce((s, n) => s + (n ?? 0), 0)
    expect(sum).toBeGreaterThan(3)
  })
})
