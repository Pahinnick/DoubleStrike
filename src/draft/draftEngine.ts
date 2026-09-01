import { TURN_ORDER } from '../components/playtest/podLayout'
import type { Seat } from '../net/protocol'
import { buildPacks } from './packBuilder'
import type { CubeCard, DraftConfig, DraftPackState } from './types'

/** The host's authoritative view of an in-progress draft — see applyPick's doc for why this
 *  lives entirely on the host rather than being replicated. Pool contents here are bookkeeping
 *  only (for progress/resume), never broadcast wholesale — see draftProtocol.ts's privacy note. */
export type DraftEngineState = {
  config: DraftConfig
  occupiedSeats: readonly Seat[]
  packsById: Record<string, DraftPackState>
  poolsBySeat: Partial<Record<Seat, string[]>>
  picksBySeat: Partial<Record<Seat, number>>
}

/** Builds every round's packs up front (one shuffle) — draft mode requires exactly 4 seated
 *  players (confirmed scope), so packBuilder's 0..playerCount-1 pack-seat indices line up
 *  directly with real Seat numbers, needing no remapping. Deals nothing yet; the caller sends
 *  round 0's packs (via `packsForRound(state, 0)`) once ready. */
export function initDraftEngine(cubeCards: CubeCard[], config: DraftConfig, occupiedSeats: readonly Seat[], random?: () => number): DraftEngineState {
  const rounds = buildPacks(cubeCards, { packSize: config.packSize, packsPerPlayer: config.packsPerPlayer, playerCount: occupiedSeats.length }, random)
  const packsById: Record<string, DraftPackState> = {}
  for (const round of rounds) {
    for (const pack of round) packsById[pack.packId] = pack
  }
  return { config, occupiedSeats, packsById, poolsBySeat: {}, picksBySeat: {} }
}

/** Real-draft convention: pack 1 passes one way around the table, pack 2 the other way,
 *  alternating every round. */
export function passDirection(round: number): 1 | -1 {
  return round % 2 === 0 ? 1 : -1
}

/** Next seat around the table from `current`, in `passDirection(round)`'s direction — "pass
 *  left" literally means "advance along the pod's existing seating ring" (podLayout's
 *  TURN_ORDER), not a second ordering concept invented for draft mode. */
export function nextHolder(current: Seat, round: number, occupiedSeats: readonly Seat[]): Seat {
  const ring = TURN_ORDER.filter((seat) => occupiedSeats.includes(seat))
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
