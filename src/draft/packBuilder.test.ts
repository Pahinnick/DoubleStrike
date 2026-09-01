import { describe, expect, it } from 'vitest'
import { buildPacks } from './packBuilder'
import type { CubeCard } from './types'

function makeCube(size: number): CubeCard[] {
  return Array.from({ length: size }, (_, i) => ({ scryfallId: `card-${i}`, quantity: 1 }))
}

describe('buildPacks', () => {
  it('deals packsPerPlayer rounds of playerCount packs each, all packSize cards', () => {
    const cube = makeCube(4 * 3 * 15)
    const rounds = buildPacks(cube, { packSize: 15, packsPerPlayer: 3, playerCount: 4 })
    expect(rounds).toHaveLength(3)
    for (const round of rounds) {
      expect(round).toHaveLength(4)
      for (const pack of round) expect(pack.cards).toHaveLength(15)
    }
  })

  it('assigns holderSeat matching each pack\'s seat index and round number matching its round', () => {
    const cube = makeCube(2 * 2 * 3)
    const rounds = buildPacks(cube, { packSize: 3, packsPerPlayer: 2, playerCount: 2 }, () => 0.5)
    rounds.forEach((round, roundIndex) => {
      round.forEach((pack, seatIndex) => {
        expect(pack.holderSeat).toBe(seatIndex)
        expect(pack.round).toBe(roundIndex)
      })
    })
  })

  it('expands card quantity into individual instances', () => {
    const cube: CubeCard[] = [
      { scryfallId: 'staple', quantity: 4 },
      ...makeCube(4 * 1 * 3 - 4).map((c) => ({ ...c, scryfallId: `${c.scryfallId}-b` })),
    ]
    const rounds = buildPacks(cube, { packSize: 3, packsPerPlayer: 1, playerCount: 4 })
    const allCards = rounds.flat().flatMap((p) => p.cards)
    expect(allCards.filter((id) => id === 'staple')).toHaveLength(4)
  })

  it('never duplicates or drops a card across all dealt packs', () => {
    const cube = makeCube(4 * 3 * 15)
    const rounds = buildPacks(cube, { packSize: 15, packsPerPlayer: 3, playerCount: 4 })
    const allCards = rounds.flat().flatMap((p) => p.cards)
    expect(allCards).toHaveLength(cube.length)
    expect(new Set(allCards).size).toBe(cube.length)
  })

  it('throws a setup-time error when the cube is too small', () => {
    const cube = makeCube(10)
    expect(() => buildPacks(cube, { packSize: 15, packsPerPlayer: 3, playerCount: 4 })).toThrow(/cards, but/)
  })
})
