import { describe, expect, it } from 'vitest'
import { buildPacks, buildSoloCubePacks, buildSoloReserve, cubeCardsNeeded } from './packBuilder'
import type { CubeCard } from './types'
import type { Seat } from '../net/protocol'

const SEATS_4: Seat[] = [0, 1, 2, 3]
const SEATS_2: Seat[] = [0, 2]

function makeCube(size: number): CubeCard[] {
  return Array.from({ length: size }, (_, i) => ({ scryfallId: `card-${i}`, quantity: 1 }))
}

describe('buildPacks', () => {
  it('deals packsPerPlayer rounds of playerCount packs each, all packSize cards', () => {
    const cube = makeCube(4 * 3 * 15)
    const rounds = buildPacks(cube, { packSize: 15, packsPerPlayer: 3, seats: SEATS_4 })
    expect(rounds).toHaveLength(3)
    for (const round of rounds) {
      expect(round).toHaveLength(4)
      for (const pack of round) expect(pack.cards).toHaveLength(15)
    }
  })

  it('assigns holderSeat matching each pack\'s seat index and round number matching its round', () => {
    const cube = makeCube(2 * 2 * 3)
    const rounds = buildPacks(cube, { packSize: 3, packsPerPlayer: 2, seats: SEATS_2 }, () => 0.5)
    rounds.forEach((round, roundIndex) => {
      round.forEach((pack, seatIndex) => {
        expect(pack.holderSeat).toBe(SEATS_2[seatIndex])
        expect(pack.round).toBe(roundIndex)
      })
    })
  })

  it('expands card quantity into individual instances', () => {
    const cube: CubeCard[] = [
      { scryfallId: 'staple', quantity: 4 },
      ...makeCube(4 * 1 * 3 - 4).map((c) => ({ ...c, scryfallId: `${c.scryfallId}-b` })),
    ]
    const rounds = buildPacks(cube, { packSize: 3, packsPerPlayer: 1, seats: SEATS_4 })
    const allCards = rounds.flat().flatMap((p) => p.cards)
    expect(allCards.filter((id) => id === 'staple')).toHaveLength(4)
  })

  it('never duplicates or drops a card across all dealt packs', () => {
    const cube = makeCube(4 * 3 * 15)
    const rounds = buildPacks(cube, { packSize: 15, packsPerPlayer: 3, seats: SEATS_4 })
    const allCards = rounds.flat().flatMap((p) => p.cards)
    expect(allCards).toHaveLength(cube.length)
    expect(new Set(allCards).size).toBe(cube.length)
  })

  it('throws a setup-time error when the cube is too small', () => {
    const cube = makeCube(10)
    expect(() => buildPacks(cube, { packSize: 15, packsPerPlayer: 3, seats: SEATS_4 })).toThrow(/cards, but/)
  })
})

describe('solo draft packs', () => {
  const cube = (n: number): CubeCard[] => Array.from({ length: n }, (_, i) => ({ scryfallId: `card-${i}`, quantity: 1 }))

  it('needs the opening pack plus a shrinking reserve from the cube', () => {
    // 15-card packs: 15 + 14 + … + 1 = 120 per round.
    expect(cubeCardsNeeded({ packSize: 15, packsPerPlayer: 3, seats: [0] })).toBe(360)
    expect(cubeCardsNeeded({ packSize: 15, packsPerPlayer: 3, seats: [0, 1] })).toBe(90)
  })

  it('builds reserve packs of size-1 down to 1, never reusing a cube card', () => {
    const { rounds, reserve } = buildSoloCubePacks(cube(360), { packSize: 15, packsPerPlayer: 3, seat: 4 })
    expect(rounds).toHaveLength(3)
    expect(reserve.map((r) => r.map((p) => p.cards.length))).toEqual(Array(3).fill(Array.from({ length: 14 }, (_, k) => 14 - k)))
    const all = [...rounds.flat(), ...reserve.flat()].flatMap((p) => p.cards)
    expect(all).toHaveLength(360)
    expect(new Set(all).size).toBe(360)
    expect(reserve.flat().every((p) => p.holderSeat === 4)).toBe(true)
  })

  it('refuses a cube too small for a solo draft, with a clear reason', () => {
    expect(() => buildSoloCubePacks(cube(100), { packSize: 15, packsPerPlayer: 3, seat: 0 })).toThrow(/solo draft/)
  })

  it('trims freshly opened packs to follow the opening pack size', () => {
    const rounds = buildPacks(cube(14), { packSize: 14, packsPerPlayer: 1, seats: [0] })
    let opened = 0
    const reserve = buildSoloReserve(rounds, () => Array.from({ length: 14 }, (_, i) => `p${opened++}-${i}`))
    expect(reserve[0].map((p) => p.cards.length)).toEqual(Array.from({ length: 13 }, (_, k) => 13 - k))
  })
})
