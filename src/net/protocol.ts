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
import { parseDraftMessage, type DraftMessage } from './draftProtocol'

/** Bump when the wire shape changes incompatibly. Receivers reject other versions.
 *  v2: PublicBoard.commanderDamage changed from a single number (worst single source) to a
 *  per-source record keyed by seat — an incompatible shape change, unlike every other field
 *  added to PublicBoard so far (those were purely additive/optional).
 *  v3: HELLO requires a `key` (seat takeover fix), and every message has size limits — an older
 *  client would be refused at join anyway, so it is told it's on an incompatible version instead. */
export const PROTOCOL_VERSION = 3

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
  /** Every card designated as this player's commander, regardless of its CURRENT zone —
   *  unlike `command` above (which only reflects whichever commanders currently happen to be
   *  sitting in the command zone), this stays the same fixed list all game, so a seat's
   *  commander portrait next to their nameplate never disappears just because they cast it to
   *  the battlefield or it died to the graveyard. A commander's identity is public knowledge
   *  in real Commander regardless of zone, so sharing this in full (masked like any other
   *  card if currently face-down) is the same privacy stance as graveyard/exile/command. */
  commanders?: PublicPileCard[]
  /** Deliberate, opt-in exception to the hand's usual privacy: present only while the sender has
   *  "reveal hand" toggled on (GameState.revealHand) — the full hand contents, same shape as
   *  graveyard/exile/command. Absent (not an empty array) means hand contents are still private;
   *  receivers must keep relying on handCount in that case, same as always. */
  hand?: PublicPileCard[]
  /** The sender's top library card, present only while they've opted in to "play with the top
   *  card of your library revealed" (GameState.revealTopToPod) — the public one of Magic's two
   *  top-of-library effects. Same opt-in shape as `hand` above: absent (not null) means the
   *  library's top is private, which is the normal case. The separate private "you may look at
   *  the top card any time" toggle deliberately never reaches the wire at all. */
  topOfLibrary?: PublicPileCard
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
  /** A secret this connection makes up once and never shows anyone but the host. playerIds are
   *  public (every STATE carries one), so on its own a playerId proved nothing: anyone in the pod
   *  could join claiming another player's id, and the host dropped the real player to seat them.
   *  The host now ties each playerId to the key it first arrived with and refuses a mismatch. */
  key: string
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
  /** Travel with a commander so it is still a commander — with its tax — when it comes home.
   *  A given card used to arrive as a plain card, and getting your commander back from whoever
   *  took control of it lost its tax tracker for the rest of the game. Whoever is merely
   *  holding the card carries these along without acting on them (see GameCard.isCommander). */
  isCommander?: boolean
  commanderTax?: number
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

/**
 * Send a card on another player's board back to one of *their own* private/public non-battlefield
 * zones — the missing counterpart to DELETE_CARD (always graveyard) and RELOCATE_CARD (always
 * battlefield): before this, a card that had been given away, or just relocated onto someone
 * else's board via the free-for-all "move any card anywhere" feature, had no drag target that
 * actually did anything for hand/library/exile/command — the drop silently no-oped because the
 * card was never in the dragger's own state to move locally. Same directed guest->host->target
 * routing as DELETE_CARD/TAP_CARD/FLIP_CARD; the owner's client applies MOVE_CARD (toZone,
 * which already handles a token simply ceasing to exist off the battlefield, same as
 * DELETE_CARD's graveyard case) and the change comes back to everyone via their next STATE
 * broadcast. Doesn't reveal anything: like any other card entering a private zone, it becomes
 * private again the instant the owner's own next broadcast omits it from their public battlefield
 * list (graveyard/exile/command stay public either way, same as always).
 */
export type ReturnCardMessage = {
  type: 'RETURN_CARD'
  v: number
  toPlayerId: string
  instanceId: string
  toZone: 'hand' | 'library' | 'exile' | 'command'
  /** Only meaningful for `toZone: 'library'` — which end it goes to, matching MOVE_CARD's own
   *  `libraryPosition`. Optional and defaulting to 'top' (MOVE_CARD's own default) so an older
   *  sender that omits it behaves exactly as it did before this existed. Bottoming a card is a
   *  real and distinct effect from putting it on top, and the local drop path already offered
   *  both — this is what lets that reach a card sitting on someone else's board too. */
  libraryPosition?: 'top' | 'bottom'
}

/**
 * Ask whoever currently holds a card to hand it back to its original owner — the missing inverse
 * of GIVE_CARD, which was strictly one-way. Dragging a card you own off someone else's board and
 * onto your own only ever RELOCATED it: it moved to your quadrant while they kept ownership, so
 * you still couldn't tap or move it, and — because ownerSeat then matched the quadrant it was
 * drawn in — it didn't even show the owner ring that would have explained why.
 *
 * Directed to the current holder, same guest->host->target routing as GIVE_CARD/TAP_CARD. The
 * holder's client answers with an ordinary GIVE_CARD back to `fromPlayerId`, so the transfer
 * itself reuses the existing, already-working path rather than inventing a second one; this
 * message is only the request.
 */
export type ReclaimCardMessage = {
  type: 'RECLAIM_CARD'
  v: number
  /** The player currently holding the card. */
  toPlayerId: string
  /** The original owner asking for it back — where the holder should send it. */
  fromPlayerId: string
  instanceId: string
}

/**
 * A die roll or coin flip result. A die roll can be several dice at once (11d6 and friends):
 * `value` is always the TOTAL, and `values` carries the individual faces when more than one was
 * rolled. `values` is omitted for a single die, so an ordinary roll is exactly the shape it has
 * always been and an older receiver still reads `value` correctly.
 */
export type RollResult =
  | { kind: 'die'; sides: number; value: number; values?: number[] }
  | { kind: 'coin'; value: 'heads' | 'tails' }

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
  /** Stable id for this roll, minted by the roller and shared by every client that mirrors it,
   *  so ROLL_DISMISS below can name the one to clear. Optional: receivers fall back to a local
   *  id when an older sender omits it, which just means that particular roll can't be dismissed
   *  remotely (it still ages out of the log by the usual length cap). */
  id?: string
}

/**
 * Broadcast (any client → everyone, host relays): clear a previously-broadcast roll from the
 * log. Rolls no longer expire on a timer — a result you needed could vanish before the table
 * finished reading it — so they stay until the person who rolled takes them back, the same way
 * you'd leave dice on the table until everyone's seen them and then scoop them up.
 *
 * Only the roller's own client offers the control, but this is deliberately not enforced on
 * receipt: same trust model as the rest of the table (see RelocateCardMessage), and the worst
 * case is a roll disappearing slightly early.
 */
export type RollDismissMessage = {
  type: 'ROLL_DISMISS'
  v: number
  id: string
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
  /** The table's shared turn number as of this pass — one number the whole pod agrees on,
   *  incremented by the passer when the rotation wraps back to the first seat (see podLayout's
   *  completesRound). Distinct from GameState.turn, which counts only that one client's OWN
   *  turns and so means nothing to anybody else in a pod. Cached by the host alongside
   *  activeSeat and replayed to a late joiner. Optional so an older sender simply leaves the
   *  shared counter untouched rather than failing validation. */
  turn?: number
  /** The seat that took the game's first turn — what a "round" is measured from. The counter
   *  above ticks when the rotation comes back round to this seat; measured from the head of the
   *  fixed seat order instead, it ticked after one turn whenever someone else went first. Set
   *  when a game starts (Who Goes First, or the first Pass Turn) and carried on every pass after.
   *  Optional for the same reason `turn` is. */
  firstSeat?: Seat
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
  | ReturnCardMessage
  | ReclaimCardMessage
  | RollMessage
  | RollDismissMessage
  | PingMessage
  | TurnPassMessage
  | HighlightMessage
  | ReactionMessage
  | RadioMessage
  | DraftMessage
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
    if (raw.length > MAX_FRAME_CHARS) return { ok: false, reason: 'malformed' }
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
      if (isNonEmptyString(m.playerId) && isNonEmptyString(m.key) && isString(m.name) && isString(m.deckFormat)) {
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
        isFiniteNumber(m.x) &&
        isFiniteNumber(m.y) &&
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
    case 'RETURN_CARD':
      if (
        isNonEmptyString(m.toPlayerId) &&
        isNonEmptyString(m.instanceId) &&
        (m.toZone === 'hand' || m.toZone === 'library' || m.toZone === 'exile' || m.toZone === 'command') &&
        (m.libraryPosition === undefined || m.libraryPosition === 'top' || m.libraryPosition === 'bottom')
      ) {
        return { ok: true, msg: obj as ReturnCardMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'RECLAIM_CARD':
      if (isNonEmptyString(m.toPlayerId) && isNonEmptyString(m.fromPlayerId) && isNonEmptyString(m.instanceId)) {
        return { ok: true, msg: obj as ReclaimCardMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'ROLL':
      if (isNonEmptyString(m.playerId) && isString(m.name) && isRollResult(m.roll) && (m.id === undefined || isNonEmptyString(m.id))) {
        return { ok: true, msg: obj as RollMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'ROLL_DISMISS':
      if (isNonEmptyString(m.id)) return { ok: true, msg: obj as RollDismissMessage }
      return { ok: false, reason: 'malformed' }
    case 'PING':
      if (isNonEmptyString(m.playerId) && isString(m.name) && isFiniteNumber(m.x) && isFiniteNumber(m.y)) {
        return { ok: true, msg: obj as PingMessage }
      }
      return { ok: false, reason: 'malformed' }
    case 'TURN_PASS':
      if (isSeat(m.activeSeat) && (m.turn === undefined || isFiniteNumber(m.turn)) && (m.firstSeat === undefined || isSeat(m.firstSeat))) {
        return { ok: true, msg: obj as TurnPassMessage }
      }
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
      // Not a VTT message type — try draft mode's own vocabulary (see draftProtocol.ts)
      // before giving up. Kept as a sibling file/switch rather than folded in here so this
      // already-large, live-tested VTT surface stays untouched while draft mode is unfinished.
      return parseDraftMessage(m)
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

// Size limits on everything a peer can send. Anyone holding the room code can join, so a peer is
// not trusted to be well-behaved: without these, one oversized board (a million cards, a
// megabyte-long name, a card with ten thousand counters) froze every client it reached, and a
// given card carrying it was autosaved and froze Playtest again on the next open. Each limit is
// far above anything real play produces.
/** Longest frame accepted at all, checked before JSON.parse does any work on it. */
export const MAX_FRAME_CHARS = 512_000
/** Ids (player, card instance, Scryfall, counter pile, pack), emoji, station and skin ids. */
export const MAX_ID_CHARS = 128
/** Free text: names, deck format, cube name, reasons. */
export const MAX_TEXT_CHARS = 256
/** Cards in any one zone or pile on a public board. */
export const MAX_ZONE_CARDS = 500
/** Counter piles on one card, and dice in one roll. */
export const MAX_SMALL_LIST = 100
/** Largest magnitude any number may have (life, positions, counters, dice). */
export const MAX_ABS_NUMBER = 1_000_000_000

// Exported for draftProtocol.ts's own validators to reuse rather than duplicate.
export function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_TEXT_CHARS
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_CHARS
}

/** A real, bounded number — JSON can't carry NaN/Infinity, but it can carry 1e308. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_ABS_NUMBER
}

/** An array of at most `max` items, each passing `item`. */
export function isBoundedArray<T>(v: unknown, max: number, item: (x: unknown) => x is T): v is T[] {
  return Array.isArray(v) && v.length <= max && v.every(item)
}

export function isSeat(v: unknown): v is Seat {
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
  return isNonEmptyString(p.id) && isCounterColor(p.color) && isFiniteNumber(p.value)
}

function isCounterPileArray(v: unknown): v is CounterPile[] | undefined {
  return v === undefined || isBoundedArray(v, MAX_SMALL_LIST, isCounterPile)
}

function isPtCounterPile(v: unknown): v is PtCounterPile {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return isNonEmptyString(p.id) && isCounterColor(p.color) && isFiniteNumber(p.power) && isFiniteNumber(p.toughness)
}

function isPtCounterPileArray(v: unknown): v is PtCounterPile[] | undefined {
  return v === undefined || isBoundedArray(v, MAX_SMALL_LIST, isPtCounterPile)
}

function isRollResult(v: unknown): v is RollResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.kind === 'die') {
    if (typeof r.sides !== 'number' || typeof r.value !== 'number') return false
    return r.values === undefined || isBoundedArray(r.values, MAX_SMALL_LIST, isFiniteNumber)
  }
  if (r.kind === 'coin') return r.value === 'heads' || r.value === 'tails'
  return false
}

function isPublicCard(v: unknown): v is PublicCard {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    isNonEmptyString(c.instanceId) &&
    isNonEmptyString(c.scryfallId) &&
    isFiniteNumber(c.x) &&
    isFiniteNumber(c.y) &&
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
    isFiniteNumber(c.x) &&
    isFiniteNumber(c.y) &&
    typeof c.tapped === 'boolean' &&
    isCounterPileArray(c.counters) &&
    isPtCounterPileArray(c.ptCounters) &&
    (c.showBackFace === undefined || typeof c.showBackFace === 'boolean') &&
    (c.isToken === undefined || typeof c.isToken === 'boolean') &&
    (c.faceDown === undefined || typeof c.faceDown === 'boolean') &&
    (c.isCommander === undefined || typeof c.isCommander === 'boolean') &&
    (c.commanderTax === undefined || isFiniteNumber(c.commanderTax))
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
  return v === undefined || isBoundedArray(v, MAX_ZONE_CARDS, isPublicPileCard)
}

function isFloatingMana(v: unknown): v is Partial<Record<ManaColorKey, number>> | undefined {
  if (v === undefined) return true
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return Object.keys(m).every((key) => (MANA_COLOR_KEYS as readonly string[]).includes(key) && isFiniteNumber(m[key]))
}

function isCommanderDamage(v: unknown): v is Partial<Record<Seat, number>> {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return Object.keys(m).every((key) => isSeat(Number(key)) && isFiniteNumber(m[key]))
}

function isPublicBoard(v: unknown): v is PublicBoard {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>
  return (
    isNonEmptyString(b.playerId) &&
    isString(b.name) &&
    isSeat(b.seat) &&
    isFiniteNumber(b.life) &&
    (b.startingLife === undefined || isFiniteNumber(b.startingLife)) &&
    isCommanderDamage(b.commanderDamage) &&
    isFiniteNumber(b.poison) &&
    isFiniteNumber(b.handCount) &&
    isBoundedArray(b.battlefield, MAX_ZONE_CARDS, isPublicCard) &&
    isOptionalPile(b.graveyard) &&
    isOptionalPile(b.exile) &&
    isOptionalPile(b.command) &&
    isOptionalPile(b.commanders) &&
    isOptionalPile(b.hand) &&
    (b.topOfLibrary === undefined || isPublicPileCard(b.topOfLibrary)) &&
    (b.battlefieldSkin === undefined || isString(b.battlefieldSkin)) &&
    (b.scooped === undefined || typeof b.scooped === 'boolean') &&
    isFloatingMana(b.floatingMana)
  )
}
