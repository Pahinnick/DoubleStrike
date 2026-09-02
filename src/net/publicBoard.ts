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
import { zoneCards } from '../state/gameReducer'
import { MANA_COLOR_KEYS, type ManaColorKey } from '../utils/colors'
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

/** Same as toPublicPileCard, but masks scryfallId behind FACE_DOWN_SCRYFALL_ID when the card is
 *  currently face down — a commander card is otherwise shared regardless of zone (see
 *  PublicBoard.commanders' doc), but a face-down permanent still deserves the same hidden-
 *  identity treatment every other face-down battlefield card gets (see toPublicCard). */
function toPublicCommander(card: { instanceId: string; scryfallId: string; showBackFace?: boolean; faceDown?: boolean }): PublicPileCard {
  const pub: PublicPileCard = {
    instanceId: card.instanceId,
    scryfallId: card.faceDown ? FACE_DOWN_SCRYFALL_ID : card.scryfallId,
  }
  if (card.showBackFace !== undefined) pub.showBackFace = card.showBackFace
  return pub
}

/** Strips zero-value colors — same sparse convention as counters/ptCounters — and returns
 *  undefined instead of an empty object once nothing's floating, so the field can be omitted
 *  from the wire payload entirely rather than sent as `{}`. */
function toPublicFloatingMana(mana: Record<ManaColorKey, number>): Partial<Record<ManaColorKey, number>> | undefined {
  const sparse: Partial<Record<ManaColorKey, number>> = {}
  for (const color of MANA_COLOR_KEYS) {
    if (mana[color] > 0) sparse[color] = mana[color]
  }
  return Object.keys(sparse).length > 0 ? sparse : undefined
}

/** Reshapes the locally-tracked per-source damage (keyed by source seat, including solo's
 *  synthetic SOLO_CMDR_SOURCE key) into the sparse, Seat-only shape PublicBoard sends — real
 *  Commander rules make each source's damage against you public, not just your worst single
 *  total, so every seat overlay (not just your own) can show one dot per source. */
function toPublicCommanderDamage(commanderDamage: Record<number, number>): Partial<Record<Seat, number>> {
  const sparse: Partial<Record<Seat, number>> = {}
  for (const [key, value] of Object.entries(commanderDamage)) {
    const seat = Number(key)
    if (value > 0 && (seat === 0 || seat === 1 || seat === 2 || seat === 3)) sparse[seat] = value
  }
  return sparse
}

export function toPublicBoard(state: GameState, identity: LocalIdentity): PublicBoard {
  const board: PublicBoard = {
    playerId: identity.playerId,
    name: identity.name,
    seat: identity.seat,
    life: state.life,
    // The reference point opponents' life *bars* fill against (see SeatOverlay) — Commander's
    // usual 40, but not necessarily (a non-Commander format starts at 20/25/30).
    startingLife: state.startingLife,
    commanderDamage: toPublicCommanderDamage(state.commanderDamage),
    poison: state.poison,
    // Count only — the actual hand cards never leave this client.
    handCount: zoneCards(state, 'hand').length,
    battlefield: zoneCards(state, 'battlefield').map(toPublicCard),
    // Graveyard/exile/command are public zones, so their contents are shared in full.
    graveyard: zoneCards(state, 'graveyard').map(toPublicPileCard),
    exile: zoneCards(state, 'exile').map(toPublicPileCard),
    command: zoneCards(state, 'command').map(toPublicPileCard),
    // Fixed commander identity, independent of current zone — see PublicBoard.commanders' doc.
    commanders: state.cards.filter((c) => c.isCommander).map(toPublicCommander),
  }
  // Deliberate, opt-in exception to the hand's usual privacy — same masked-by-default pattern as
  // face-down cards, just inverted: only sent while the player has explicitly toggled it on.
  if (state.revealHand) board.hand = zoneCards(state, 'hand').map(toPublicPileCard)
  // Same opt-in shape for the library's top card — the PUBLIC "play with the top card revealed"
  // effect. Its private sibling (GameState.revealTopOfLibrary, "you may look at the top card any
  // time") is deliberately absent here: that one shows the card to its owner only and must never
  // reach the wire. An empty library simply has no top card to share.
  if (state.revealTopToPod) {
    const top = zoneCards(state, 'library')[0]
    if (top) board.topOfLibrary = toPublicPileCard(top)
  }
  if (identity.battlefieldSkin) board.battlefieldSkin = identity.battlefieldSkin
  if (state.scooped) board.scooped = true
  const floatingMana = toPublicFloatingMana(state.floatingMana)
  if (floatingMana) board.floatingMana = floatingMana
  return board
}
