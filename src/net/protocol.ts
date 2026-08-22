/**
 * Wire protocol for the multiplayer VTT ("give a friend a code").
 *
 * Pure types + serialization + routing/seat helpers — no I/O, no PeerJS, no
 * React. Unit-tested like `src/engine/*`. The live PeerJS plumbing that *uses*
 * this lives in `peerConnection.ts`.
 *
 * Design: snapshot-based sync (see the plan doc,
 * `.claude/plans/lets-assume-we-have-synchronous-lake.md`). Each client
 * broadcasts its whole *public* board on change; receivers replace that
 * player's mirror wholesale. Every STATE message is therefore a full resync,
 * which is what makes the protocol idempotent, order-independent and
 * self-healing after a dropped packet or a late join.
 */
import { MANA_COLOR_KEYS, type ManaColorKey } from '../utils/colors'

/** Bump when the wire shape changes incompatibly. Receivers reject other versions.
 *  v2: PublicBoard.commanderDamage changed from a single number (worst single source) to a
 *  per-source record keyed by seat — an incompatible shape change, unlike every other field
 *  added to PublicBoard so far (those were purely additive/optional). */
export const PROTOCOL_VERSION = 2

/** 4-player Commander pod. Seats are 0..3; the host always takes seat 0. */
export const MAX_PLAYERS = 4
export const HOST_SEAT = 0

export type Seat = 0 | 1 | 2 | 3

/** A visual tag for a counter pile — either a player-chosen generic color (not tied to Magic color
 *  identity, just a way to tell independent piles on the same card apart, e.g. a green +1/+1-style
 *  pile vs a black poison-style pile) or one of the curated keyword-ability kinds (flying,
 *  deathtouch, etc. — see counterFormat's KEYWORD_COUNTERS) used to mark a card as having gained
 *  that ability. Both live in the same id space so a pile's identity and its display swatch are
 *  always the same lookup. */
export type CounterColor =
  | 'green'
  | 'red'
  | 'blue'
  | 'black'
  | 'gold'
  | 'colorless'
  | 'flying'
  | 'firststrike'
  | 'doublestrike'
  | 'deathtouch'
  | 'trample'
  | 'vigilance'
  | 'lifelink'
  | 'hexproof'
  | 'indestructible'
  | 'menace'
  | 'reach'
  | 'haste'

/** An independent generic counter pile (loyalty, charge, poison, etc.) — a card can carry several
 *  of these at once, each its own color and signed running total. */
export type CounterPile = { id: string; color: CounterColor; value: number }

/** An independent power/toughness counter pile (e.g. a +1/+1 or -1/-1 stack) — power and toughness
 *  move together within a pile, but a card can carry several differently-colored piles at once. */
export type PtCounterPile = { id: string; color: CounterColor; power: number; toughness: number }

/**
 * A single battlefield card as seen by everyone else. Carries only public facts —
 * never anything about hand or library contents.
 *
 * `x`/`y` are in the same units as `GameCard.x`/`y` — canvas-space pixels within
 * a single battlefield (0..CANVAS_W × 0..CANVAS_H, see `PlaytestView`) — and stay
 * **seat-relative**: a board looks the same regardless of which quadrant the
 * receiver renders it into, so the broadcast is seat-agnostic and the renderer
 * just offsets by the quadrant origin.
 */
export type PublicCard = {
  instanceId: string
  /** Masked to FACE_DOWN_SCRYFALL_ID when faceDown is true — real identity never crosses the
   *  wire to anyone but the controller while a card is face down (see toPublicCard). */
  scryfallId: string
  x: number
  y: number
  tapped: boolean
  counters?: CounterPile[]
  ptCounters?: PtCounterPile[]
  showBackFace?: boolean
  isToken?: boolean
  /** Seat of the owning player, when the current controller isn't the owner (a given card). */
  ownerSeat?: Seat
  /** Played (or turned) face down — see GameCard.faceDown. When true, scryfallId above is a
   *  masked placeholder, not the real card. */
  faceDown?: boolean
  /** Quadrant this card currently renders in, when someone has dragged it onto a DIFFERENT
   *  seat's battlefield than its owner's own (the "move any card anywhere" feature) — see
   *  RelocateCardMessage. Undefined means the card's owner's own seat, the common case: a
   *  card's x/y stay seat-relative (see the type doc above) regardless of atSeat, so the
   *  renderer offsets by `seatOrigin(atSeat ?? board.seat)` instead of always `board.seat`. */
  atSeat?: Seat
}

/** Placeholder scryfallId sent in place of a face-down card's real identity — never a real
 *  Scryfall id, so it can never accidentally resolve to real card art/text on a receiver's
 *  client. Receivers must render a generic card-back for any PublicCard with faceDown true,
 *  never attempt to fetch/display art for this id. */
export const FACE_DOWN_SCRYFALL_ID = 'face-down'

/**
 * A card in a public pile (graveyard/exile) — no board position, just identity.
 * These zones are open information in Magic, so sharing their contents is safe
 * (unlike hand/library, which never leave the owner).
 */
export type PublicPileCard = {
  instanceId: string
  scryfallId: string
  showBackFace?: boolean
}

/**
 * The full public snapshot a client broadcasts on every change. Receivers keep a
 * `Map<playerId, PublicBoard>` and replace an entry wholesale on each STATE.
 *
 * `handCount` is a count only — the actual hand cards never leave the owner.
 * `graveyard`/`exile` are optional (older/partial senders may omit them) and
 * carry full contents since those zones are public.
 */
export type PublicBoard = {
  playerId: string
  name: string
  seat: Seat
  life: number
  /** Starting life for this player's format (e.g. 40 for Commander, 20 for most others) — the
   *  reference point a life *bar* fills against (see SeatOverlay), not just the raw number a
   *  chip would show. Optional so an older sender simply falls back to the Commander default
   *  (see SeatOverlay's own fallback) rather than failing validation. */
  startingLife?: number
  /** Commander damage taken, keyed by the *seat* whose commander dealt it — real Commander
   *  rules make each source's damage against you public knowledge (visible on a real table),
   *  not just your worst single total, so seat overlays can show one dot per source the same
   *  way for every player, not just your own. Sparse: a source dealing 0 is omitted, same
   *  convention as counters/floatingMana. */
  commanderDamage: Partial<Record<Seat, number>>
  poison: number
  handCount: number
  battlefield: PublicCard[]
  graveyard?: PublicPileCard[]
  exile?: PublicPileCard[]
  /** The command zone is public knowledge at a real table (your commander sits face-up), so —
   *  like graveyard/exile — its full contents are shared, letting opponents' clients show whose
   *  commander is whose next to their nameplate. */
  command?: PublicPileCard[]
  /** Deliberate, opt-in exception to the hand's usual privacy: present only while the sender has
   *  "reveal hand" toggled on (GameState.revealHand) — the full hand contents, same shape as
   *  graveyard/exile/command. Absent (not an empty array) means hand contents are still private;
   *  receivers must keep relying on handCount in that case, same as always. */
  hand?: PublicPileCard[]
  /** The sender's chosen Playtest playmat skin (see useBattlefieldSkin.ts) — cosmetic only, so
   *  kept as a loose string here rather than importing that hook's union type (this module stays
   *  React-free). The renderer falls back to 'felt' for anything it doesn't recognize, which
   *  covers both a garbled value and a skin id from a newer build this client doesn't know yet. */
  battlefieldSkin?: string
  /** Voluntarily conceded ("Scoop") — a player can mark themselves eliminated even above 0
   *  life, without waiting to actually hit 0. Combines with life<=0 into the same "eliminated"
   *  concept everywhere it's checked (turn-skip, quadrant scrim, nameplate badge) — see
   *  PlaytestView's isEliminated. Omitted (not false) when not scooped, keeping the wire
   *  payload sparse like every other optional flag here. */
  scooped?: boolean
  /** Mana currently floating (generated but not yet spent), per color — visible to the whole pod
   *  same as life/poison, since a real table's floating mana sits in plain view next to your
   *  library. Sparse like counters/ptCounters: only nonzero colors are included, and the field
   *  is omitted entirely (not an all-zero object) once nothing's floating. */
  floatingMana?: Partial<Record<ManaColorKey, number>>
}

/**
 * Message vocabulary. The plan describes ~3 types; `WELCOME` is the honest 4th:
 * the host assigns seats, so a joining guest needs to be told which seat it got
 * (it can't broadcast its own board until it knows its seat). Everything else
 * flows through STATE snapshots.
 */
export type HelloMessage = {
  type: 'HELLO'
  v: number
  playerId: string
  name: string
  deckFormat: string
}
/** Host → newly-joined guest: "you are `playerId`, seated at `seat`." */
export type WelcomeMessage = {
  type: 'WELCOME'
  v: number
  playerId: string
  seat: Seat
}
/** Any client → everyone (host relays): my whole public board, as of now. */
export type StateMessage = {
  type: 'STATE'
  v: number
  board: PublicBoard
}
/** Host → remaining peers: this player disconnected; drop their mirror. */
export type PlayerLeftMessage = {
  type: 'PLAYER_LEFT'
  v: number
  playerId: string
}

/** A battlefield card handed to another player, carrying just what's needed to recreate it there.
 *  Unlike PublicCard, GIVE_CARD is directed to one specific recipient (see peerConnection's
 *  deliverGive), so — matching a real "show/give a card" effect — scryfallId here is always the
 *  real one even if the card is face down: the recipient legitimately learns its identity by
 *  receiving it. It stays hidden from everyone else, since the recipient's own subsequent
 *  PublicBoard broadcast will mask it again while faceDown remains true. */
export type GivenCard = {
  instanceId: string
  scryfallId: string
  ownerSeat: Seat
  x: number
  y: number
  tapped: boolean
  counters?: CounterPile[]
  ptCounters?: PtCounterPile[]
  showBackFace?: boolean
  isToken?: boolean
  faceDown?: boolean
}

/**
 * Transfer control of a card to another player. Directed (not broadcast): routed
 * to `toPlayerId` — a guest sends it to the host, who forwards it to the target.
 * The giver removes the card locally; the recipient adds it to their own board.
 */
export type GiveCardMessage = {
  type: 'GIVE_CARD'
  v: number
  toPlayerId: string
  card: GivenCard
}

/**
 * Reposition a card on another player's battlefield without changing ownership/control —
 * "move any card anywhere," including onto someone else's board, as distinct from GIVE_CARD's
 * ownership transfer. Directed like GIVE_CARD (routed to `toPlayerId`, guest->host->target),
 * carrying just enough to relocate an existing card by id; the target board's own client applies
 * it to its local state (see gameReducer's RECEIVE_RELOCATED_CARD) and re-broadcasts STATE.
 *
 * `x`/`y` stay seat-relative to `atSeat` (the quadrant it was dropped into), matching
 * PublicCard's convention — NOT relative to the card owner's own seat when the two differ.
 * `atSeat` omitted means "back to the owner's own seat" (undoes a previous relocation).
 */
export type RelocateCardMessage = {
  type: 'RELOCATE_CARD'
  v: number
  toPlayerId: string
  instanceId: string
  x: number
  y: number
  atSeat?: Seat
}

/**
 * Tap/untap a card on another player's board — the companion to RELOCATE_CARD's free-for-all
 * table talk: once you've dragged someone's card onto your own quadrant ("taken" it, without the
 * ownership transfer of GIVE_CARD), tapping it should work like tapping anything else on your
 * board. The tap state still lives in the owner's GameState, so this is a directed request to
 * that owner (same guest->host->target routing as RELOCATE_CARD); their client applies SET_TAPPED
 * and the change comes back to everyone via their next STATE broadcast.
 */
export type TapCardMessage = {
  type: 'TAP_CARD'
  v: number
  toPlayerId: string
  instanceId: string
  tapped: boolean
}

/**
 * Flip a card face up/down on another player's board — same free-for-all table-talk
 * companion to RELOCATE_CARD as TAP_CARD, just toggling `showBackFace` instead of
 * `tapped`. Same directed guest->host->target routing; the owner's client applies
 * FLIP_CARD and the change comes back to everyone via their next STATE broadcast.
 */
export type FlipCardMessage = {
  type: 'FLIP_CARD'
  v: number
  toPlayerId: string
  instanceId: string
}

/**
 * Send a card on another player's board to the graveyard — same free-for-all table-talk
 * companion to RELOCATE_CARD as TAP_CARD/FLIP_CARD. A relocated (not given) card is still
 * legally the true owner's, so deleting it has to land in *their* graveyard, not the
 * controller's — same directed guest->host->target routing; the owner's client applies
 * MOVE_CARD (toZone: 'graveyard', which already handles a token simply ceasing to exist)
 * and the change comes back to everyone via their next STATE broadcast.
 */
export type DeleteCardMessage = {
  type: 'DELETE_CARD'
  v: number
  toPlayerId: string
  instanceId: string
}

/** A single die roll or coin flip result. */
export type RollResult = { kind: 'die'; sides: number; value: number } | { kind: 'coin'; value: 'heads' | 'tails' }

/**
 * Broadcast (any client → everyone, host relays): a die/coin result to share with
 * the pod. Unlike STATE, never cached by the host — purely transient, so a late
 * joiner just doesn't see rolls that happened before they arrived.
 */
export type RollMessage = {
  type: 'ROLL'
  v: number
  playerId: string
  name: string
  roll: RollResult
}

/**
 * Broadcast (any client → everyone, host relays): draw attention to a spot on the
 * table. `x`/`y` are table-absolute pixels — the same coordinate space the whole
 * pod's surface lives in (see `tableSize`/`podLayout.ts`), not seat-relative like
 * `PublicCard.x/y` — a ping can point anywhere on the shared table, not just the
 * sender's own quadrant. Never cached, same as ROLL: purely transient.
 */
export type PingMessage = {
  type: 'PING'
  v: number
  playerId: string
  name: string
  x: number
  y: number
}

/**
 * Broadcast (any client → everyone, host relays): "it's this seat's turn now." Purely a
 * visual cue, not enforced — anyone can still act on any turn (see PlaytestView's Pass
 * Turn button). Unlike ROLL/PING, the host *does* cache the latest value (like STATE) and
 * replays it to a newly-joined guest on HELLO, so a late joiner immediately sees whose
 * turn it is instead of a blank/default highlight until the next pass.
 */
export type TurnPassMessage = {
  type: 'TURN_PASS'
  v: number
  activeSeat: Seat
}

/**
 * Broadcast (any client → everyone, host relays): flash/pulse-highlight a specific battlefield
 * card for the whole pod — the "look at THIS card" gesture, sibling to PING (a table position)
 * but targeting a card instead. Same lifecycle as ROLL/PING: never cached, purely transient, so a
 * late joiner simply never sees a highlight that happened before they arrived. Triggered by
 * Alt+click landing on a card instead of empty battlefield (see PlaytestView's sendHighlight).
 */
export type HighlightMessage = {
  type: 'HIGHLIGHT'
  v: number
  instanceId: string
}

/**
 * Broadcast (any client → everyone, host relays): a one-click emoji reaction (👍😂😱 etc.) —
 * pure fun, sibling to ROLL/PING with the same transient (never cached) lifecycle. Rendered near
 * the sender's nameplate rather than a table point or cursor, since this app has no cursor-
 * position tracking to broadcast.
 */
export type ReactionMessage = {
  type: 'REACTION'
  v: number
  playerId: string
  name: string
  emoji: string
}

/**
 * Broadcast (any client → everyone, host relays): which shared internet-radio station (if
 * any) is playing on the table — see TableRadio.tsx. `station` is a station id from
 * RADIO_STATIONS, or null for "off." Cached like TURN_PASS (not transient like ROLL/PING):
 * a late joiner should hear/see whatever's currently playing rather than silence until
 * someone happens to change the station.
 */
export type RadioMessage = {
  type: 'RADIO'
  v: number
  station: string | null
}

export type NetMessage =
  | HelloMessage
  | WelcomeMessage
  | StateMessage
  | PlayerLeftMessage
  | GiveCardMessage
  | RelocateCardMessage
  | TapCardMessage
  | FlipCardMessage
  | DeleteCardMessage
  | RollMessage
  | PingMessage
  | TurnPassMessage
  | HighlightMessage
  | ReactionMessage
  | RadioMessage
export type NetMessageType = NetMessage['type']

// --- serialization -----------------------------------------------------------

export function serialize(msg: NetMessage): string {
  return JSON.stringify(msg)
}

export type ParseResult =
  | { ok: true; msg: NetMessage }
  | { ok: false; reason: 'malformed' | 'version' }

/**
 * Parse an incoming frame. Accepts a raw JSON string (how we frame on the wire)
 * or an already-parsed object (PeerJS may hand back parsed data depending on its
 * serializer), so callers don't have to care which they got.
 *
 * Returns a discriminated result so the UI can distinguish "garbage" from "your
 * friend is on an incompatible version" — the latter is worth surfacing.
 */
export function parseMessage(raw: unknown): ParseResult {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return { ok: false, reason: 'malformed' }
    }
  }
  if (typeof obj !== 'object' || obj === null) return { ok: false, reason: 'malformed' }

  const m = obj as Record<string, unknown>
  if (typeof m.v !== 'number') return { ok: false, reason: 'malformed' }
  if (m.v !== PROTOCOL_VERSION) return { ok: false, reason: 'version' }

  switch (m.type) {
    case 'HELLO':
      if (isNonEmptyString(m.playerId) && isString(m.name) && isString(m.deckFormat)) {
        return { ok: true, msg: obj as HelloMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'WELCOME':
      if (isNonEmptyString(m.playerId) && isSeat(m.seat)) {
        return { ok: true, msg: obj as WelcomeMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'STATE':
      if (isPublicBoard(m.board)) return { ok: true, msg: obj as StateMessage }
      return { ok: false, reason: 'malformed' }
    case 'PLAYER_LEFT':
      if (isNonEmptyString(m.playerId)) return { ok: true, msg: obj as PlayerLeftMessage }
      return { ok: false, reason: 'malformed' }
    case 'GIVE_CARD':
      if (isNonEmptyString(m.toPlayerId) && isGivenCard(m.card)) return { ok: true, msg: obj as GiveCardMessage }
      return { ok: false, reason: 'malformed' }
    case 'RELOCATE_CARD':
      if (
        isNonEmptyString(m.toPlayerId) &&
        isNonEmptyString(m.instanceId) &&
        typeof m.x === 'number' &&
        typeof m.y === 'number' &&
        (m.atSeat === undefined || isSeat(m.atSeat))
      ) {
        return { ok: true, msg: obj as RelocateCardMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'TAP_CARD':
      if (isNonEmptyString(m.toPlayerId) && isNonEmptyString(m.instanceId) && typeof m.tapped === 'boolean') {
        return { ok: true, msg: obj as TapCardMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'FLIP_CARD':
      if (isNonEmptyString(m.toPlayerId) && isNonEmptyString(m.instanceId)) {
        return { ok: true, msg: obj as FlipCardMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'DELETE_CARD':
      if (isNonEmptyString(m.toPlayerId) && isNonEmptyString(m.instanceId)) {
        return { ok: true, msg: obj as DeleteCardMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'ROLL':
      if (isNonEmptyString(m.playerId) && isString(m.name) && isRollResult(m.roll)) {
        return { ok: true, msg: obj as RollMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'PING':
      if (isNonEmptyString(m.playerId) && isString(m.name) && typeof m.x === 'number' && typeof m.y === 'number') {
        return { ok: true, msg: obj as PingMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'TURN_PASS':
      if (isSeat(m.activeSeat)) return { ok: true, msg: obj as TurnPassMessage }
      return { ok: false, reason: 'malformed' }
    case 'HIGHLIGHT':
      if (isNonEmptyString(m.instanceId)) return { ok: true, msg: obj as HighlightMessage }
      return { ok: false, reason: 'malformed' }
    case 'REACTION':
      if (isNonEmptyString(m.playerId) && isString(m.name) && isNonEmptyString(m.emoji)) {
        return { ok: true, msg: obj as ReactionMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'RADIO':
      if (m.station === null || isNonEmptyString(m.station)) return { ok: true, msg: obj as RadioMessage }
      return { ok: false, reason: 'malformed' }
    default:
      return { ok: false, reason: 'malformed' }
  }
}

/** Convenience wrapper: the message, or null for anything unusable. */
export function deserialize(raw: unknown): NetMessage | null {
  const result = parseMessage(raw)
  return result.ok ? result.msg : null
}

// --- seat + relay routing (pure) --------------------------------------------

// Host is always 0. Guests fill in clockwise from there — 2 (directly above the
// host), then 3, then 1 — matching podLayout's SEAT_GRID/TURN_ORDER (0 bottom-left,
// 2 top-left, 3 top-right, 1 bottom-right), so the pod fills around the table in
// the same order turns pass, not by jumping to the opposite corner first.
const SEAT_JOIN_ORDER: readonly Seat[] = [0, 2, 3, 1]

/** Next unoccupied seat in join-preference order (host, then clockwise around the table), or null when the pod is full. */
export function nextFreeSeat(occupied: readonly number[]): Seat | null {
  for (const s of SEAT_JOIN_ORDER) {
    if (!occupied.includes(s)) return s
  }
  return null
}

/**
 * Star topology: the host forwards each incoming STATE to every *other* connected
 * peer, stamping sender identity. Guests only ever talk to the host, so this is
 * how a guest's board reaches the other guests.
 */
export function relayTargets(connectedPeerIds: readonly string[], senderPeerId: string): string[] {
  return connectedPeerIds.filter((id) => id !== senderPeerId)
}

// --- room code <-> peer id ---------------------------------------------------

/**
 * PeerJS registers a global peer id; we derive it from a short friendly code.
 * The code alphabet omits visually ambiguous characters (0/O, 1/I/L) so a code
 * read aloud or over chat is unambiguous.
 */
export const PEER_ID_PREFIX = 'mtg-vtt-'
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6

// The room code is the *only* thing gating who can join a game (PeerJS ids are effectively
// public), so it needs to be unguessable, not just "looks random" — Math.random() isn't
// specified to be cryptographically secure and shouldn't back anything access-control-shaped.
function secureRandom(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] / 2 ** 32
}

export function generateRoomCode(random: () => number = secureRandom): string {
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  }
  return code
}

/** Normalizes user input (case, surrounding whitespace) then maps to the peer id. */
export function roomCodeToPeerId(code: string): string {
  return PEER_ID_PREFIX + code.trim().toUpperCase()
}

export function peerIdToRoomCode(peerId: string): string | null {
  return peerId.startsWith(PEER_ID_PREFIX) ? peerId.slice(PEER_ID_PREFIX.length) : null
}

/** True for a syntactically valid room code (length + alphabet), case-insensitive. */
export function isValidRoomCode(code: string): boolean {
  const c = code.trim().toUpperCase()
  if (c.length !== ROOM_CODE_LENGTH) return false
  for (const ch of c) {
    if (!CODE_ALPHABET.includes(ch)) return false
  }
  return true
}

// --- internal validators -----------------------------------------------------

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isSeat(v: unknown): v is Seat {
  return v === 0 || v === 1 || v === 2 || v === 3
}

const COUNTER_COLOR_IDS: readonly CounterColor[] = [
  'green',
  'red',
  'blue',
  'black',
  'gold',
  'colorless',
  'flying',
  'firststrike',
  'doublestrike',
  'deathtouch',
  'trample',
  'vigilance',
  'lifelink',
  'hexproof',
  'indestructible',
  'menace',
  'reach',
  'haste',
]

function isCounterColor(v: unknown): v is CounterColor {
  return typeof v === 'string' && (COUNTER_COLOR_IDS as readonly string[]).includes(v)
}

function isCounterPile(v: unknown): v is CounterPile {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return isNonEmptyString(p.id) && isCounterColor(p.color) && typeof p.value === 'number'
}

function isCounterPileArray(v: unknown): v is CounterPile[] | undefined {
  return v === undefined || (Array.isArray(v) && v.every(isCounterPile))
}

function isPtCounterPile(v: unknown): v is PtCounterPile {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return isNonEmptyString(p.id) && isCounterColor(p.color) && typeof p.power === 'number' && typeof p.toughness === 'number'
}

function isPtCounterPileArray(v: unknown): v is PtCounterPile[] | undefined {
  return v === undefined || (Array.isArray(v) && v.every(isPtCounterPile))
}

function isRollResult(v: unknown): v is RollResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.kind === 'die') return typeof r.sides === 'number' && typeof r.value === 'number'
  if (r.kind === 'coin') return r.value === 'heads' || r.value === 'tails'
  return false
}

function isPublicCard(v: unknown): v is PublicCard {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    isNonEmptyString(c.instanceId) &&
    isNonEmptyString(c.scryfallId) &&
    typeof c.x === 'number' &&
    typeof c.y === 'number' &&
    typeof c.tapped === 'boolean' &&
    isCounterPileArray(c.counters) &&
    isPtCounterPileArray(c.ptCounters) &&
    (c.showBackFace === undefined || typeof c.showBackFace === 'boolean') &&
    (c.isToken === undefined || typeof c.isToken === 'boolean') &&
    (c.ownerSeat === undefined || isSeat(c.ownerSeat)) &&
    (c.faceDown === undefined || typeof c.faceDown === 'boolean') &&
    (c.atSeat === undefined || isSeat(c.atSeat))
  )
}

function isGivenCard(v: unknown): v is GivenCard {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    isNonEmptyString(c.instanceId) &&
    isNonEmptyString(c.scryfallId) &&
    isSeat(c.ownerSeat) &&
    typeof c.x === 'number' &&
    typeof c.y === 'number' &&
    typeof c.tapped === 'boolean' &&
    isCounterPileArray(c.counters) &&
    isPtCounterPileArray(c.ptCounters) &&
    (c.showBackFace === undefined || typeof c.showBackFace === 'boolean') &&
    (c.isToken === undefined || typeof c.isToken === 'boolean') &&
    (c.faceDown === undefined || typeof c.faceDown === 'boolean')
  )
}

function isPublicPileCard(v: unknown): v is PublicPileCard {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    isNonEmptyString(c.instanceId) &&
    isNonEmptyString(c.scryfallId) &&
    (c.showBackFace === undefined || typeof c.showBackFace === 'boolean')
  )
}

function isOptionalPile(v: unknown): v is PublicPileCard[] | undefined {
  return v === undefined || (Array.isArray(v) && v.every(isPublicPileCard))
}

function isFloatingMana(v: unknown): v is Partial<Record<ManaColorKey, number>> | undefined {
  if (v === undefined) return true
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return Object.keys(m).every((key) => (MANA_COLOR_KEYS as readonly string[]).includes(key) && typeof m[key] === 'number')
}

function isCommanderDamage(v: unknown): v is Partial<Record<Seat, number>> {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return Object.keys(m).every((key) => isSeat(Number(key)) && typeof m[key] === 'number')
}

function isPublicBoard(v: unknown): v is PublicBoard {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>
  return (
    isNonEmptyString(b.playerId) &&
    isString(b.name) &&
    isSeat(b.seat) &&
    typeof b.life === 'number' &&
    (b.startingLife === undefined || typeof b.startingLife === 'number') &&
    isCommanderDamage(b.commanderDamage) &&
    typeof b.poison === 'number' &&
    typeof b.handCount === 'number' &&
    Array.isArray(b.battlefield) &&
    b.battlefield.every(isPublicCard) &&
    isOptionalPile(b.graveyard) &&
    isOptionalPile(b.exile) &&
    isOptionalPile(b.command) &&
    isOptionalPile(b.hand) &&
    (b.battlefieldSkin === undefined || typeof b.battlefieldSkin === 'string') &&
    (b.scooped === undefined || typeof b.scooped === 'boolean') &&
    isFloatingMana(b.floatingMana)
  )
}
