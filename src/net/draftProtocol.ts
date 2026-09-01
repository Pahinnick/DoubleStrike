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
import { isNonEmptyString, isSeat, isString, type Seat } from './protocol'

export type DraftConfigPayload = { cubeId: string; cubeName: string; packSize: number; packsPerPlayer: number }

/** Host -> all, cached: cube/pack-size info for the lobby, replayed to a late joiner. */
export type DraftConfigMessage = { type: 'DRAFT_CONFIG'; v: number; config: DraftConfigPayload }

/** Host -> all, cached: who's seated where, for the pre-game lobby roster — the regular VTT
 *  derives this from PublicBoard broadcasts instead, but draft's lobby has no boards yet. */
export type DraftRosterMessage = { type: 'DRAFT_ROSTER'; v: number; roster: Partial<Record<Seat, string>> }

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

export type DraftMessage =
  | DraftConfigMessage
  | DraftRosterMessage
  | DraftStartMessage
  | DraftPackMessage
  | DraftPickMessage
  | DraftPickRejectedMessage
  | DraftRoundCompleteMessage
  | DraftCompleteMessage
  | DraftProgressMessage

export type DraftParseResult = { ok: true; msg: DraftMessage } | { ok: false; reason: 'malformed' }

function isDraftConfigPayload(v: unknown): v is DraftConfigPayload {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return isNonEmptyString(c.cubeId) && isString(c.cubeName) && typeof c.packSize === 'number' && typeof c.packsPerPlayer === 'number'
}

function isSeatKeyedMap(v: unknown, isValue: (value: unknown) => boolean): boolean {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return Object.keys(m).every((key) => isSeat(Number(key)) && isValue(m[key]))
}

export function parseDraftMessage(m: Record<string, unknown>): DraftParseResult {
  switch (m.type) {
    case 'DRAFT_CONFIG':
      if (isDraftConfigPayload(m.config)) return { ok: true, msg: m as DraftConfigMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_ROSTER':
      if (isSeatKeyedMap(m.roster, isString)) return { ok: true, msg: m as DraftRosterMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_START':
      return { ok: true, msg: m as DraftStartMessage }
    case 'DRAFT_PACK':
      if (
        isNonEmptyString(m.toPlayerId) &&
        isNonEmptyString(m.packId) &&
        typeof m.round === 'number' &&
        Array.isArray(m.cards) &&
        m.cards.every(isString)
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
      if (typeof m.round === 'number') return { ok: true, msg: m as DraftRoundCompleteMessage }
      return { ok: false, reason: 'malformed' }
    case 'DRAFT_COMPLETE':
      return { ok: true, msg: m as DraftCompleteMessage }
    case 'DRAFT_PROGRESS':
      if (isSeatKeyedMap(m.picksBySeat, (v) => typeof v === 'number')) return { ok: true, msg: m as DraftProgressMessage }
      return { ok: false, reason: 'malformed' }
    default:
      return { ok: false, reason: 'malformed' }
  }
}
