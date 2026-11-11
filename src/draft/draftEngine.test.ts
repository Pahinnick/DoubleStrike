import { describe, expect, it } from 'vitest'
import type { Seat } from '../net/protocol'
import { activeRound, applyPick, draftTableOf, initDraftEngine, isDraftComplete, isRoundComplete, nextHolder, opponentSeatOf, packsForRound, packsHeldBy, passDirection, seatsInTableOrder } from './draftEngine'
import { buildPacks, buildSoloCubePacks } from './packBuilder'
import type { CubeCard, DraftConfig } from './types'

const SEATS: Seat[] = [0, 1, 2, 3]
const CONFIG: DraftConfig = { source: { kind: 'cube', cubeId: 'c1', name: 'Test Cube' }, packSize: 3, packsPerPlayer: 2 }

function makeCube(size: number): CubeCard[] {
  return Array.from({ length: size }, (_, i) => ({ scryfallId: `card-${i}`, quantity: 1 }))
}

function init(cubeSize: number, seats: Seat[] = SEATS) {
  const rounds = buildPacks(makeCube(cubeSize), { packSize: CONFIG.packSize, packsPerPlayer: CONFIG.packsPerPlayer, seats })
  return initDraftEngine(rounds, CONFIG, seats)
}

/** Drains every pack of every round, always picking from whoever holds it. */
function simulate(seats: Seat[]) {
  const cubeSize = seats.length * CONFIG.packsPerPlayer * CONFIG.packSize
  let state = init(cubeSize, seats)
  for (let round = 0; round < CONFIG.packsPerPlayer; round++) {
    let live = packsForRound(state, round)
    while (live.length > 0) {
      const pack = live[0]
      const result = applyPick(state, pack.packId, pack.cards[0], pack.holderSeat)
      if (!result.ok) throw new Error(result.reason)
      state = result.nextState
      live = packsForRound(state, round)
    }
  }
  return { state, cubeSize }
}

describe('fair passing', () => {
  it('gives every seat the same number of picks, however unevenly fast the players are', () => {
    let s = 12345
    const random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    for (const seats of [[0, 1], [0, 2, 3], [0, 1, 2, 3, 4, 5]] as Seat[][]) {
      const config: DraftConfig = { ...CONFIG, packSize: 15, packsPerPlayer: 3 }
      const rounds = buildPacks(makeCube(seats.length * 45), { packSize: 15, packsPerPlayer: 3, seats })
      let state = initDraftEngine(rounds, config, seats)
      // Any seat holding a pack may pick next, in any order — some seats run far ahead with a queue.
      while (!isDraftComplete(state)) {
        const ready = seats.filter((seat) => packsHeldBy(state, seat).length > 0)
        const seat = ready[Math.floor(random() * ready.length)]
        const pack = packsHeldBy(state, seat)[0]
        const result = applyPick(state, pack.packId, pack.cards[Math.floor(random() * pack.cards.length)], seat)
        if (!result.ok) throw new Error(result.reason)
        state = result.nextState
      }
      for (const seat of seats) expect(state.poolsBySeat[seat], `seat ${seat} of ${seats.length}`).toHaveLength(45)
    }
  })
})

describe('passDirection', () => {
  it('alternates starting with +1 on round 0', () => {
    expect(passDirection(0)).toBe(1)
    expect(passDirection(1)).toBe(-1)
    expect(passDirection(2)).toBe(1)
  })
})

describe('nextHolder', () => {
  it('advances in seat order in round 0, and reverses in round 1', () => {
    expect(nextHolder(0, 0, SEATS)).toBe(1)
    expect(nextHolder(1, 0, SEATS)).toBe(2)
    expect(nextHolder(3, 0, SEATS)).toBe(0)
    expect(nextHolder(0, 1, SEATS)).toBe(3)
  })

  it('passes around all six seats of a full room', () => {
    const six: Seat[] = [5, 3, 0, 1, 4, 2]
    expect(seatsInTableOrder(six)).toEqual([0, 1, 2, 3, 4, 5])
    expect(nextHolder(5, 0, six)).toBe(0)
    expect(nextHolder(0, 1, six)).toBe(5)
  })

  it('skips empty seats', () => {
    expect(nextHolder(1, 0, [1, 4])).toBe(4)
    expect(nextHolder(4, 0, [1, 4])).toBe(1)
  })

  it('wraps around a smaller occupied-seat subset', () => {
    expect(nextHolder(0, 0, [0, 2])).toBe(2)
    expect(nextHolder(2, 0, [0, 2])).toBe(0)
  })
})

describe('applyPick', () => {
  it('rejects an unknown pack', () => {
    const state = init(24)
    const result = applyPick(state, 'not-a-real-pack', 'card-0', 0)
    expect(result.ok).toBe(false)
  })

  it("rejects a pick from a seat that isn't holding the pack", () => {
    const state = init(24)
    const round0 = packsForRound(state, 0)
    const someoneElsesPack = round0.find((p) => p.holderSeat !== 0)!
    const result = applyPick(state, someoneElsesPack.packId, someoneElsesPack.cards[0], 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/holding/)
  })

  it("rejects a card that isn't in the pack", () => {
    const state = init(24)
    const pack = packsForRound(state, 0).find((p) => p.holderSeat === 0)!
    const result = applyPick(state, pack.packId, 'not-in-this-pack', 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/pack/)
  })

  it('removes the picked card, adds it to the pool, and passes the pack to the next seat', () => {
    const state = init(24)
    const pack = packsForRound(state, 0).find((p) => p.holderSeat === 0)!
    const picked = pack.cards[0]
    const result = applyPick(state, pack.packId, picked, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nextState.poolsBySeat[0]).toEqual([picked])
    expect(result.nextState.picksBySeat[0]).toBe(1)
    expect(result.passedTo?.toSeat).toBe(1)
    expect(result.passedTo?.pack.cards).toHaveLength(pack.cards.length - 1)
    expect(result.passedTo?.pack.cards).not.toContain(picked)
  })

  it('retires the pack (no passedTo) once its last card is taken', () => {
    let state = init(24)
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
    let state = init(cubeSize)

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

describe('drafts with 2, 3, 5 and 6 players', () => {
  for (const seats of [[0, 2], [0, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5]] as Seat[][]) {
    it(`${seats.length} players: every card dealt once, everyone ends with an equal pool`, () => {
      const { state, cubeSize } = simulate(seats)
      expect(isDraftComplete(state)).toBe(true)
      const allPicked = seats.flatMap((seat) => state.poolsBySeat[seat] ?? [])
      expect(new Set(allPicked).size).toBe(cubeSize)
      for (const seat of seats) expect(state.poolsBySeat[seat]).toHaveLength(CONFIG.packsPerPlayer * CONFIG.packSize)
    })
  }
})

describe('1v1 tables', () => {
  it('pairs seats 0-1, 2-3 and 4-5', () => {
    expect(([0, 1, 2, 3, 4, 5] as Seat[]).map((seat) => draftTableOf(seat))).toEqual([0, 0, 1, 1, 2, 2])
    expect(opponentSeatOf(0)).toBe(1)
    expect(opponentSeatOf(1)).toBe(0)
    expect(opponentSeatOf(4)).toBe(5)
    expect(opponentSeatOf(5)).toBe(4)
  })
})

describe('packsHeldBy', () => {
  it('collects the packs of the round in play waiting on a seat — what a returning player gets back', () => {
    let state = init(24, [0, 1])
    const [first, second] = packsForRound(state, 0)
    // Seat 0 picks and passes to seat 1, who now holds both of round 0's packs.
    const firstAtSeat0 = first.holderSeat === 0 ? first : second
    const result = applyPick(state, firstAtSeat0.packId, firstAtSeat0.cards[0], 0)
    if (!result.ok) throw new Error(result.reason)
    state = result.nextState
    expect(packsHeldBy(state, 1).map((p) => p.packId).sort()).toEqual([first.packId, second.packId].sort())
    expect(activeRound(state)).toBe(0)
  })

  it("never includes a later round's pack, even though those are dealt up front", () => {
    let state = init(24, [0, 1])
    const atSeat0 = packsForRound(state, 0).find((p) => p.holderSeat === 0)
    if (!atSeat0) throw new Error('no pack at seat 0')
    const result = applyPick(state, atSeat0.packId, atSeat0.cards[0], 0)
    if (!result.ok) throw new Error(result.reason)
    state = result.nextState
    // Seat 0 now holds no round-0 pack, but does hold its own unopened round-1 pack.
    expect(Object.values(state.packsById).some((p) => p.round === 1 && p.holderSeat === 0)).toBe(true)
    expect(packsHeldBy(state, 0)).toEqual([])
    const sealed = Object.values(state.packsById).find((p) => p.round === 1 && p.holderSeat === 0)
    if (!sealed) throw new Error('no round-1 pack at seat 0')
    expect(applyPick(state, sealed.packId, sealed.cards[0], 0)).toEqual({ ok: false, reason: "That pack hasn't been opened yet." })
  })

  it('moves on to the next round once the current one is picked through', () => {
    const state = init(24, [0, 1])
    const laterRoundsOnly = { ...state, packsById: Object.fromEntries(Object.entries(state.packsById).filter(([, p]) => p.round > 0)) }
    expect(activeRound(laterRoundsOnly)).toBe(1)
    expect(packsHeldBy(laterRoundsOnly, 0).map((p) => p.round)).toEqual([1])
    expect(activeRound({ ...state, packsById: {} })).toBeNull()
  })
})

describe('solo draft', () => {
  const PACK = 5
  const ROUNDS = 2
  const config: DraftConfig = { source: { kind: 'cube', cubeId: 'c1', name: 'Test Cube' }, packSize: PACK, packsPerPlayer: ROUNDS }

  function soloState() {
    const { rounds, reserve } = buildSoloCubePacks(makeCube(ROUNDS * ((PACK * (PACK + 1)) / 2)), { packSize: PACK, packsPerPlayer: ROUNDS, seat: 2 })
    return initDraftEngine(rounds, config, [2], reserve)
  }

  it('hands a fresh, one-card-smaller pack after each pick instead of the same pack back', () => {
    let state = soloState()
    const first = packsHeldBy(state, 2)[0]
    expect(first.cards).toHaveLength(PACK)
    const result = applyPick(state, first.packId, first.cards[0], 2)
    if (!result.ok) throw new Error(result.reason)
    state = result.nextState
    expect(result.passedTo?.toSeat).toBe(2)
    expect(result.passedTo?.pack.packId).not.toBe(first.packId)
    expect(result.passedTo?.pack.cards).toHaveLength(PACK - 1)
    expect(result.passedTo?.pack.cards.some((c) => first.cards.includes(c))).toBe(false)
    expect(state.packsById[first.packId]).toBeUndefined()
  })

  it('makes one pick per card in a pack each round, then completes', () => {
    let state = soloState()
    let picks = 0
    while (!isDraftComplete(state)) {
      const pack = packsHeldBy(state, 2)[0]
      const result = applyPick(state, pack.packId, pack.cards[0], 2)
      if (!result.ok) throw new Error(result.reason)
      state = result.nextState
      picks++
    }
    expect(picks).toBe(PACK * ROUNDS)
    expect(state.poolsBySeat[2]).toHaveLength(PACK * ROUNDS)
    expect(new Set(state.poolsBySeat[2]).size).toBe(PACK * ROUNDS)
  })

  it('ignores a reserve when more than one seat is drafting', () => {
    const { reserve } = buildSoloCubePacks(makeCube(ROUNDS * 15), { packSize: PACK, packsPerPlayer: ROUNDS, seat: 0 })
    const rounds = buildPacks(makeCube(ROUNDS * 2 * PACK), { packSize: PACK, packsPerPlayer: ROUNDS, seats: [0, 1] })
    expect(initDraftEngine(rounds, config, [0, 1], reserve).soloReserve).toBeUndefined()
  })
})
