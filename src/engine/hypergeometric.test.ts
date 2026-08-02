import { describe, expect, it } from 'vitest'
import { choose, logChoose, multivariateHypergeomPMF } from './hypergeometric'

describe('choose', () => {
  it('computes small hand-checkable values', () => {
    expect(choose(5, 2)).toBe(10)
    expect(choose(4, 2)).toBe(6)
    expect(choose(10, 0)).toBe(1)
    expect(choose(0, 0)).toBe(1)
    expect(choose(10, 10)).toBe(1)
  })

  it('returns 0 when k is out of range', () => {
    expect(choose(10, 11)).toBe(0)
    expect(choose(10, -1)).toBe(0)
  })

  it('matches Pascal-triangle-derived values for a moderate n', () => {
    // C(20, 10) = 184756, a commonly-cited reference value.
    expect(choose(20, 10)).toBe(184756)
  })
})

describe('logChoose', () => {
  it('is consistent with choose for in-range values', () => {
    expect(Math.exp(logChoose(5, 2))).toBeCloseTo(10, 6)
  })

  it('returns -Infinity for out-of-range k', () => {
    expect(logChoose(5, 6)).toBe(-Infinity)
    expect(logChoose(5, -1)).toBe(-Infinity)
  })

  it('stays finite for Commander-scale deck sizes (n=99)', () => {
    expect(Number.isFinite(logChoose(99, 40))).toBe(true)
  })
})

describe('multivariateHypergeomPMF', () => {
  it('matches a hand-computed two-category case', () => {
    // Deck of 10: 4 "red sources", 6 "other". Draw 3.
    // P(exactly 2 red, 1 other) = C(4,2)*C(6,1)/C(10,3) = 6*6/120 = 0.3
    const p = multivariateHypergeomPMF([4, 6], [2, 1], 10, 3)
    expect(p).toBeCloseTo(0.3, 10)
  })

  it('returns 0 when draw counts do not sum to the sample size', () => {
    expect(multivariateHypergeomPMF([4, 6], [2, 2], 10, 3)).toBe(0)
  })

  it('returns 0 when a draw count exceeds its category size', () => {
    expect(multivariateHypergeomPMF([4, 6], [5, -2], 10, 3)).toBe(0)
  })

  it('sums to 1 across all valid draw-count splits for a fixed sample size', () => {
    const populationSize = 10
    const sampleSize = 3
    const categorySizes = [4, 6]
    let total = 0
    for (let x = 0; x <= sampleSize; x++) {
      total += multivariateHypergeomPMF(categorySizes, [x, sampleSize - x], populationSize, sampleSize)
    }
    expect(total).toBeCloseTo(1, 10)
  })

  it('sums to 1 across all valid splits for a three-category case', () => {
    const populationSize = 12
    const sampleSize = 4
    const categorySizes = [3, 4, 5]
    let total = 0
    for (let x = 0; x <= sampleSize; x++) {
      for (let y = 0; y <= sampleSize - x; y++) {
        const z = sampleSize - x - y
        total += multivariateHypergeomPMF(categorySizes, [x, y, z], populationSize, sampleSize)
      }
    }
    expect(total).toBeCloseTo(1, 10)
  })

  it('handles a realistic Commander-scale deck without numeric blowup', () => {
    // 99-card deck, 40 lands, draw 10 (opening hand).
    const p = multivariateHypergeomPMF([40, 59], [4, 6], 99, 10)
    expect(Number.isFinite(p)).toBe(true)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})
