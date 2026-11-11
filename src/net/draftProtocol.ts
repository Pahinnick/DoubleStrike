/**
 * Draft-mode wire messages — sibling to protocol.ts, folded into its NetMessage union (see
 * protocol.ts's parseMessage default case). Kept in its own file so protocol.ts's already-large,
 * live-tested VTT surface stays untouched while draft mode is unfinished (see the feature flag
 * in src/config/featureFlags.ts).
 *
 * Host-authoritative pack circulation: pack contents are only legitimate for whoever currently
 * holds that pack, so — unlike PublicBoard — nothing here broadcasts a pack's contents to
 * everyone. Picking is asynchronous per player (real draft: pick and pass the instant you're
 * ready, no lockstep), which maps directly onto this app's existing directed-message convention
 * (GIVE_CARD/RELOCATE_CARD/etc., guest->host->target).
 */
import type { DraftConfig, DraftSource } from '../draft/types'
import { MAX_ZONE_CARDS, isBoundedArray, isFiniteNumber, isNonEmptyString, isSeat, isString, isValidRoomCode, type Seat } from './protocol'

/** Same shape as the host's own DraftConfig — the pack source (cube or set) plus pack settings. */
export type DraftConfigPayload = DraftConfig

/** Host -> all, cached: cube/pack-size info for the lobby, replayed to a late joiner. */
export type DraftConfigMessage = { type: 'DRAFT_CONFIG'; v: number; config: DraftConfigPayload }

/** Host -> all, cached: who's seated where, for the pre-game lobby roster — the regular VTT
 *  derives this from PublicBoard broadcasts instead, but draft's lobby has no boards yet. */
export type DraftRosterMessage = { type: 'DRAFT_ROSTER'; v: number; roster: Partial<Record<Seat, string>> }

/** Guest -> host, lobby only: "move me to this open seat" — draft rooms are three 1v1 tables, so
 *  players pick who they sit with. The host answers with a fresh WELCOME (the new seat) plus a
 *  DRAFT_ROSTER, or ignores it if the seat is taken or the draft has started. */
export type DraftSeatRequestMessage = { type: 'DRAFT_SEAT_REQUEST'; v: number; seat: Seat }

/** Host -> all: lobby -> drafting transition; the host follows this with each seat's round-1 pack. */
export type DraftStartMessage = { type: 'DRAFT_START'; v: number }

/** Host -> one seat: deliver the pack this seat now holds (fresh deal, or passed along by a
 *  neighbor's pick). */
export type DraftPackMessage = { type: 'DRAFT_PACK'; v: number; toPlayerId: string; packId: string; round: number; cards: string[] }

/** Guest/host -> host only: pick a card from the currently-held pack. No `toPlayerId` — unlike
 *  every other directed message here, the implicit recipient is always the host-as-arbiter. */
export type DraftPickMessage = { type: 'DRAFT_PICK'; v: number; packId: string; scryfallId: string }

/** Host -> picker: defensive only — e.g. a stale double-click picking from a pack that's
 *  already moved on. */
export type DraftPickRejectedMessage = { type: 'DRAFT_PICK_REJECTED'; v: number; toPlayerId: string; packId: string; reason: string }

/** Host -> all: every pack in this round has been fully picked through. */
export type DraftRoundCompleteMessage = { type: 'DRAFT_ROUND_COMPLETE'; v: number; round: number }

/** Host -> all: every round is done; move to deck-building. Pool contents never cross the wire
 *  here — same privacy posture as hands/libraries elsewhere in this protocol. */
export type DraftCompleteMessage = { type: 'DRAFT_COMPLETE'; v: number }

/** Host -> all: sparse seat->pick-count map, so a "waiting on Seat 3…" UI can render without
 *  leaking anyone's pack/pool contents (same sparse convention as PublicBoard.commanderDamage). */
export type DraftProgressMessage = { type: 'DRAFT_PROGRESS'; v: number; picksBySeat: Partial<Record<Seat, number>> }

/** Host -> one returning player: everything they need to pick up where they left off after a
 *  dropped connection, a refreshed tab or an app restart — the packs they now hold (including any
 *  passed to them while they were away) and their whole pool so far (including anything the host
 *  auto-picked for them). Replaces the guest's local draft state wholesale rather than patching
 *  it, since a guest that was away can't know which of its own sends never arrived. `roster` is
 *  everyone seated when the draft began, so players who are still away keep their place in it. */
export type DraftResumeMessage = {
  type: 'DRAFT_RESUME'
  v: number
  toPlayerId: string
  config: DraftConfigPayload
  phase: 'drafting' | 'complete'
  pool: string[]
  packs: { packId: string; round: number; cards: string[] }[]
  picksBySeat: Partial<Record<Seat, number>>
  roster: Partial<Record<Seat, string>>
}

/** Host -> all: which drafting seats have lost their connection (`away`), and which of those the
 *  host is now picking for (`autoPicking`) so the other seats' packs keep moving. */
export type DraftPresenceMessage = { type: 'DRAFT_PRESENCE'; v: number; away: Seat[]; autoPicking: Seat[] }

/** Where a drafter is in the post-draft event: building/adjusting their deck, at the game table
 *  waiting for `opponentSeat` (or for nobody yet), or playing `opponentSeat`. */
export type DraftMatchState = 'building' | 'waiting' | 'playing'
/** `room`: the game-table room code this player is in (waiting/playing), so anyone picking them
 *  joins that same room — taking the open seat, or waiting in the room for one if both are taken
 *  — instead of both having to move to a fresh room for the pair. Absent while building. */
export type DraftMatchStatus = { state: DraftMatchState; opponentSeat: Seat | null; room?: string }

/** Guest/host -> host: "this is what I'm doing now" — after the draft, so everyone can see who's
 *  free, who's waiting for them at the table, and who's mid-match. */
export type DraftMatchStatusMessage = { type: 'DRAFT_MATCH_STATUS'; v: number; status: DraftMatchStatus }

/** Host -> all: everyone's latest match status, by seat. */
export type DraftMatchesMessage = { type: 'DRAFT_MATCHES'; v: number; statuses: Partial<Record<Seat, DraftMatchStatus>> }

export type DraftMessage =
  | DraftConfigMessage
  | DraftRosterMessage
  | DraftSeatRequestMessage
  | DraftStartMessage
  | DraftPackMessage
  | DraftPickMessage
  | DraftPickRejectedMessage
  | DraftRoundCompleteMessage
  | DraftCompleteMessage
  | DraftProgressMessage
  | DraftResumeMessage
  | DraftPresenceMessage
  | DraftMatchStatusMessage
  | DraftMatchesMessage

export type DraftParseResult = { ok: true; msg: DraftMessage } | { ok: false; reason: 'malformed' }

function isDraftSource(v: unknown): v is DraftSource {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  if (!isString(s.name)) return false
  if (s.kind === 'cube') return isNonEmptyString(s.cubeId)
  if (s.kind === 'set') return isNonEmptyString(s.setCode) && (s.boosterType === 'play' || s.boosterType === 'draft' || s.boosterType === 'classic')
  return false
}

function isDraftConfigPayload(v: unknown): v is DraftConfigPayload {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return isDraftSource(c.source) && isFiniteNumber(c.packSize) && isFiniteNumber(c.packsPerPlayer)
}

function isSeatKeyedMap(v: unknown, isValue: (value: unknown) => boolean): boolean {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return Object.keys(m).every((key) => isSeat(Number(key)) && isValue(m[key]))
}

function isSeatArray(v: unknown): v is Seat[] {
  return Array.isArray(v) && v.every(isSeat)
}

function isMatchStatus(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    (s.state === 'building' || s.state === 'waiting' || s.state === 'playing') &&
    (s.opponentSeat === null || isSeat(s.opponentSeat)) &&
    (s.room === undefined || (isString(s.room) && isValidRoomCode(s.room)))
  )
}

function isResumePack(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return isNonEmptyString(p.packId) && isFiniteNumber(p.round) && isBoundedArray(p.cards, MAX_ZONE_CARDS, isNonEmptyString)
}

export function parseDraftMessage(m: Record<string, unknown>): DraftParseResult {
  switch (m.type) {
    case 'DRAFT_CONFIG':
      if (isDraftConfigPayload(m.config)) return { ok: true, msg: m as DraftConfigMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_ROSTER':
      if (isSeatKeyedMap(m.roster, isString)) return { ok: true, msg: m as DraftRosterMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_SEAT_REQUEST':
      if (isSeat(m.seat)) return { ok: true, msg: m as DraftSeatRequestMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_START':
      return { ok: true, msg: m as DraftStartMessage }
    case 'DRAFT_PACK':
      if (
        isNonEmptyString(m.toPlayerId) &&
        isNonEmptyString(m.packId) &&
        isFiniteNumber(m.round) &&
        isBoundedArray(m.cards, MAX_ZONE_CARDS, isNonEmptyString)
      ) {
        return { ok: true, msg: m as DraftPackMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_PICK':
      if (isNonEmptyString(m.packId) && isNonEmptyString(m.scryfallId)) return { ok: true, msg: m as DraftPickMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_PICK_REJECTED':
      if (isNonEmptyString(m.toPlayerId) && isNonEmptyString(m.packId) && isString(m.reason)) {
        return { ok: true, msg: m as DraftPickRejectedMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_ROUND_COMPLETE':
      if (isFiniteNumber(m.round)) return { ok: true, msg: m as DraftRoundCompleteMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_COMPLETE':
      return { ok: true, msg: m as DraftCompleteMessage }
    case 'DRAFT_PROGRESS':
      if (isSeatKeyedMap(m.picksBySeat, (v) => isFiniteNumber(v))) return { ok: true, msg: m as DraftProgressMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_RESUME':
      if (
        isNonEmptyString(m.toPlayerId) &&
        isDraftConfigPayload(m.config) &&
        (m.phase === 'drafting' || m.phase === 'complete') &&
        isBoundedArray(m.pool, MAX_ZONE_CARDS, isString) &&
        Array.isArray(m.packs) &&
        m.packs.length <= 50 &&
        m.packs.every(isResumePack) &&
        isSeatKeyedMap(m.picksBySeat, (v) => isFiniteNumber(v)) &&
        isSeatKeyedMap(m.roster, isString)
      ) {
        return { ok: true, msg: m as DraftResumeMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_PRESENCE':
      if (isSeatArray(m.away) && isSeatArray(m.autoPicking)) return { ok: true, msg: m as DraftPresenceMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_MATCH_STATUS':
      if (isMatchStatus(m.status)) return { ok: true, msg: m as DraftMatchStatusMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_MATCHES':
      if (isSeatKeyedMap(m.statuses, isMatchStatus)) return { ok: true, msg: m as DraftMatchesMessage }
      return { ok: false, reason: 'malformed' }
    default:
      return { ok: false, reason: 'malformed' }
  }
}
