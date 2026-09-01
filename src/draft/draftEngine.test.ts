import { describe, expect, it } from 'vitest'
import type { Seat } from '../net/protocol'
import { applyPick, initDraftEngine, isDraftComplete, isRoundComplete, nextHolder, packsForRound, passDirection } from './draftEngine'
import type { CubeCard, DraftConfig } from './types'

const SEATS: Seat[] = [0, 1, 2, 3]
const CONFIG: DraftConfig = { cubeId: 'c1', cubeName: 'Test Cube', packSize: 3, packsPerPlayer: 2 }

function makeCube(size: number): CubeCard[] {
  return Array.from({ length: size }, (_, i) => ({ scryfallId: `card-${i}`, quantity: 1 }))
}

describe('passDirection', () => {
  it('alternates starting with +1 on round 0', () => {
    expect(passDirection(0)).toBe(1)
    expect(passDirection(1)).toBe(-1)
    expect(passDirection(2)).toBe(1)
  })
})

describe('nextHolder', () => {
  it('advances along TURN_ORDER (0,2,3,1) in round 0, and reverses in round 1', () => {
    expect(nextHolder(0, 0, SEATS)).toBe(2)
    expect(nextHolder(2, 0, SEATS)).toBe(3)
    expect(nextHolder(0, 1, SEATS)).toBe(1)
  })

  it('wraps around a smaller occupied-seat subset', () => {
    expect(nextHolder(0, 0, [0, 2])).toBe(2)
    expect(nextHolder(2, 0, [0, 2])).toBe(0)
  })
})

describe('applyPick', () => {
  it('rejects an unknown pack', () => {
    const state = initDraftEngine(makeCube(24), CONFIG, SEATS)
    const result = applyPick(state, 'not-a-real-pack', 'card-0', 0)
    expect(result.ok).toBe(false)
  })

  it("rejects a pick from a seat that isn't holding the pack", () => {
    const state = initDraftEngine(makeCube(24), CONFIG, SEATS)
    const round0 = packsForRound(state, 0)
    const someoneElsesPack = round0.find((p) => p.holderSeat !== 0)!
    const result = applyPick(state, someoneElsesPack.packId, someoneElsesPack.cards[0], 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/holding/)
  })

  it("rejects a card that isn't in the pack", () => {
    const state = initDraftEngine(makeCube(24), CONFIG, SEATS)
    const pack = packsForRound(state, 0).find((p) => p.holderSeat === 0)!
    const result = applyPick(state, pack.packId, 'not-in-this-pack', 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/pack/)
  })

  it('removes the picked card, adds it to the pool, and passes the pack to the next seat', () => {
    const state = initDraftEngine(makeCube(24), CONFIG, SEATS)
    const pack = packsForRound(state, 0).find((p) => p.holderSeat === 0)!
    const picked = pack.cards[0]
    const result = applyPick(state, pack.packId, picked, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nextState.poolsBySeat[0]).toEqual([picked])
    expect(result.nextState.picksBySeat[0]).toBe(1)
    expect(result.passedTo?.toSeat).toBe(2)
    expect(result.passedTo?.pack.cards).toHaveLength(pack.cards.length - 1)
    expect(result.passedTo?.pack.cards).not.toContain(picked)
  })

  it('retires the pack (no passedTo) once its last card is taken', () => {
    let state = initDraftEngine(makeCube(24), CONFIG, SEATS)
    let pack = packsForRound(state, 0).find((p) => p.holderSeat === 0)!
    // Pick every card in this pack, always from whoever currently holds it.
    while (pack.cards.length > 0) {
      const card = pack.cards[0]
      const result = applyPick(state, pack.packId, card, pack.holderSeat)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      state = result.nextState
      if (result.passedTo) {
        pack = result.passedTo.pack
      } else {
        expect(state.packsById[pack.packId]).toBeUndefined()
        return
      }
    }
  })
})

describe('a full draft simulation', () => {
  it('deals every card exactly once and completes with no packs left', () => {
    const cubeSize = 4 * 2 * 3 // playerCount * packsPerPlayer * packSize
    let state = initDraftEngine(makeCube(cubeSize), CONFIG, SEATS)

    for (let round = 0; round < CONFIG.packsPerPlayer; round++) {
      expect(isRoundComplete(state, round)).toBe(false)
      // Drain every pack in this round by always picking from whoever currently holds it,
      // round-robin across the round's still-live packs (mirrors real simultaneous drafting).
      let live = packsForRound(state, round)
      while (live.length > 0) {
        const pack = live[0]
        const result = applyPick(state, pack.packId, pack.cards[0], pack.holderSeat)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        state = result.nextState
        live = packsForRound(state, round)
      }
      expect(isRoundComplete(state, round)).toBe(true)
    }

    expect(isDraftComplete(state)).toBe(true)
    const allPicked = SEATS.flatMap((seat) => state.poolsBySeat[seat] ?? [])
    expect(allPicked).toHaveLength(cubeSize)
    expect(new Set(allPicked).size).toBe(cubeSize)
    for (const seat of SEATS) {
      expect(state.poolsBySeat[seat]).toHaveLength(CONFIG.packsPerPlayer * CONFIG.packSize)
    }
  })
})
