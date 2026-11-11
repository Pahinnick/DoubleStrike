import { DRAFT_SEAT_ORDER, type Seat } from '../net/protocol'
import type { DraftConfig, DraftPackState } from './types'

/** The seating ring packs travel around: seat 1 → 2 → … → 6, the order the lobby lists them, so
 *  "pass left" always means "to the next seat down the list" (and back up for pack 2). */
export const DRAFT_TABLE_ORDER: readonly Seat[] = DRAFT_SEAT_ORDER

/** Draft rooms are three 1v1 tables of two seats: 0-1, 2-3, 4-5. */
export const DRAFT_TABLE_COUNT = 3

export function draftTableOf(seat: Seat): number {
  return Math.floor(seat / 2)
}

/** The seat you'll play against after the draft — the other seat at your table. */
export function opponentSeatOf(seat: Seat): Seat {
  return (seat % 2 === 0 ? seat + 1 : seat - 1) as Seat
}

/** Seats in table order — use this anywhere seats are listed for the players. */
export function seatsInTableOrder(seats: readonly Seat[]): Seat[] {
  return DRAFT_TABLE_ORDER.filter((seat) => seats.includes(seat))
}

/** The host's authoritative view of an in-progress draft — see applyPick's doc for why this
 *  lives entirely on the host rather than being replicated. Pool contents here are bookkeeping
 *  only (for progress/resume), never broadcast wholesale — see draftProtocol.ts's privacy note. */
export type DraftEngineState = {
  config: DraftConfig
  occupiedSeats: readonly Seat[]
  packsById: Record<string, DraftPackState>
  poolsBySeat: Partial<Record<Seat, string[]>>
  picksBySeat: Partial<Record<Seat, number>>
  /** Solo drafts only: per round, the packs handed to the lone drafter after each pick, in order —
   *  fresh packs already cut down to one card fewer each time (see packBuilder's solo builders),
   *  standing in for the packs other drafters would have passed. Not in `packsById` until handed out. */
  soloReserve?: Record<number, DraftPackState[]>
}

/** Takes every round's packs, already built up front (cube: one shuffle; set: opened boosters —
 *  see packBuilder.ts / boosters.ts), for 2-5 seated players. Deals nothing yet; the caller sends
 *  round 0's packs (via `packsForRound(state, 0)`) once ready. */
export function initDraftEngine(
  rounds: DraftPackState[][],
  config: DraftConfig,
  occupiedSeats: readonly Seat[],
  soloReserve?: DraftPackState[][],
): DraftEngineState {
  const packsById: Record<string, DraftPackState> = {}
  for (const round of rounds) {
    for (const pack of round) packsById[pack.packId] = pack
  }
  const state: DraftEngineState = { config, occupiedSeats, packsById, poolsBySeat: {}, picksBySeat: {} }
  if (soloReserve && occupiedSeats.length === 1) {
    state.soloReserve = Object.fromEntries(soloReserve.map((packs, round) => [round, packs]))
  }
  return state
}

/** Real-draft convention: pack 1 passes one way around the table, pack 2 the other way,
 *  alternating every round. */
export function passDirection(round: number): 1 | -1 {
  return round % 2 === 0 ? 1 : -1
}

/** Next seat around the table from `current`, in `passDirection(round)`'s direction, along
 *  DRAFT_TABLE_ORDER restricted to the seats actually drafting. */
export function nextHolder(current: Seat, round: number, occupiedSeats: readonly Seat[]): Seat {
  const ring = seatsInTableOrder(occupiedSeats)
  const idx = ring.indexOf(current)
  const nextIndex = (idx + passDirection(round) + ring.length) % ring.length
  return ring[nextIndex]
}

export type ApplyPickResult =
  | { ok: true; nextState: DraftEngineState; round: number; passedTo?: { pack: DraftPackState; toSeat: Seat } }
  | { ok: false; reason: string }

/**
 * The host's sole mutation point for a pick: validates the picker actually holds this exact
 * pack and it actually contains this card, moves the card into their pool, and either passes
 * the now-smaller pack to the next seat or retires it (last card taken). Never decides a
 * *round* is complete — that's `isRoundComplete`'s job, checked by the caller (useDraftSession)
 * right after, since "all packs of this round are gone" can only be known globally, not from
 * one pick alone.
 */
export function applyPick(state: DraftEngineState, packId: string, scryfallId: string, pickerSeat: Seat): ApplyPickResult {
  const pack = state.packsById[packId]
  if (!pack) return { ok: false, reason: 'That pack is no longer in play.' }
  if (pack.holderSeat !== pickerSeat) return { ok: false, reason: "You aren't holding that pack." }
  // Later rounds' packs are dealt (holderSeat set) at the start but stay sealed until their round.
  if (pack.round !== activeRound(state)) return { ok: false, reason: "That pack hasn't been opened yet." }
  const cardIndex = pack.cards.indexOf(scryfallId)
  if (cardIndex === -1) return { ok: false, reason: "That card isn't in this pack." }

  const remainingCards = [...pack.cards.slice(0, cardIndex), ...pack.cards.slice(cardIndex + 1)]
  const pool = [...(state.poolsBySeat[pickerSeat] ?? []), scryfallId]
  const picks = (state.picksBySeat[pickerSeat] ?? 0) + 1
  const poolsBySeat = { ...state.poolsBySeat, [pickerSeat]: pool }
  const picksBySeat = { ...state.picksBySeat, [pickerSeat]: picks }

  if (remainingCards.length === 0) {
    const packsById = { ...state.packsById }
    delete packsById[packId]
    return { ok: true, nextState: { ...state, packsById, poolsBySeat, picksBySeat }, round: pack.round }
  }

  // Solo: instead of getting the same pack straight back, the lone drafter is handed the next
  // reserve pack — as if a neighbor had passed it, with the cards they'd have taken already gone.
  const reserve = state.soloReserve?.[pack.round]
  if (reserve && reserve.length > 0) {
    const [next, ...rest] = reserve
    const handed: DraftPackState = { ...next, holderSeat: pickerSeat }
    const packsById = { ...state.packsById, [handed.packId]: handed }
    delete packsById[packId]
    const soloReserve = { ...state.soloReserve, [pack.round]: rest }
    return {
      ok: true,
      nextState: { ...state, packsById, poolsBySeat, picksBySeat, soloReserve },
      round: pack.round,
      passedTo: { pack: handed, toSeat: pickerSeat },
    }
  }

  const toSeat = nextHolder(pickerSeat, pack.round, state.occupiedSeats)
  const passedPack: DraftPackState = { ...pack, cards: remainingCards, holderSeat: toSeat }
  const packsById = { ...state.packsById, [packId]: passedPack }
  return { ok: true, nextState: { ...state, packsById, poolsBySeat, picksBySeat }, round: pack.round, passedTo: { pack: passedPack, toSeat } }
}

/** True once every pack belonging to `round` has been fully picked through. */
export function isRoundComplete(state: DraftEngineState, round: number): boolean {
  return !Object.values(state.packsById).some((pack) => pack.round === round)
}

/** True once every pack in the whole draft has been fully picked through. */
export function isDraftComplete(state: DraftEngineState): boolean {
  return Object.keys(state.packsById).length === 0
}

/** Every still-live pack belonging to `round`, in their original per-seat deal — used to send
 *  out a fresh round's packs once the previous one wraps (see useDraftSession). */
export function packsForRound(state: DraftEngineState, round: number): DraftPackState[] {
  return Object.values(state.packsById).filter((pack) => pack.round === round)
}

/** The round being drafted now — the earliest one with packs left (rounds finish in order). Null
 *  once the draft is over. */
export function activeRound(state: DraftEngineState): number | null {
  let round: number | null = null
  for (const pack of Object.values(state.packsById)) {
    if (round === null || pack.round < round) round = pack.round
  }
  return round
}

/** Every pack of the round in play that `seat` is holding — what a reconnecting player gets back
 *  (see DraftResumeMessage), and what a host picking for an absent player works through. Later
 *  rounds' packs are dealt up front (holderSeat already set) but aren't opened until their round
 *  starts, so they're never included. */
export function packsHeldBy(state: DraftEngineState, seat: Seat): DraftPackState[] {
  const round = activeRound(state)
  return Object.values(state.packsById).filter((pack) => pack.round === round && pack.holderSeat === seat)
}
