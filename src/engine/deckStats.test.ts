import { describe, expect, it } from 'vitest'
import { computeColorPipTotals, computeManaCurve } from './deckStats'

describe('computeManaCurve', () => {
  it('buckets cards by their floored cmc', () => {
    const buckets = computeManaCurve([
      { manaCost: '{U}', cmc: 1, quantity: 4 },
      { manaCost: '{2}{U}', cmc: 3, quantity: 2 },
    ])
    expect(buckets[1].total).toBe(4)
    expect(buckets[3].total).toBe(2)
    expect(buckets[0].total).toBe(0)
  })

  it('caps everything at 7 or more into the last bucket', () => {
    const buckets = computeManaCurve([{ manaCost: '{9}', cmc: 9, quantity: 1 }])
    expect(buckets[7].total).toBe(1)
  })

  it('splits a colorless card into the C bucket', () => {
    const buckets = computeManaCurve([{ manaCost: '{3}', cmc: 3, quantity: 5 }])
    expect(buckets[3].byColor.C).toBe(5)
  })

  it('splits a multicolor card evenly across its required colors', () => {
    const buckets = computeManaCurve([{ manaCost: '{1}{U}{B}', cmc: 3, quantity: 2 }])
    expect(buckets[3].byColor.U).toBeCloseTo(1, 10)
    expect(buckets[3].byColor.B).toBeCloseTo(1, 10)
    expect(buckets[3].total).toBe(2)
  })
})

describe('computeColorPipTotals', () => {
  it('sums straight colored pips across quantity', () => {
    const totals = computeColorPipTotals([{ manaCost: '{1}{U}{U}', quantity: 3 }])
    expect(totals.U).toBe(6)
  })

  it('splits hybrid pips evenly across their color options', () => {
    const totals = computeColorPipTotals([{ manaCost: '{W/B}', quantity: 2 }])
    expect(totals.W).toBeCloseTo(1, 10)
    expect(totals.B).toBeCloseTo(1, 10)
  })

  it('ignores generic-only costs', () => {
    const totals = computeColorPipTotals([{ manaCost: '{5}', quantity: 3 }])
    expect(totals).toEqual({})
  })
})
