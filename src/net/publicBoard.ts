/**
 * Derives the public snapshot broadcast to the pod from a client's own private
 * `GameState`. This is the one-way valve that keeps hidden information local:
 * only battlefield cards and life/poison/commander-damage totals cross the wire,
 * plus a *count* of the hand — never library or hand card identities, unless the
 * player explicitly opts in via GameState.revealHand (see below). A face-down
 * battlefield card (GameCard.faceDown) gets the same treatment as hand/library: its real
 * scryfallId is masked (see toPublicCard) until it's turned face up.
 *
 * Pure and unit-tested (see `publicBoard.test.ts`, which asserts no hand/library
 * scryfallId ever appears in the output).
 */
import type { GameState } from '../state/gameReducer'
import { maxCommanderDamage, zoneCards } from '../state/gameReducer'
import { FACE_DOWN_SCRYFALL_ID, type CounterPile, type PtCounterPile, type PublicBoard, type PublicCard, type PublicPileCard, type Seat } from './protocol'

export type LocalIdentity = {
  playerId: string
  name: string
  seat: Seat
  /** The sender's chosen playmat skin, so opponents can render your own choice in your quadrant
   *  instead of theirs — see useBattlefieldSkin.ts and PlaytestView's per-seat skin layers. */
  battlefieldSkin?: string
}

/**
 * Battlefield cards carry a position; a card that somehow lacks x/y (shouldn't
 * happen for a battlefield card, but the type allows it) defaults to 0,0 rather
 * than leaking `undefined` onto the wire.
 */
function toPublicCard(card: {
  instanceId: string
  scryfallId: string
  x?: number
  y?: number
  tapped: boolean
  counters?: CounterPile[]
  ptCounters?: PtCounterPile[]
  showBackFace?: boolean
  isToken?: boolean
  ownerSeat?: Seat
  faceDown?: boolean
  atSeat?: Seat
}): PublicCard {
  const pub: PublicCard = {
    instanceId: card.instanceId,
    // A face-down card's real identity never leaves this client — everyone else gets the
    // masked placeholder id instead, same privacy guarantee hand/library cards get.
    scryfallId: card.faceDown ? FACE_DOWN_SCRYFALL_ID : card.scryfallId,
    x: card.x ?? 0,
    y: card.y ?? 0,
    tapped: card.tapped,
  }
  // Only include optional fields when meaningful, keeping the wire payload small
  // and mirroring the sparse shape GameCard itself uses.
  if (card.counters && card.counters.length > 0) pub.counters = card.counters
  if (card.ptCounters && card.ptCounters.length > 0) pub.ptCounters = card.ptCounters
  if (card.showBackFace !== undefined) pub.showBackFace = card.showBackFace
  if (card.isToken) pub.isToken = true
  if (card.ownerSeat !== undefined) pub.ownerSeat = card.ownerSeat
  if (card.faceDown) pub.faceDown = true
  if (card.atSeat !== undefined) pub.atSeat = card.atSeat
  return pub
}

function toPublicPileCard(card: { instanceId: string; scryfallId: string; showBackFace?: boolean }): PublicPileCard {
  const pub: PublicPileCard = { instanceId: card.instanceId, scryfallId: card.scryfallId }
  if (card.showBackFace !== undefined) pub.showBackFace = card.showBackFace
  return pub
}

export function toPublicBoard(state: GameState, identity: LocalIdentity): PublicBoard {
  const board: PublicBoard = {
    playerId: identity.playerId,
    name: identity.name,
    seat: identity.seat,
    life: state.life,
    // The wire carries the worst single-source total (what the 21-is-lethal rule
    // cares about); the per-source breakdown stays local to the owner.
    commanderDamage: maxCommanderDamage(state.commanderDamage),
    poison: state.poison,
    // Count only — the actual hand cards never leave this client.
    handCount: zoneCards(state, 'hand').length,
    battlefield: zoneCards(state, 'battlefield').map(toPublicCard),
    // Graveyard/exile/command are public zones, so their contents are shared in full.
    graveyard: zoneCards(state, 'graveyard').map(toPublicPileCard),
    exile: zoneCards(state, 'exile').map(toPublicPileCard),
    command: zoneCards(state, 'command').map(toPublicPileCard),
  }
  // Deliberate, opt-in exception to the hand's usual privacy — same masked-by-default pattern as
  // face-down cards, just inverted: only sent while the player has explicitly toggled it on.
  if (state.revealHand) board.hand = zoneCards(state, 'hand').map(toPublicPileCard)
  if (identity.battlefieldSkin) board.battlefieldSkin = identity.battlefieldSkin
  if (state.scooped) board.scooped = true
  return board
}
