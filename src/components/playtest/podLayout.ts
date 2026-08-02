/**
 * Seat-quadrant geometry for the shared multiplayer table.
 *
 * Four battlefields sit on one virtual table: a 2×2 grid of quadrants, each the
 * size of the solo battlefield (`CANVAS_W × CANVAS_H`). Card positions stay
 * seat-relative (0..CANVAS_W × 0..CANVAS_H) on the wire and in game state; the
 * renderer just offsets a seat's cards by its quadrant origin.
 *
 * Pure — no React — so it's unit-testable like `src/engine/*`.
 */
import { HOST_SEAT, type Seat } from '../../net/protocol'

export const ALL_SEATS: readonly Seat[] = [0, 1, 2, 3]

/** A Magic color per seat, reusing the app's mana-color theme variables. */
export const SEAT_COLORS: Record<Seat, string> = {
  0: 'var(--color-r)', // Red
  1: 'var(--color-u)', // Blue
  2: 'var(--color-w)', // White
  3: 'var(--color-g)', // Green
}

export const SEAT_COLOR_NAMES: Record<Seat, string> = {
  0: 'Red',
  1: 'Blue',
  2: 'White',
  3: 'Green',
}

/**
 * Which quadrant each seat occupies. Seat 0 (you, and the host by default) is
 * bottom-left; the rest fill across and up. `col`/`row` are 0-based from the
 * table's top-left.
 */
export const SEAT_GRID: Record<Seat, { col: 0 | 1; row: 0 | 1 }> = {
  0: { col: 0, row: 1 }, // bottom-left
  1: { col: 1, row: 1 }, // bottom-right
  2: { col: 0, row: 0 }, // top-left
  3: { col: 1, row: 0 }, // top-right
}

/** Top-left corner of a seat's quadrant in table (surface) space, in canvas pixels. */
export function seatOrigin(seat: Seat, canvasW: number, canvasH: number): { x: number; y: number } {
  const { col, row } = SEAT_GRID[seat]
  return { x: col * canvasW, y: row * canvasH }
}

/** Full table dimensions for a 2×2 pod. */
export function tableSize(canvasW: number, canvasH: number): { width: number; height: number } {
  return { width: canvasW * 2, height: canvasH * 2 }
}

/** Clockwise turn order around the actual table edges: bottom-left → top-left → top-right
 *  → bottom-right → bottom-left. Raw seat-number order (0,1,2,3) would jump diagonally
 *  across the table between seats 1 and 2 instead of passing to the adjacent seat. */
export const TURN_ORDER: readonly Seat[] = [0, 2, 3, 1]

/** Next seat clockwise among those currently occupied, for Pass Turn. Starts the ring at
 *  the first occupied seat (table order) if there's no current active seat, or it's since
 *  left the pod. Callers gate who may invoke this to the active seat's own player. */
export function nextActiveSeat(current: Seat | null, occupiedSeats: readonly Seat[]): Seat {
  const ring = TURN_ORDER.filter((seat) => occupiedSeats.includes(seat))
  if (ring.length === 0) return current ?? HOST_SEAT
  if (current === null) return ring[0]
  const idx = ring.indexOf(current)
  return idx === -1 ? ring[0] : ring[(idx + 1) % ring.length]
}

/** Uniformly random seat among those occupied, for "who goes first". */
export function pickRandomSeat(occupiedSeats: readonly Seat[]): Seat {
  return occupiedSeats[Math.floor(Math.random() * occupiedSeats.length)]
}

/**
 * The sequence of seats to flash through for a "spin the wheel" animation, ending exactly
 * on `finalSeat` — caller drives the actual timing (see PlaytestView's handleRandomizeStart).
 * Walks the table-order ring for `extraLoops` full laps plus however many extra steps are
 * needed to land on `finalSeat`, so the spin always completes at least `extraLoops` laps
 * regardless of how close `finalSeat` happens to be.
 */
export function buildSpinSequence(occupiedSeats: readonly Seat[], finalSeat: Seat, extraLoops = 3): Seat[] {
  const ring = TURN_ORDER.filter((seat) => occupiedSeats.includes(seat))
  if (ring.length === 0) return [finalSeat]
  const finalIdx = ring.indexOf(finalSeat)
  const stepsToFinal = finalIdx === -1 ? 0 : finalIdx
  const totalSteps = ring.length * extraLoops + stepsToFinal
  const sequence: Seat[] = []
  for (let i = 0; i <= totalSteps; i++) {
    sequence.push(ring[i % ring.length])
  }
  return sequence
}
