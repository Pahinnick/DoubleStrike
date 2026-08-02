import { describe, expect, it } from 'vitest'
import type { Color } from '../utils/colors'
import { deriveManaBase, deriveRampSources, manaBaseFromOverride, sourceCountForColor, withRampSources } from './manaSources'

describe('deriveManaBase', () => {
  it('marks the result as exact (a true non-overlapping partition of real lands)', () => {
    const manaBase = deriveManaBase([{ quantity: 17, producedMana: ['U'] }])
    expect(manaBase.exact).toBe(true)
  })

  it('merges lands that produce the same color set and sums to totalLands', () => {
    const manaBase = deriveManaBase([
      { quantity: 8, producedMana: ['U'] },
      { quantity: 8, producedMana: ['B'] },
      { quantity: 1, producedMana: ['U', 'B'] },
    ])
    const sumOfLandQuantities = manaBase.lands.reduce((sum, l) => sum + l.quantity, 0)
    expect(sumOfLandQuantities).toBe(manaBase.totalLands)
  })
})

describe('manaBaseFromOverride', () => {
  it('marks the result as not exact (marginal counts with unknown overlap)', () => {
    const manaBase = manaBaseFromOverride(10, { W: 5 })
    expect(manaBase.exact).toBe(false)
  })

  it('can describe per-color counts that sum to more than totalLands (overlapping multi-color sources)', () => {
    // e.g. 3 real lands that each produce all five colors (Command Tower-style)
    const manaBase = manaBaseFromOverride(3, { W: 3, U: 3, B: 3, R: 3, G: 3 })
    expect(sourceCountForColor(manaBase, 'W')).toBe(3)
    expect(sourceCountForColor(manaBase, 'G')).toBe(3)
    expect(manaBase.totalLands).toBe(3)
  })
})

describe('deriveRampSources', () => {
  it('skips cards with no produced_mana (land-tutoring ramp like Nature\'s Lore)', () => {
    const ramp = deriveRampSources([{ quantity: 1, producedMana: [] }])
    expect(ramp).toEqual([])
  })

  it('merges ramp cards that produce the same color set, same as lands do', () => {
    const ramp = deriveRampSources([
      { quantity: 1, producedMana: ['G'] }, // Elvish Mystic
      { quantity: 1, producedMana: ['G'] }, // Llanowar Elves
    ])
    expect(ramp).toEqual([{ quantity: 2, colors: ['G'] }])
  })
})

describe('withRampSources', () => {
  it('returns the base manaBase unchanged when there are no ramp sources', () => {
    const base = deriveManaBase([{ quantity: 37, producedMana: ['G'] }])
    expect(withRampSources(base, [])).toEqual(base)
  })

  it('adds ramp quantity to totalLands and appends the ramp entries, without mutating the base', () => {
    // Colorless-producing ramp (e.g. Sol Ring) is represented as colors: ['C'], the same
    // type-level simplification real colorless lands already use in deriveManaBase.
    const base = deriveManaBase([{ quantity: 37, producedMana: ['G'] }])
    const augmented = withRampSources(base, [{ quantity: 1, colors: ['C'] as unknown as Color[] }])
    expect(augmented.totalLands).toBe(38)
    expect(sourceCountForColor(augmented, 'G')).toBe(37)
    expect(base.totalLands).toBe(37) // unchanged
  })
})
