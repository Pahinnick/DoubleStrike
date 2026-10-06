import { describe, expect, it } from 'vitest'
import { ALL_SEATS, buildSpinSequence, completesRound, nextActiveSeat, pickRandomSeat, seatOrigin, tableSize } from './podLayout'

const W = 2400
const H = 1600

describe('podLayout', () => {
  it('places the four seats in distinct 2×2 quadrants', () => {
    const origins = ALL_SEATS.map((s) => seatOrigin(s, W, H))
    const unique = new Set(origins.map((o) => `${o.x},${o.y}`))
    expect(unique.size).toBe(4)
  })

  it('seats the host (0) bottom-left and fills across/up', () => {
    expect(seatOrigin(0, W, H)).toEqual({ x: 0, y: H }) // bottom-left
    expect(seatOrigin(1, W, H)).toEqual({ x: W, y: H }) // bottom-right
    expect(seatOrigin(2, W, H)).toEqual({ x: 0, y: 0 }) // top-left
    expect(seatOrigin(3, W, H)).toEqual({ x: W, y: 0 }) // top-right
  })

  it('every quadrant sits within the full table bounds', () => {
    const { width, height } = tableSize(W, H)
    expect({ width, height }).toEqual({ width: 4800, height: 3200 })
    for (const seat of ALL_SEATS) {
      const o = seatOrigin(seat, W, H)
      expect(o.x + W).toBeLessThanOrEqual(width)
      expect(o.y + H).toBeLessThanOrEqual(height)
    }
  })
})

describe('nextActiveSeat', () => {
  it('starts the ring at the first occupied seat in turn order when there is no current seat', () => {
    expect(nextActiveSeat(null, [0, 1, 2, 3])).toBe(0)
    expect(nextActiveSeat(null, [2, 1])).toBe(2) // turn order is 0,2,3,1 — 2 comes before 1
  })

  it('advances clockwise around the table edges, not diagonally by raw seat number', () => {
    expect(nextActiveSeat(0, [0, 1, 2, 3])).toBe(2) // bottom-left -> top-left
    expect(nextActiveSeat(2, [0, 1, 2, 3])).toBe(3) // top-left -> top-right
    expect(nextActiveSeat(3, [0, 1, 2, 3])).toBe(1) // top-right -> bottom-right
    expect(nextActiveSeat(1, [0, 1, 2, 3])).toBe(0) // wraps: bottom-right -> bottom-left
  })

  it('skips unoccupied seats', () => {
    expect(nextActiveSeat(0, [0, 3])).toBe(3)
    expect(nextActiveSeat(3, [0, 3])).toBe(0)
  })

  it('restarts the ring if the current active seat has since left', () => {
    expect(nextActiveSeat(2, [0, 1])).toBe(0)
  })
})

describe('completesRound', () => {
  it('is true only on the pass that wraps back to the ring start', () => {
    // Turn order 0,2,3,1 — only the last seat's pass closes the round.
    expect(completesRound(0, [0, 1, 2, 3])).toBe(false)
    expect(completesRound(2, [0, 1, 2, 3])).toBe(false)
    expect(completesRound(3, [0, 1, 2, 3])).toBe(false)
    expect(completesRound(1, [0, 1, 2, 3])).toBe(true)
  })

  it('tracks the occupied ring, not raw seat numbers', () => {
    // With only 0 and 3 seated, 3 is the last seat in the ring even though 1 outranks it.
    expect(completesRound(0, [0, 3])).toBe(false)
    expect(completesRound(3, [0, 3])).toBe(true)
  })

  it('is true every pass in a one-player ring', () => {
    expect(completesRound(0, [0])).toBe(true)
  })

  it('is false for the opening pass and for a seat that has left', () => {
    expect(completesRound(null, [0, 1, 2, 3])).toBe(false)
    // nextActiveSeat restarts the ring here rather than continuing it, so no round was completed.
    expect(completesRound(2, [0, 1])).toBe(false)
  })

  it('agrees with nextActiveSeat about where the ring wraps', () => {
    const occupied = [0, 1, 2, 3] as const
    for (const seat of occupied) {
      const wrapped = nextActiveSeat(seat, occupied) === 0
      expect(completesRound(seat, occupied)).toBe(wrapped)
    }
  })
})

describe('pickRandomSeat', () => {
  it('only ever picks an occupied seat', () => {
    for (let i = 0; i < 50; i++) {
      expect([0, 2]).toContain(pickRandomSeat([0, 2]))
    }
  })

  it('is capable of picking every occupied seat given enough trials', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(pickRandomSeat([0, 1, 2, 3]))
    expect(seen).toEqual(new Set([0, 1, 2, 3]))
  })
})

describe('buildSpinSequence', () => {
  it('ends exactly on the requested final seat', () => {
    for (const finalSeat of [0, 1, 2, 3] as const) {
      const seq = buildSpinSequence([0, 1, 2, 3], finalSeat)
      expect(seq[seq.length - 1]).toBe(finalSeat)
    }
  })

  it('runs at least the requested number of full laps around the table', () => {
    const seq = buildSpinSequence([0, 1, 2, 3], 0, 3)
    // 4 occupied seats * 3 laps + 1 (inclusive of the start) = 13 steps minimum
    expect(seq.length).toBeGreaterThanOrEqual(13)
  })

  it('only ever visits occupied seats', () => {
    const seq = buildSpinSequence([0, 3], 3)
    expect(seq.every((s) => s === 0 || s === 3)).toBe(true)
  })

  it('falls back to just the final seat when nobody is occupied (defensive)', () => {
    expect(buildSpinSequence([], 1)).toEqual([1])
  })
})

describe('completesRound — measured from whoever went first', () => {
  // Table order is 0 -> 2 -> 3 -> 1.
  const all = [0, 1, 2, 3] as const

  it('does not tick after one turn when someone other than seat 0 went first', () => {
    // Seat 1 went first and passes to seat 0: nobody else has had a turn yet.
    expect(completesRound(1, all, 1)).toBe(false)
    // The old head-of-the-ring measure got this wrong.
    expect(completesRound(1, all)).toBe(true)
  })

  it('ticks when the turn comes back round to the first player', () => {
    expect(completesRound(0, all, 1)).toBe(false)
    expect(completesRound(2, all, 1)).toBe(false)
    expect(completesRound(3, all, 1)).toBe(true)
  })

  it('ticks when the turn passes over a first player who is out', () => {
    // Seat 1 went first but is no longer in the rotation: 3 passes straight on to 0.
    expect(completesRound(3, [0, 2, 3], 1)).toBe(true)
    expect(completesRound(0, [0, 2, 3], 1)).toBe(false)
  })
})
