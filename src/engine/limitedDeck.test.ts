import { describe, expect, it } from 'vitest'
import { basicLandSlots, curveColumnOf, RECOMMENDED_LIMITED_LANDS, suggestBasicLands } from './limitedDeck'

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

describe('suggestBasicLands', () => {
  it('splits lands in proportion to colored mana symbols and always adds up exactly', () => {
    const costs = ['{1}{R}', '{R}{R}', '{2}{R}', '{G}', '{1}{G}{G}']
    const lands = suggestBasicLands(costs, 17)
    expect(sum(lands)).toBe(17)
    expect(lands.R).toBeGreaterThan(lands.G)
    expect(lands.W + lands.U + lands.B).toBe(0)
  })

  it('gives a light splash at least one source', () => {
    const costs = [...Array(20).fill('{G}{G}'), '{1}{U}']
    const lands = suggestBasicLands(costs, 17)
    expect(sum(lands)).toBe(17)
    expect(lands.U).toBeGreaterThanOrEqual(1)
  })

  it('counts hybrid symbols toward both colors', () => {
    const lands = suggestBasicLands(['{W/U}', '{W/U}'], 10)
    expect(lands.W).toBeGreaterThan(0)
    expect(lands.U).toBeGreaterThan(0)
    expect(sum(lands)).toBe(10)
  })

  it('suggests nothing for a colorless deck or zero slots', () => {
    expect(sum(suggestBasicLands(['{3}', '{2}'], 17))).toBe(0)
    expect(sum(suggestBasicLands(['{R}'], 0))).toBe(0)
  })
})

describe('basicLandSlots', () => {
  it('fills up to the recommended land count, counting nonbasics already in the deck', () => {
    expect(basicLandSlots(0)).toBe(RECOMMENDED_LIMITED_LANDS)
    expect(basicLandSlots(2)).toBe(RECOMMENDED_LIMITED_LANDS - 2)
    expect(basicLandSlots(30)).toBe(0)
  })
})

describe('curveColumnOf', () => {
  it('buckets spells by mana value and lands separately', () => {
    expect(curveColumnOf(0, false)).toBe('0–1')
    expect(curveColumnOf(1, false)).toBe('0–1')
    expect(curveColumnOf(3, false)).toBe('3')
    expect(curveColumnOf(7, false)).toBe('6+')
    expect(curveColumnOf(0, true)).toBe('Lands')
  })
})
