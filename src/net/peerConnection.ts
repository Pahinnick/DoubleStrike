/**
 * Live P2P transport for the multiplayer VTT — a thin wrapper over PeerJS.
 *
 * Star topology (see the plan doc): the host registers a peer id derived from a
 * short room code and takes seat 0; each guest connects only to the host, and
 * the host relays every guest's board to the other guests. This keeps joining to
 * a single code and means guests never need to connect to each other.
 *
 * All the *decidable* logic (message shapes, seat assignment, relay routing) is
 * pure and lives in `protocol.ts`; this file is deliberately just wiring, so it
 * can be swapped for a different transport (e.g. Trystero) without touching the
 * rest of the app. Not unit-tested — exercised live with multiple tabs/machines
 * (see the plan's Verification section).
 *
 * Signaling uses PeerJS's free public broker; no server of ours is involved. All
 * of this lives in the renderer, so Electron needs no main-process changes.
 */
import Peer, { type DataConnection } from 'peerjs'
import type { DraftConfigPayload } from './draftProtocol'
import {
  HOST_SEAT,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  type GivenCard,
  type NetMessage,
  type PublicBoard,
  type RollResult,
  type Seat,
  generateRoomCode,
  nextFreeSeat,
  parseMessage,
  relayTargets,
  roomCodeToPeerId,
  serialize,
} from './protocol'

/** Payload delivered to the `cardRelocated` listener — see RelocateCardMessage. */
export type RelocatedCard = { instanceId: string; x: number; y: number; atSeat?: Seat }

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'

export type LocalPlayer = {
  playerId: string
  name: string
  deckFormat: string
}

export type PeerConnectionEvents = {
  /** Overall transport state. `detail` carries a human-readable reason for error/closed. */
  status: (status: ConnectionStatus, detail?: string) => void
  /** Host only: the room code to share, emitted once the peer registers. */
  code: (roomCode: string) => void
  /** This client's own seat (host: immediately; guest: on WELCOME). */
  seat: (seat: Seat) => void
  /** A public board received from another player — mirror it. */
  board: (board: PublicBoard) => void
  /** A player disconnected; drop their mirror. */
  playerLeft: (playerId: string) => void
  /** Another player handed us control of a card — add it to our board. */
  cardGiven: (card: GivenCard) => void
  /** Another player repositioned one of our own cards — reposition it locally, no ownership change. */
  cardRelocated: (card: RelocatedCard) => void
  /** A directed tap/untap request for one of OUR cards (see TapCardMessage) — apply SET_TAPPED locally. */
  cardTapRequested: (req: { instanceId: string; tapped: boolean }) => void
  /** A directed flip request for one of OUR cards (see FlipCardMessage) — apply FLIP_CARD locally. */
  cardFlipRequested: (req: { instanceId: string }) => void
  /** A directed delete request for one of OUR cards (see DeleteCardMessage) — move it to our own graveyard locally. */
  cardDeleteRequested: (req: { instanceId: string }) => void
  /** A directed "send it back to one of our own zones" request for one of OUR cards (see
   *  ReturnCardMessage) — move it to that zone locally. */
  cardReturnRequested: (req: { instanceId: string; toZone: 'hand' | 'library' | 'exile' | 'command'; libraryPosition?: 'top' | 'bottom' }) => void
  /** The original owner of a card WE currently hold wants it back (see ReclaimCardMessage) —
   *  hand it over with an ordinary giveCard to `fromPlayerId`. */
  cardReclaimRequested: (req: { instanceId: string; fromPlayerId: string }) => void
  /** A die/coin roll from any player (including relayed ones from other guests). */
  roll: (playerId: string, name: string, roll: RollResult, id?: string) => void
  /** A roll was taken back by whoever made it — drop it from the log (see RollDismissMessage). */
  rollDismissed: (id: string) => void
  /** A "look here" ping at a table-space point, from any player (including relayed ones). */
  ping: (playerId: string, name: string, x: number, y: number) => void
  /** Flash-highlight a specific card, from any player (including relayed ones). */
  highlight: (instanceId: string) => void
  /** A one-click emoji reaction, from any player (including relayed ones). */
  reaction: (playerId: string, name: string, emoji: string) => void
  /** Whose turn it is now, from any player's Pass Turn (including relayed ones, and the
   *  host's replay of its cached value to a newly-joined guest). */
  turnPass: (activeSeat: Seat, turn?: number, firstSeat?: Seat) => void
  /** Guest only: the host has (re)accepted us and is about to replay every board it knows. What
   *  this client mirrored before is stale by definition — anyone who left while we were away
   *  never produced a PLAYER_LEFT we could hear — so listeners should clear it and let the
   *  replay rebuild it. */
  welcomed: () => void
  /** Host only: a guest has just been seated, on first join or on a rejoin. Lets a layer with its
   *  own per-seat state (the draft) bring that guest back up to date. */
  guestSeated: (playerId: string, seat: Seat) => void
  /** The shared table radio's station changed (including relayed ones, and the host's replay
   *  of its cached value to a newly-joined guest). Null means it's off. */
  radio: (station: string | null) => void
  /** Someone in the pod is on an incompatible PROTOCOL_VERSION, so their messages are being
   *  dropped. parseMessage has always distinguished this from plain garbage ("the latter is
   *  worth surfacing", per its doc) but nothing ever acted on the distinction — the symptom was
   *  just a peer who silently did nothing. Fired at most once per connection. */
  versionMismatch: () => void

  // --- draft mode (see draftProtocol.ts) ----------------------------------
  /** Who's seated where, for a pre-game draft lobby roster — see DraftRosterMessage. */
  draftRoster: (roster: Partial<Record<Seat, string>>) => void
  /** The chosen cube/pack settings, for the lobby display. */
  draftConfig: (config: DraftConfigPayload) => void
  /** Lobby -> drafting transition. */
  draftStart: () => void
  /** A pack we now hold — fresh deal or passed along by a neighbor's pick. */
  draftPack: (pack: { packId: string; round: number; cards: string[] }) => void
  /** Host only: a pick request from any seat (including our own, self-routed — see sendDraftPick). */
  draftPickReceived: (pick: { fromPlayerId: string; packId: string; scryfallId: string }) => void
  /** Our own pick got rejected (e.g. a stale double-click) — the pack we thought we held has moved on. */
  draftPickRejected: (rejection: { packId: string; reason: string }) => void
  /** Every pack in this round has been fully picked through. */
  draftRoundComplete: (round: number) => void
  /** The whole draft is done; move to deck-building. */
  draftComplete: () => void
  /** Sparse seat->pick-count map, for a "waiting on…" readout. */
  draftProgress: (picksBySeat: Partial<Record<Seat, number>>) => void
}

type EventKey = keyof PeerConnectionEvents

/** Per-guest bookkeeping the host keeps for each open connection. Seat is assigned once
 *  HELLO arrives (see acceptGuest/onHostData), not at raw connection-open time — assignment
 *  needs to know playerId first so a reconnecting player can be offered their old seat back. */
type GuestRecord = {
  conn: DataConnection
  seat: Seat | null
  playerId?: string // learned from HELLO
  name?: string // learned from HELLO — only needed for the draft lobby roster today
}

const MAX_ID_RETRIES = 5
// PeerJS's 'disconnected' event means we lost the signaling-server (broker) socket — the thing
// that introduces two peers to each other — NOT an already-established peer-to-peer data
// connection, which is a separate RTCPeerConnection that survives this just fine. It used to be
// treated as instantly fatal (booting the whole session on the first hiccup), even though the
// broker's free public server drops idle sockets/has blips fairly routinely. Retry a few times
// via peer.reconnect() first; only give up (see handleSignalingDisconnect) once that's failed
// repeatedly, meaning something more serious is actually wrong.
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_RETRY_DELAY_MS = 1500

// A guest whose *data* connection dies (as opposed to the signaling socket above) used to be
// simply done: status went 'closed' and the only way back was typing the room code again by
// hand. The board itself already survives that (see PlaytestView's autosave), so the session is
// recoverable in principle — this makes it recover on its own. Rejoining reuses the same
// playerId, which is exactly what the host's HELLO handler already keys its "offer the old seat
// back" logic on, so a successful rejoin lands the player back in their own quadrant.
const MAX_REJOIN_ATTEMPTS = 5
const REJOIN_BASE_DELAY_MS = 1000
// Doubles per attempt from the base above: ~1s, 2s, 4s, 8s, 16s. Long enough overall to ride out
// a laptop lid or a router reboot, short enough that the first (far more common) blip is
// invisible.
const rejoinDelayMs = (attempt: number) => REJOIN_BASE_DELAY_MS * 2 ** (attempt - 1)

// Bounds a single connection attempt, start to finish: registering our own peer with the broker,
// opening the channel, and hearing WELCOME back. Anything short of a full success within this
// window counts as a failed attempt.
//
// A per-attempt deadline rather than just a WELCOME deadline, because every stage can stall
// silently. Live testing caught exactly that: with the host gone, retries froze permanently on
// "attempt 2 of 5" — the replacement Peer never finished registering with the public broker, so
// peer.connect() was never reached, so no 'peer-unavailable' error ever fired, so nothing
// advanced the retry chain or ended it. Only failures that announce themselves were being
// handled.
const ATTEMPT_TIMEOUT_MS = 10_000

export class PeerConnection {
  private readonly local: LocalPlayer
  private peer: Peer | null = null
  private role: 'host' | 'guest' | null = null

  private ownSeat: Seat | null = null

  // Host state: connections keyed by PeerJS-level id (conn.peer), plus a cache of
  // every player's last-known board so a late joiner is resynced immediately
  // rather than waiting for each opponent's next change.
  private readonly guests = new Map<string, GuestRecord>()
  private readonly lastBoards = new Map<string, PublicBoard>()
  // Survives a guest's disconnect (unlike `guests`/`lastBoards`) so a reconnecting player —
  // same playerId, new PeerJS connection — can be offered their old seat back instead of
  // landing wherever nextFreeSeat happens to put them.
  private readonly lastSeatByPlayerId = new Map<string, Seat>()
  // Cached like lastBoards (not transient like ROLL/PING) so a late joiner sees whose turn
  // it is immediately rather than a stale/default highlight until the next pass.
  private lastActiveSeat: Seat | null = null
  // The pod's shared turn number, cached alongside lastActiveSeat and replayed in the same
  // breath — the two always travel together (see TurnPassMessage.turn).
  private lastTurn: number | null = null
  // Who took the first turn, cached with the two above — see TurnPassMessage.firstSeat.
  private lastFirstSeat: Seat | null = null
  // Cached like lastActiveSeat so a late joiner hears whatever station is already playing
  // instead of silence until someone happens to change it.
  private lastRadioStation: string | null = null

  // Guest state: the single connection to the host.
  private hostConn: DataConnection | null = null
  // Guest reconnection bookkeeping. `roomCode` is remembered purely so a dropped connection can
  // be re-established without asking the player to re-enter it; `deliberateDisconnect` keeps
  // leave() from being mistaken for a drop and immediately retried.
  private roomCode: string | null = null
  private deliberateDisconnect = false
  private rejoinAttempts = 0
  private rejoinTimer: number | null = null
  private attemptTimer: number | null = null
  // Emitted at most once per connection: a peer on a different PROTOCOL_VERSION produces a
  // parse failure for every single message, and warning on each one would be a flood.
  private versionMismatchReported = false

  private readonly listeners: { [K in EventKey]: Set<PeerConnectionEvents[K]> } = {
    status: new Set(),
    code: new Set(),
    seat: new Set(),
    board: new Set(),
    playerLeft: new Set(),
    cardGiven: new Set(),
    cardRelocated: new Set(),
    cardTapRequested: new Set(),
    cardFlipRequested: new Set(),
    cardDeleteRequested: new Set(),
    cardReturnRequested: new Set(),
    cardReclaimRequested: new Set(),
    roll: new Set(),
    rollDismissed: new Set(),
    ping: new Set(),
    highlight: new Set(),
    reaction: new Set(),
    turnPass: new Set(),
    welcomed: new Set(),
    guestSeated: new Set(),
    radio: new Set(),
    draftRoster: new Set(),
    draftConfig: new Set(),
    draftStart: new Set(),
    draftPack: new Set(),
    draftPickReceived: new Set(),
    draftPickRejected: new Set(),
    draftRoundComplete: new Set(),
    draftComplete: new Set(),
    draftProgress: new Set(),
    versionMismatch: new Set(),
  }

  constructor(local: LocalPlayer) {
    this.local = local
  }

  get seat(): Seat | null {
    return this.ownSeat
  }

  get playerId(): string {
    return this.local.playerId
  }

  on<K extends EventKey>(event: K, handler: PeerConnectionEvents[K]): () => void {
    this.listeners[event].add(handler)
    return () => this.listeners[event].delete(handler)
  }

  private emit<K extends EventKey>(event: K, ...args: Parameters<PeerConnectionEvents[K]>): void {
    for (const handler of this.listeners[event]) {
      // Each listener is isolated: these run synchronously inside PeerJS's own 'data' callback,
      // so an exception from one (a React state setter hitting a renderer bug, say) used to
      // abort the remaining listeners for that message AND propagate back into the transport.
      // A bug in one feature shouldn't be able to take the whole connection's message handling
      // down with it.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(handler as (...a: any[]) => void)(...args)
      } catch (err) {
        console.error(`[peerConnection] listener for "${event}" threw:`, err)
      }
    }
  }

  /** Parses an incoming frame, surfacing a version mismatch (once) instead of silently
   *  discarding it like any other unusable message — see the `versionMismatch` event. */
  private parseIncoming(data: unknown): NetMessage | null {
    const result = parseMessage(data)
    if (result.ok) return result.msg
    if (result.reason === 'version' && !this.versionMismatchReported) {
      this.versionMismatchReported = true
      this.emit('versionMismatch')
    }
    return null
  }

  /** Watches the underlying RTCPeerConnection for terminal ICE failure. PeerJS's own
   *  'close'/'error' events don't reliably fire when a link dies mid-session (see the HELLO
   *  handler's note about connections left "quietly dead"), which is precisely the case that
   *  strands a ghost guest holding a seat, or leaves a guest sitting on a connection that will
   *  never carry another byte. 'disconnected' is deliberately NOT treated as terminal — it's
   *  routinely transient and recovers on its own; only 'failed'/'closed' are acted on. */
  private watchConnectionHealth(conn: DataConnection, onDead: () => void): void {
    const pc = conn.peerConnection
    if (!pc) return
    const check = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.iceConnectionState === 'failed') {
        onDead()
      }
    }
    pc.addEventListener('connectionstatechange', check)
    pc.addEventListener('iceconnectionstatechange', check)
  }

  // --- host --------------------------------------------------------------

  /**
   * Register as the host and resolve with the room code once the broker
   * accepts our id. Retries a few times on the rare id collision.
   */
  hostGame(): Promise<string> {
    this.role = 'host'
    this.ownSeat = HOST_SEAT
    this.emit('status', 'connecting')
    return new Promise<string>((resolve, reject) => {
      const attempt = (retriesLeft: number) => {
        const code = generateRoomCode()
        const peer = new Peer(roomCodeToPeerId(code))
        this.peer = peer
        let registered = false

        peer.on('open', () => {
          registered = true
          this.emit('seat', HOST_SEAT)
          this.emit('code', code)
          this.emit('status', 'connected')
          // So a draft-lobby-style roster (built entirely from 'draftRoster' events) shows the
          // host as seated immediately, not only once the first guest's HELLO triggers a
          // broadcast — see getRoster/broadcastRoster.
          this.broadcastRoster()
          resolve(code)
        })
        peer.on('connection', (conn) => this.acceptGuest(conn))
        peer.on('error', (err) => {
          const type = (err as unknown as { type?: string }).type
          // Only before the room is up. The broker answers "ID taken" to a RE-registration too,
          // when our own previous socket hasn't been released on its side yet (a wifi roam, a
          // laptop waking) — and that arrives here as the same 'unavailable-id'. Treating it as
          // a collision destroyed the live peer, every guest's channel with it, and opened a
          // brand-new room under a different code. PeerJS disconnects after raising it, so
          // handleSignalingDisconnect below simply tries again.
          if (type === 'unavailable-id' && !registered && retriesLeft > 0) {
            // Code collided with an existing room — throw it away and try another.
            this.peer = null
            peer.destroy()
            attempt(retriesLeft - 1)
            return
          }
          if (registered) {
            // The room is already up, and PeerJS reports every later problem through this same
            // event: a blip on the broker socket (which handleSignalingDisconnect below is
            // already retrying), or one joiner's connection failing to negotiate. Neither ends
            // the game for the players already connected — their channels are separate — but
            // treating them as fatal used to drop the host out of its own pod, wipe its view of
            // every opponent, and leave "Back" (which ends the session for everyone) as the only
            // button.
            console.warn('[peerConnection] non-fatal host error:', type, err)
            return
          }
          this.emit('status', 'error', describePeerError(err))
          reject(err)
        })
        this.handleSignalingDisconnect(peer, () => {
          // Out of retries on the broker. With guests still connected the game itself carries
          // on peer-to-peer; only new joins and rejoins need the broker.
          if ([...this.guests.values()].some((g) => g.conn.open)) {
            this.emit('status', 'connected', "Lost the game server — the game continues, but nobody new can join right now.")
            return
          }
          this.emit('status', 'error', 'Lost connection to the signaling server.')
        })
      }
      attempt(MAX_ID_RETRIES)
    })
  }

  /** Recovers from a dropped signaling-server socket (see MAX_RECONNECT_ATTEMPTS's doc) by
   *  retrying `peer.reconnect()` a few times, spaced out, before calling `onExhausted` — which
   *  callers wire to the same fatal 'error' status this used to jump to immediately. A successful
   *  reconnect re-fires 'open' (same as the initial registration), which is how we notice it
   *  worked and reset the counter for next time. */
  private handleSignalingDisconnect(peer: Peer, onExhausted: () => void): void {
    let attempts = 0
    peer.on('disconnected', () => {
      // `this.peer !== peer` is the check that actually catches a peer being torn down:
      // PeerJS's destroy() raises 'disconnected' BEFORE it marks the peer destroyed, so every
      // teardown here (which detaches the peer first) would otherwise announce a reconnect.
      if (peer.destroyed || this.peer !== peer) return
      attempts += 1
      if (attempts > MAX_RECONNECT_ATTEMPTS) {
        onExhausted()
        return
      }
      this.emit('status', 'connecting', `Reconnecting to the game server (attempt ${attempts} of ${MAX_RECONNECT_ATTEMPTS})…`)
      window.setTimeout(() => {
        if (!peer.destroyed) peer.reconnect()
      }, RECONNECT_RETRY_DELAY_MS)
    })
    peer.on('open', () => {
      attempts = 0
    })
  }

  private acceptGuest(conn: DataConnection) {
    conn.on('open', () => {
      // Reap anything already dead BEFORE counting: the capacity test below counts raw
      // connection slots, and a guest whose link died without ever firing 'close'/'error'
      // (see the HELLO handler's note) keeps holding one indefinitely. Since the stale-entry
      // purge for a returning player only runs once their HELLO arrives — strictly after this
      // check — a full pod would refuse a legitimate reconnect on the strength of that
      // player's OWN ghost entry, reported to them as "the game may be full."
      this.pruneDeadGuests()
      // Seat isn't assigned yet (that happens on HELLO, once we know playerId — see
      // onHostData), so this is just a raw-connection-slot cap.
      if (this.guests.size >= MAX_PLAYERS - 1) {
        conn.close()
        return
      }
      this.guests.set(conn.peer, { conn, seat: null })
      // Catches a link that dies without a clean close — otherwise this record lingers, its
      // seat stays occupied, and every directed send to it silently goes nowhere.
      this.watchConnectionHealth(conn, () => this.dropGuest(conn.peer))
    })
    conn.on('data', (data) => this.onHostData(conn, data))
    conn.on('close', () => this.dropGuest(conn.peer))
    conn.on('error', () => this.dropGuest(conn.peer))
  }

  /** Drops every guest record whose connection is no longer open. Records are only ever created
   *  in acceptGuest's 'open' handler, so a closed one here is genuinely finished, never a
   *  connection still mid-handshake. Ids are collected first rather than dropped mid-iteration,
   *  since dropGuest itself walks `guests` to fan out PLAYER_LEFT. */
  private pruneDeadGuests(): void {
    const dead: string[] = []
    for (const [peerId, guest] of this.guests) {
      if (!guest.conn.open) dead.push(peerId)
    }
    for (const peerId of dead) this.dropGuest(peerId)
  }

  private onHostData(conn: DataConnection, data: unknown) {
    const msg = this.parseIncoming(data)
    if (!msg) return
    const record = this.guests.get(conn.peer)
    if (!record) return

    switch (msg.type) {
      case 'HELLO': {
        // A reconnect (network hiccup, tab refresh, etc.) arrives as a brand-new PeerJS
        // connection — a new conn.peer, hence a new key in `guests` — landing right on top of
        // an old entry for the same playerId that may never have gotten a 'close'/'error' event
        // (a stale signaling drop can leave a connection just quietly dead without ever firing
        // one). Left in place, every directed send (GIVE_CARD/RELOCATE_CARD/TAP_CARD/etc. — see
        // the deliver* methods) that happens to iterate to this dead entry first would silently
        // no-op forever after, since sendTo skips a closed connection with no fallback to keep
        // searching. Purge any other entry for this playerId now, before it can shadow the
        // live one.
        for (const [peerId, guest] of this.guests) {
          if (peerId !== conn.peer && guest.playerId === msg.playerId) this.guests.delete(peerId)
        }
        // Prefer this player's own last seat (from a previous session on this same
        // host) if it's not currently held by someone else; otherwise the usual
        // lowest-free-seat-in-join-preference-order assignment.
        const occupied = [HOST_SEAT, ...[...this.guests.values()].map((g) => g.seat).filter((s): s is Seat => s !== null)]
        const preferred = this.lastSeatByPlayerId.get(msg.playerId)
        const seat = preferred !== undefined && !occupied.includes(preferred) ? preferred : nextFreeSeat(occupied)
        if (seat === null) {
          conn.close()
          return
        }
        record.playerId = msg.playerId
        record.seat = seat
        record.name = msg.name
        this.lastSeatByPlayerId.set(msg.playerId, seat)
        // Tell the guest its seat, then replay every board we already know so it
        // sees a populated table immediately instead of empty quadrants.
        this.sendTo(conn, { type: 'WELCOME', v: PROTOCOL_VERSION, playerId: msg.playerId, seat })
        for (const board of this.lastBoards.values()) {
          this.sendTo(conn, { type: 'STATE', v: PROTOCOL_VERSION, board })
        }
        if (this.lastActiveSeat !== null) {
          this.sendTo(conn, {
            type: 'TURN_PASS',
            v: PROTOCOL_VERSION,
            activeSeat: this.lastActiveSeat,
            turn: this.lastTurn ?? undefined,
            firstSeat: this.lastFirstSeat ?? undefined,
          })
        }
        // Sent even when it's off: a guest rejoining after the radio was switched off while it
        // was away would otherwise keep playing the old station to a silent table.
        this.sendTo(conn, { type: 'RADIO', v: PROTOCOL_VERSION, station: this.lastRadioStation })
        this.broadcastRoster()
        this.emit('guestSeated', msg.playerId, seat)
        // Also catch up every OTHER already-connected guest, not just the (re)joining one: a
        // guest can miss a relayed STATE/PLAYER_LEFT if their connection happened to be
        // transiently not-open at that exact instant (see sendTo — a silent, un-retried drop),
        // with nothing to naturally re-trigger it until that other player's game state next
        // changes. That's how a reconnecting player can end up stuck looking "eliminated" (life
        // defaults to 0 when their board mirror is stale/missing) to one peer while everyone
        // else already sees them correctly — a roster change like this one is a natural resync
        // point, so use it to push every board we know about to the whole pod.
        this.resyncAll()
        break
      }
      case 'STATE': {
        // A board is only ever authoritative for the player who sent it. The host knows which
        // connection this arrived on (record.playerId, set from that guest's HELLO), so a STATE
        // claiming to be someone else's board is a spoof, not something to cache and fan out —
        // e.g. broadcasting a rival's board with life 0 would show them as eliminated to the
        // whole pod. Cheating-resistance rather than a hard security boundary (this is a
        // share-a-room-code-with-friends table where moving each other's cards is a feature),
        // but the sender is already known here, so there's no reason to take its word for it.
        if (!record.playerId || msg.board.playerId !== record.playerId) break
        this.lastBoards.set(msg.board.playerId, msg.board)
        this.emit('board', msg.board)
        // Fan out to every other guest (star relay).
        const targets = relayTargets([...this.guests.keys()], conn.peer)
        for (const peerId of targets) {
          const target = this.guests.get(peerId)
          if (target) this.sendTo(target.conn, msg)
        }
        break
      }
      case 'GIVE_CARD':
        // A guest handed a card to someone; route it to the intended recipient. The giver has
        // already removed the card from its own board, so if the recipient can't be reached
        // (left, or its link has died) the card goes straight back to the giver rather than
        // ceasing to exist.
        if (!this.deliverGive(msg) && record.playerId) {
          this.sendTo(conn, { ...msg, toPlayerId: record.playerId })
        }
        break
      case 'RELOCATE_CARD':
        // A guest repositioned a card on someone else's board; route it to that board's owner.
        this.deliverRelocate(msg)
        break
      case 'TAP_CARD':
        // A guest tapped/untapped a card on someone else's board; route it to that card's owner.
        this.deliverTap(msg)
        break
      case 'FLIP_CARD':
        // A guest flipped a card on someone else's board; route it to that card's owner.
        this.deliverFlip(msg)
        break
      case 'DELETE_CARD':
        // A guest deleted a card on someone else's board; route it to that card's owner.
        this.deliverDelete(msg)
        break
      case 'RETURN_CARD':
        // A guest sent a card on someone else's board back to hand; route it to that card's owner.
        this.deliverReturn(msg)
        break
      case 'RECLAIM_CARD':
        // A guest is asking whoever holds their card to hand it back; route it to the holder.
        this.deliverReclaim(msg)
        break
      case 'ROLL': {
        this.emit('roll', msg.playerId, msg.name, msg.roll, msg.id)
        // Fan out to every other guest, same star-relay pattern as STATE.
        const targets = relayTargets([...this.guests.keys()], conn.peer)
        for (const peerId of targets) {
          const target = this.guests.get(peerId)
          if (target) this.sendTo(target.conn, msg)
        }
        break
      }
      case 'ROLL_DISMISS': {
        this.emit('rollDismissed', msg.id)
        const targets = relayTargets([...this.guests.keys()], conn.peer)
        for (const peerId of targets) {
          const target = this.guests.get(peerId)
          if (target) this.sendTo(target.conn, msg)
        }
        break
      }
      case 'PING': {
        this.emit('ping', msg.playerId, msg.name, msg.x, msg.y)
        const targets = relayTargets([...this.guests.keys()], conn.peer)
        for (const peerId of targets) {
          const target = this.guests.get(peerId)
          if (target) this.sendTo(target.conn, msg)
        }
        break
      }
      case 'HIGHLIGHT': {
        this.emit('highlight', msg.instanceId)
        const targets = relayTargets([...this.guests.keys()], conn.peer)
        for (const peerId of targets) {
          const target = this.guests.get(peerId)
          if (target) this.sendTo(target.conn, msg)
        }
        break
      }
      case 'REACTION': {
        this.emit('reaction', msg.playerId, msg.name, msg.emoji)
        const targets = relayTargets([...this.guests.keys()], conn.peer)
        for (const peerId of targets) {
          const target = this.guests.get(peerId)
          if (target) this.sendTo(target.conn, msg)
        }
        break
      }
      case 'TURN_PASS': {
        this.lastActiveSeat = msg.activeSeat
        if (msg.turn !== undefined) this.lastTurn = msg.turn
        if (msg.firstSeat !== undefined) this.lastFirstSeat = msg.firstSeat
        this.emit('turnPass', msg.activeSeat, msg.turn, msg.firstSeat)
        const targets = relayTargets([...this.guests.keys()], conn.peer)
        for (const peerId of targets) {
          const target = this.guests.get(peerId)
          if (target) this.sendTo(target.conn, msg)
        }
        break
      }
      case 'RADIO': {
        this.lastRadioStation = msg.station
        this.emit('radio', msg.station)
        const targets = relayTargets([...this.guests.keys()], conn.peer)
        for (const peerId of targets) {
          const target = this.guests.get(peerId)
          if (target) this.sendTo(target.conn, msg)
        }
        break
      }
      case 'DRAFT_PICK':
        // Not relayed/fanned out like the cases above — the host is the sole recipient and
        // arbiter (see draftProtocol.ts's doc on DRAFT_PICK). Resolving it (round completion,
        // pass-direction bookkeeping) is real logic that belongs in draftEngine.ts, not here —
        // this file stays just wiring, so it just hands the raw request up.
        if (record.playerId) {
          this.emit('draftPickReceived', { fromPlayerId: record.playerId, packId: msg.packId, scryfallId: msg.scryfallId })
        }
        break
      default:
        break
    }
  }

  /** Who's seated where + their display name, for the pre-game draft lobby (see
   *  DraftRosterMessage's doc — the regular VTT derives this from PublicBoard broadcasts
   *  instead, which don't exist yet at this stage). */
  private getRoster(): Partial<Record<Seat, string>> {
    const roster: Partial<Record<Seat, string>> = { [HOST_SEAT]: this.local.name }
    for (const guest of this.guests.values()) {
      if (guest.seat !== null && guest.name) roster[guest.seat] = guest.name
    }
    return roster
  }

  private broadcastRoster(): void {
    const roster = this.getRoster()
    const msg: NetMessage = { type: 'DRAFT_ROSTER', v: PROTOCOL_VERSION, roster }
    this.emit('draftRoster', roster)
    for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
  }

  /** Finds the actual live connection for a guest playerId — defensive belt-and-suspenders
   *  alongside the HELLO-time stale-entry purge above: skips any matching entry whose
   *  connection isn't actually open rather than stopping at the first name match, so a directed
   *  send (GIVE_CARD/RELOCATE_CARD/TAP_CARD/FLIP_CARD/DELETE_CARD/RETURN_CARD) can still reach a
   *  reconnected guest even if a dead duplicate entry somehow slipped through. */
  private findGuestConn(playerId: string): DataConnection | undefined {
    let fallback: DataConnection | undefined
    for (const guest of this.guests.values()) {
      if (guest.playerId !== playerId) continue
      if (guest.conn.open) return guest.conn
      fallback ??= guest.conn
    }
    return fallback
  }

  /** Deliver a GIVE_CARD to its target: to us if we're the recipient, else to that guest's
   *  connection. False when there was no open connection to hand it to. */
  private deliverGive(msg: Extract<NetMessage, { type: 'GIVE_CARD' }>): boolean {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardGiven', msg.card)
      return true
    }
    const conn = this.findGuestConn(msg.toPlayerId)
    return conn ? this.sendTo(conn, msg) : false
  }

  /** Deliver a RELOCATE_CARD to its target board's owner, same routing as deliverGive. */
  private deliverRelocate(msg: Extract<NetMessage, { type: 'RELOCATE_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardRelocated', { instanceId: msg.instanceId, x: msg.x, y: msg.y, atSeat: msg.atSeat })
      return
    }
    const conn = this.findGuestConn(msg.toPlayerId)
    if (conn) this.sendTo(conn, msg)
  }

  /** Deliver a TAP_CARD to the card owner's client, same routing as deliverRelocate. */
  private deliverTap(msg: Extract<NetMessage, { type: 'TAP_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardTapRequested', { instanceId: msg.instanceId, tapped: msg.tapped })
      return
    }
    const conn = this.findGuestConn(msg.toPlayerId)
    if (conn) this.sendTo(conn, msg)
  }

  /** Deliver a FLIP_CARD to the card owner's client, same routing as deliverTap. */
  private deliverFlip(msg: Extract<NetMessage, { type: 'FLIP_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardFlipRequested', { instanceId: msg.instanceId })
      return
    }
    const conn = this.findGuestConn(msg.toPlayerId)
    if (conn) this.sendTo(conn, msg)
  }

  /** Deliver a DELETE_CARD to the card owner's client, same routing as deliverFlip. */
  private deliverDelete(msg: Extract<NetMessage, { type: 'DELETE_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardDeleteRequested', { instanceId: msg.instanceId })
      return
    }
    const conn = this.findGuestConn(msg.toPlayerId)
    if (conn) this.sendTo(conn, msg)
  }

  /** Deliver a RETURN_CARD to the card owner's client, same routing as deliverDelete. */
  private deliverReturn(msg: Extract<NetMessage, { type: 'RETURN_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardReturnRequested', { instanceId: msg.instanceId, toZone: msg.toZone, libraryPosition: msg.libraryPosition })
      return
    }
    const conn = this.findGuestConn(msg.toPlayerId)
    if (conn) this.sendTo(conn, msg)
  }

  /** Deliver a RECLAIM_CARD to the current holder, same routing as deliverReturn. */
  private deliverReclaim(msg: Extract<NetMessage, { type: 'RECLAIM_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardReclaimRequested', { instanceId: msg.instanceId, fromPlayerId: msg.fromPlayerId })
      return
    }
    const conn = this.findGuestConn(msg.toPlayerId)
    if (conn) this.sendTo(conn, msg)
  }

  private dropGuest(peerId: string) {
    const record = this.guests.get(peerId)
    if (!record) return
    this.guests.delete(peerId)
    if (record.playerId) {
      this.lastBoards.delete(record.playerId)
      this.emit('playerLeft', record.playerId)
      // Notify the rest of the pod so they drop this player's mirror too.
      const left: NetMessage = { type: 'PLAYER_LEFT', v: PROTOCOL_VERSION, playerId: record.playerId }
      for (const other of this.guests.values()) this.sendTo(other.conn, left)
      this.broadcastRoster()
      // Same resync-on-roster-change reasoning as the HELLO handler above.
      this.resyncAll()
    }
  }

  /** Push every board we have cached to every currently connected guest — a full resync, not
   *  just a delta. Called on any roster change (join/reconnect/leave) so a peer that silently
   *  missed an earlier relayed message (see sendTo's no-retry drop) gets a fresh, complete copy
   *  at the next natural opportunity instead of staying stuck until unrelated game state
   *  changes on someone else's end happen to re-trigger a broadcast. Idempotent and cheap — every
   *  STATE message is a full snapshot by design (see protocol.ts's doc), so replaying one a
   *  guest already has is a harmless no-op on their end. */
  private resyncAll(): void {
    for (const guest of this.guests.values()) {
      for (const board of this.lastBoards.values()) {
        this.sendTo(guest.conn, { type: 'STATE', v: PROTOCOL_VERSION, board })
      }
    }
  }

  // --- guest -------------------------------------------------------------

  /** Connect to a host by room code. Resolves once the data channel opens. */
  joinGame(roomCode: string): Promise<void> {
    this.role = 'guest'
    // Remembered for the lifetime of this connection so a dropped link can be re-established
    // without asking the player to type the code again — see scheduleRejoin.
    this.roomCode = roomCode
    this.deliberateDisconnect = false
    this.rejoinAttempts = 0
    return this.openGuestConnection(roomCode, false)
  }

  /**
   * One attempt at establishing (or re-establishing) the guest's connection to the host. A
   * rejoin gets a brand-new Peer rather than reusing the old one — which is exactly the shape
   * the host's HELLO handler already expects and de-duplicates ("a reconnect arrives as a
   * brand-new PeerJS connection"). On a rejoin attempt, failures feed back into the retry
   * schedule instead of being surfaced as a fatal error.
   */
  private openGuestConnection(roomCode: string, isRejoin: boolean): Promise<void> {
    this.emit('status', 'connecting', isRejoin ? this.rejoinStatusDetail() : undefined)
    // Started here, not once the channel opens: the attempt can stall at any earlier stage too
    // (see ATTEMPT_TIMEOUT_MS), and those stalls are silent.
    this.startAttemptTimeout(isRejoin)
    return new Promise<void>((resolve, reject) => {
      const peer = new Peer()
      this.peer = peer

      peer.on('open', () => {
        // 'open' fires again whenever the broker socket is re-established (see
        // handleSignalingDisconnect). The game channel is a separate connection that never went
        // away in that case — opening a second one on top of it made the host see a new guest,
        // and in a full pod refuse it as over capacity.
        if (this.peer === peer && this.hostConn?.open) {
          if (this.ownSeat !== null) this.emit('status', 'connected')
          return
        }
        const conn = peer.connect(roomCodeToPeerId(roomCode), { reliable: true })
        this.hostConn = conn
        conn.on('open', () => {
          // Deliberately NOT 'connected' yet — that's the raw WebRTC channel opening, before
          // the host has actually accepted us (see the 'WELCOME' case in onGuestData, below,
          // which is where 'connected' really gets emitted). The host can still reject us here
          // (e.g. the pod is already full — see acceptGuest's capacity check) by just closing
          // the channel without ever sending WELCOME. Emitting 'connected' this early used to
          // flash the guest's UI into a populated seat roster right before that rejection
          // landed, making a same-instant "the pod is full" rejection look like the host
          // abruptly ending a session we'd genuinely joined.
          this.sendTo(conn, {
            type: 'HELLO',
            v: PROTOCOL_VERSION,
            playerId: this.local.playerId,
            name: this.local.name,
            deckFormat: this.local.deckFormat,
          })
          // A link that fails mid-session usually dies without a clean 'close' (the very case
          // that used to strand a guest); treat it as a drop and start reconnecting.
          this.watchConnectionHealth(conn, () => this.handleGuestDisconnect('Lost connection to the game.'))
          resolve()
        })
        conn.on('data', (data) => {
          if (this.hostConn === conn) this.onGuestData(data)
        })
        conn.on('close', () => {
          // A connection we have already moved on from (replaced by a rejoin attempt) closing
          // is that teardown finishing, not the current session dropping.
          if (this.hostConn !== conn) return
          // If we never got WELCOME (ownSeat still null), the host rejected/dropped us before
          // ever accepting us into the pod — most commonly because it's already full — rather
          // than a session we were genuinely part of being ended. A rejection is final, so it
          // is reported as-is; a session we were really part of is worth trying to recover.
          if (this.ownSeat === null) {
            this.clearAttemptTimeout()
            this.emit('status', 'closed', "Couldn't join — the game may be full or no longer available.")
            return
          }
          this.handleGuestDisconnect('The host ended the session.')
        })
        conn.on('error', (err) => {
          if (this.hostConn !== conn) return
          if (this.ownSeat === null) {
            // The attempt is over; its deadline must not fire later and replace this message
            // with "the game didn't respond".
            this.clearAttemptTimeout()
            this.emit('status', 'error', describePeerError(err))
            return
          }
          this.handleGuestDisconnect(describePeerError(err))
        })
      })
      peer.on('error', (err) => {
        // A Peer from an attempt we have since abandoned, finishing late.
        if (this.peer !== peer) {
          reject(err)
          return
        }
        // PeerJS raises an error on the Peer for a dropped BROKER socket too, just ahead of its
        // 'disconnected' event. That is not the game dropping: the data channel to the host is
        // its own connection and is still open. Treating it as a drop tore down a healthy
        // session and rejoined — the guest's board vanished for the whole pod over a non-event.
        // handleSignalingDisconnect below already deals with the broker.
        const type = (err as unknown as { type?: string }).type
        if (this.hostConn?.open && type !== undefined && SIGNALING_ERROR_TYPES.has(type)) return
        // On a rejoin attempt the peer failing is just this attempt failing — fold it back into
        // the retry schedule rather than tearing the session down on the first miss.
        if (isRejoin || this.ownSeat !== null) {
          this.handleGuestDisconnect(describePeerError(err))
          reject(err)
          return
        }
        this.clearAttemptTimeout()
        this.emit('status', 'error', describePeerError(err))
        reject(err)
      })
      this.handleSignalingDisconnect(peer, () => {
        if (this.peer !== peer) return
        // Out of retries on the broker. A guest only needs it to (re)connect; with the game
        // channel still open there is nothing to recover from.
        if (this.hostConn?.open && this.ownSeat !== null) {
          this.emit('status', 'connected')
          return
        }
        if (this.ownSeat !== null) {
          this.handleGuestDisconnect('Lost connection to the game server.')
          return
        }
        this.clearAttemptTimeout()
        this.emit('status', 'error', 'Lost connection to the signaling server.')
      })
    })
  }

  private rejoinStatusDetail(): string {
    return `Reconnecting to the game (attempt ${this.rejoinAttempts} of ${MAX_REJOIN_ATTEMPTS})…`
  }

  /** Fails the current attempt if it hasn't fully succeeded within ATTEMPT_TIMEOUT_MS. WELCOME
   *  clears this timer, so reaching the callback always means this attempt did not complete —
   *  no need to re-check ownSeat, which may still hold a seat from a previous session. */
  private startAttemptTimeout(isRejoin: boolean): void {
    this.clearAttemptTimeout()
    this.attemptTimer = window.setTimeout(() => {
      this.attemptTimer = null
      if (isRejoin || this.ownSeat !== null) {
        // Schedule the next retry FIRST: closing the channel below re-enters
        // handleGuestDisconnect, which then sees a retry already pending and leaves it alone,
        // so the attempt counter advances exactly once.
        this.handleGuestDisconnect('Lost connection to the game.')
        this.hostConn?.close()
        return
      }
      this.emit('status', 'closed', "Couldn't join — the game didn't respond. Check the code and try again.")
      // Detached before it is torn down, for the same reason as in handleGuestDisconnect: the
      // channel's own 'close' would otherwise report "the game may be full" over the message
      // above. The peer goes too — one still stalled on the broker could finish registering
      // minutes later and walk into the game after the player had been told the join failed.
      const stalledPeer = this.peer
      this.peer = null
      this.hostConn = null
      stalledPeer?.destroy()
    }, ATTEMPT_TIMEOUT_MS)
  }

  private clearAttemptTimeout(): void {
    if (this.attemptTimer !== null) {
      window.clearTimeout(this.attemptTimer)
      this.attemptTimer = null
    }
  }

  /**
   * A guest's connection to the host went away for a reason we didn't ask for. Rather than
   * ending the session (the old behaviour — status 'closed', re-enter the room code by hand),
   * retry on a backoff, reusing the same playerId so the host hands back the same seat. Only
   * gives up, and only then reports 'closed', once the attempts are exhausted.
   */
  private handleGuestDisconnect(reason: string): void {
    if (this.deliberateDisconnect || this.role !== 'guest') return
    if (this.rejoinTimer !== null) return // a retry is already pending; don't stack them
    this.clearAttemptTimeout()
    if (!this.roomCode || this.rejoinAttempts >= MAX_REJOIN_ATTEMPTS) {
      this.emit('status', 'closed', reason)
      return
    }
    this.rejoinAttempts += 1
    this.emit('status', 'connecting', this.rejoinStatusDetail())
    this.rejoinTimer = window.setTimeout(() => {
      this.rejoinTimer = null
      if (this.deliberateDisconnect || !this.roomCode) return
      // Tear the old peer down first: it's dead, and leaving it registered would keep its
      // stale broker id alive alongside the new one. Detached BEFORE it is destroyed: destroy()
      // closes the old channel synchronously, and that 'close' must find it is no longer the
      // current connection (see the guards in openGuestConnection) — otherwise it re-entered
      // this method and queued a second retry that later tore down the fresh connection.
      const oldPeer = this.peer
      this.peer = null
      this.hostConn = null
      oldPeer?.destroy()
      void this.openGuestConnection(this.roomCode, true).catch(() => {
        // Surfaced through the status events above; a rejected promise here is expected on a
        // failed attempt and must not become an unhandled rejection.
      })
    }, rejoinDelayMs(this.rejoinAttempts))
  }

  private onGuestData(data: unknown) {
    const msg = this.parseIncoming(data)
    if (!msg) return
    switch (msg.type) {
      case 'WELCOME':
        this.ownSeat = msg.seat
        // Accepted into the pod — this attempt succeeded, so the next unexpected drop starts
        // its own fresh backoff rather than inheriting this one's spent attempts.
        this.clearAttemptTimeout()
        if (this.rejoinTimer !== null) {
          window.clearTimeout(this.rejoinTimer)
          this.rejoinTimer = null
        }
        this.rejoinAttempts = 0
        this.emit('welcomed')
        this.emit('seat', msg.seat)
        // The host has now actually accepted us into the pod — this is the real "connected"
        // moment, not just the raw channel opening (see joinGame's conn.on('open') doc).
        this.emit('status', 'connected')
        break
      case 'STATE':
        this.emit('board', msg.board)
        break
      case 'PLAYER_LEFT':
        this.emit('playerLeft', msg.playerId)
        break
      case 'GIVE_CARD':
        // The host delivered a card meant for us.
        if (msg.toPlayerId === this.local.playerId) this.emit('cardGiven', msg.card)
        break
      case 'RELOCATE_CARD':
        // The host delivered a reposition meant for one of our own cards.
        if (msg.toPlayerId === this.local.playerId) {
          this.emit('cardRelocated', { instanceId: msg.instanceId, x: msg.x, y: msg.y, atSeat: msg.atSeat })
        }
        break
      case 'TAP_CARD':
        // The host delivered a tap/untap request meant for one of our own cards.
        if (msg.toPlayerId === this.local.playerId) {
          this.emit('cardTapRequested', { instanceId: msg.instanceId, tapped: msg.tapped })
        }
        break
      case 'FLIP_CARD':
        // The host delivered a flip request meant for one of our own cards.
        if (msg.toPlayerId === this.local.playerId) {
          this.emit('cardFlipRequested', { instanceId: msg.instanceId })
        }
        break
      case 'DELETE_CARD':
        // The host delivered a delete request meant for one of our own cards.
        if (msg.toPlayerId === this.local.playerId) {
          this.emit('cardDeleteRequested', { instanceId: msg.instanceId })
        }
        break
      case 'RETURN_CARD':
        // The host delivered a "send it back to one of our own zones" request meant for one of our own cards.
        if (msg.toPlayerId === this.local.playerId) {
          this.emit('cardReturnRequested', { instanceId: msg.instanceId, toZone: msg.toZone, libraryPosition: msg.libraryPosition })
        }
        break
      case 'RECLAIM_CARD':
        // The host delivered a "give that card back to its owner" request meant for us.
        if (msg.toPlayerId === this.local.playerId) {
          this.emit('cardReclaimRequested', { instanceId: msg.instanceId, fromPlayerId: msg.fromPlayerId })
        }
        break
      case 'ROLL':
        this.emit('roll', msg.playerId, msg.name, msg.roll, msg.id)
        break
      case 'ROLL_DISMISS':
        this.emit('rollDismissed', msg.id)
        break
      case 'PING':
        this.emit('ping', msg.playerId, msg.name, msg.x, msg.y)
        break
      case 'HIGHLIGHT':
        this.emit('highlight', msg.instanceId)
        break
      case 'REACTION':
        this.emit('reaction', msg.playerId, msg.name, msg.emoji)
        break
      case 'TURN_PASS':
        this.emit('turnPass', msg.activeSeat, msg.turn, msg.firstSeat)
        break
      case 'RADIO':
        this.emit('radio', msg.station)
        break
      case 'DRAFT_ROSTER':
        this.emit('draftRoster', msg.roster)
        break
      case 'DRAFT_CONFIG':
        this.emit('draftConfig', msg.config)
        break
      case 'DRAFT_START':
        this.emit('draftStart')
        break
      case 'DRAFT_PACK':
        if (msg.toPlayerId === this.local.playerId) {
          this.emit('draftPack', { packId: msg.packId, round: msg.round, cards: msg.cards })
        }
        break
      case 'DRAFT_PICK_REJECTED':
        if (msg.toPlayerId === this.local.playerId) {
          this.emit('draftPickRejected', { packId: msg.packId, reason: msg.reason })
        }
        break
      case 'DRAFT_ROUND_COMPLETE':
        this.emit('draftRoundComplete', msg.round)
        break
      case 'DRAFT_COMPLETE':
        this.emit('draftComplete')
        break
      case 'DRAFT_PROGRESS':
        this.emit('draftProgress', msg.picksBySeat)
        break
      default:
        break
    }
  }

  // --- shared ------------------------------------------------------------

  /**
   * Publish this client's public board. Guests send to the host (which relays);
   * the host sends to every guest and updates its own cache so late joiners get
   * it on the next replay.
   */
  broadcastState(board: PublicBoard): void {
    const msg: NetMessage = { type: 'STATE', v: PROTOCOL_VERSION, board }
    if (this.role === 'host') {
      this.lastBoards.set(board.playerId, board)
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /**
   * Hand control of a card to another player. The host delivers directly; a guest
   * sends it to the host, which routes it on to the recipient.
   */
  giveCard(toPlayerId: string, card: GivenCard): boolean {
    const msg: Extract<NetMessage, { type: 'GIVE_CARD' }> = { type: 'GIVE_CARD', v: PROTOCOL_VERSION, toPlayerId, card }
    // The result matters: the caller removes the card from its own board once this returns, so
    // "sent" has to mean it actually left. During a reconnect there is no open channel, and a
    // give that silently went nowhere used to delete the card from the game.
    if (this.role === 'host') return this.deliverGive(msg)
    if (this.role === 'guest' && this.hostConn) return this.sendTo(this.hostConn, msg)
    return false
  }

  /**
   * Reposition a card on another player's board without taking control of it. Same
   * directed routing as giveCard: the host delivers directly, a guest sends to the
   * host, which routes it on to the card's actual owner.
   */
  relocateCard(toPlayerId: string, instanceId: string, x: number, y: number, atSeat?: Seat): void {
    const msg: NetMessage = { type: 'RELOCATE_CARD', v: PROTOCOL_VERSION, toPlayerId, instanceId, x, y, atSeat }
    if (this.role === 'host') {
      this.deliverRelocate(msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /**
   * Ask the owner of a card sitting on OUR board (a taken/relocated card) to tap or untap it.
   * Same directed routing as relocateCard; the owner's client applies SET_TAPPED and the result
   * comes back to everyone through their next STATE broadcast.
   */
  tapCard(toPlayerId: string, instanceId: string, tapped: boolean): void {
    const msg: NetMessage = { type: 'TAP_CARD', v: PROTOCOL_VERSION, toPlayerId, instanceId, tapped }
    if (this.role === 'host') {
      this.deliverTap(msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /**
   * Ask the owner of a card sitting on OUR board (a taken/relocated card) to flip it face
   * up/down. Same directed routing as tapCard; the owner's client applies FLIP_CARD and the
   * result comes back to everyone through their next STATE broadcast.
   */
  flipCard(toPlayerId: string, instanceId: string): void {
    const msg: NetMessage = { type: 'FLIP_CARD', v: PROTOCOL_VERSION, toPlayerId, instanceId }
    if (this.role === 'host') {
      this.deliverFlip(msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /**
   * Ask the owner of a card sitting on OUR board (a taken/relocated card) to send it to their
   * own graveyard — it's still legally theirs even though it's sitting on our quadrant, so
   * deleting it has to land with them, not us. Same directed routing as tapCard/flipCard; the
   * owner's client applies MOVE_CARD and the result comes back to everyone through their next
   * STATE broadcast.
   */
  deleteCard(toPlayerId: string, instanceId: string): void {
    const msg: NetMessage = { type: 'DELETE_CARD', v: PROTOCOL_VERSION, toPlayerId, instanceId }
    if (this.role === 'host') {
      this.deliverDelete(msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /**
   * Ask the owner of a card sitting on OUR board (a taken/relocated/given card) to send it back
   * to one of their own zones (hand/library/exile/command — graveyard has its own dedicated
   * deleteCard, battlefield its own relocateCard). Same directed routing as deleteCard; the
   * owner's client applies MOVE_CARD and the result comes back to everyone through their next
   * STATE broadcast.
   */
  returnCard(toPlayerId: string, instanceId: string, toZone: 'hand' | 'library' | 'exile' | 'command', libraryPosition?: 'top' | 'bottom'): void {
    const msg: NetMessage = { type: 'RETURN_CARD', v: PROTOCOL_VERSION, toPlayerId, instanceId, toZone, libraryPosition }
    if (this.role === 'host') {
      this.deliverReturn(msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /**
   * Ask the player currently holding one of OUR cards to hand it back (see ReclaimCardMessage).
   * Same directed routing as returnCard; they answer with a normal giveCard.
   */
  reclaimCard(toPlayerId: string, instanceId: string): void {
    const msg: NetMessage = { type: 'RECLAIM_CARD', v: PROTOCOL_VERSION, toPlayerId, fromPlayerId: this.local.playerId, instanceId }
    if (this.role === 'host') {
      this.deliverReclaim(msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /**
   * Publish a die/coin roll to the pod. Not cached anywhere (unlike broadcastState) —
   * a late joiner simply never sees rolls that happened before they joined.
   */
  broadcastRoll(roll: RollResult, id?: string): void {
    const msg: NetMessage = { type: 'ROLL', v: PROTOCOL_VERSION, playerId: this.local.playerId, name: this.local.name, roll, id }
    if (this.role === 'host') {
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /** Take back a roll we published, clearing it from everyone's log (see RollDismissMessage).
   *  Self-emitted like broadcastTurnPass: the log has no separate "my own" render path, so the
   *  sender has to hear its own dismissal too, not just whoever it's relayed to. */
  broadcastRollDismiss(id: string): void {
    const msg: NetMessage = { type: 'ROLL_DISMISS', v: PROTOCOL_VERSION, id }
    this.emit('rollDismissed', id)
    if (this.role === 'host') {
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /** Publish a "look here" ping to the pod. Not cached, same as broadcastRoll. */
  broadcastPing(x: number, y: number): void {
    const msg: NetMessage = { type: 'PING', v: PROTOCOL_VERSION, playerId: this.local.playerId, name: this.local.name, x, y }
    if (this.role === 'host') {
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /** Publish a flash-highlight for a specific card to the pod. Not cached, same as broadcastPing. */
  broadcastHighlight(instanceId: string): void {
    const msg: NetMessage = { type: 'HIGHLIGHT', v: PROTOCOL_VERSION, instanceId }
    if (this.role === 'host') {
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /** Publish a one-click emoji reaction to the pod. Not cached, same as broadcastPing. */
  broadcastReaction(emoji: string): void {
    const msg: NetMessage = { type: 'REACTION', v: PROTOCOL_VERSION, playerId: this.local.playerId, name: this.local.name, emoji }
    if (this.role === 'host') {
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /** Publish whose turn it is now. Cached (unlike broadcastRoll/broadcastPing) so a late
   *  joiner gets it via the HELLO replay instead of waiting for the next pass. */
  broadcastTurnPass(activeSeat: Seat, turn?: number, firstSeat?: Seat): void {
    const msg: NetMessage = { type: 'TURN_PASS', v: PROTOCOL_VERSION, activeSeat, turn, firstSeat }
    // Unlike broadcastState (whose sender always renders its own board locally, never
    // through the `boards` map), the turn highlight has no separate "my own" render path —
    // it's driven entirely by this one shared value, so every sender (host or guest) has
    // to hear its own pass too, not just whoever it gets relayed to.
    this.emit('turnPass', activeSeat, turn, firstSeat)
    if (turn !== undefined) this.lastTurn = turn
    if (firstSeat !== undefined) this.lastFirstSeat = firstSeat
    if (this.role === 'host') {
      this.lastActiveSeat = activeSeat
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  /** Change the shared table radio's station (null to turn it off). Cached like
   *  broadcastTurnPass, and self-emitted for the same reason: there's no separate "my own"
   *  render path for the radio, so the sender has to hear its own change too, not just
   *  whoever it gets relayed to. */
  broadcastRadio(station: string | null): void {
    const msg: NetMessage = { type: 'RADIO', v: PROTOCOL_VERSION, station }
    this.emit('radio', station)
    if (this.role === 'host') {
      this.lastRadioStation = station
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
  }

  // --- draft mode (see draftProtocol.ts) ----------------------------------

  /** Host only: publish the cube/pack settings for the lobby. Self-emitted like
   *  broadcastTurnPass/broadcastRadio — no separate "my own" render path. */
  broadcastDraftConfig(config: DraftConfigPayload): void {
    const msg: NetMessage = { type: 'DRAFT_CONFIG', v: PROTOCOL_VERSION, config }
    this.emit('draftConfig', config)
    if (this.role === 'host') {
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    }
  }

  /** Host only: lobby -> drafting transition. Delivering each seat's first pack is a separate
   *  step (sendDraftPack) — this message is just the phase change. */
  broadcastDraftStart(): void {
    const msg: NetMessage = { type: 'DRAFT_START', v: PROTOCOL_VERSION }
    this.emit('draftStart')
    if (this.role === 'host') {
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    }
  }

  /** Host only: deliver the pack `toPlayerId` now holds — a fresh deal, or the result of
   *  someone else's pick passing it along. Directed, same routing shape as giveCard. */
  sendDraftPack(toPlayerId: string, packId: string, round: number, cards: string[]): void {
    if (toPlayerId === this.local.playerId) {
      this.emit('draftPack', { packId, round, cards })
      return
    }
    const msg: NetMessage = { type: 'DRAFT_PACK', v: PROTOCOL_VERSION, toPlayerId, packId, round, cards }
    const conn = this.findGuestConn(toPlayerId)
    if (conn) this.sendTo(conn, msg)
  }

  /** Pick a card from our currently-held pack. Unlike every other directed send here, this
   *  always goes to the host as arbiter — a host picking its own card resolves it locally
   *  with no wire round-trip, same self-apply pattern as broadcastTurnPass/broadcastRadio.
   *
   *  The host's resolution (draftPickReceived's listener in useDraftSession) can itself
   *  cascade through several more emits — progress, a round wrapping up, the whole draft
   *  completing — each driving its own React state update. For a *guest's* pick that
   *  cascade is naturally async (it arrives over the wire), but the host's own pick would
   *  otherwise run the whole chain synchronously nested inside the click handler that called
   *  this. Deferring one microtask breaks that reentrancy — same effect either way from the
   *  user's perspective (still resolves before the next paint), just outside the original
   *  call stack. */
  sendDraftPick(packId: string, scryfallId: string): boolean {
    if (this.role === 'host') {
      queueMicrotask(() => this.emit('draftPickReceived', { fromPlayerId: this.local.playerId, packId, scryfallId }))
      return true
    }
    if (this.role === 'guest' && this.hostConn) {
      const msg: NetMessage = { type: 'DRAFT_PICK', v: PROTOCOL_VERSION, packId, scryfallId }
      return this.sendTo(this.hostConn, msg)
    }
    return false
  }

  /** Host only: tell one player their pick didn't apply (defensive — e.g. a stale double-click). */
  sendDraftPickRejected(toPlayerId: string, packId: string, reason: string): void {
    if (toPlayerId === this.local.playerId) {
      this.emit('draftPickRejected', { packId, reason })
      return
    }
    const msg: NetMessage = { type: 'DRAFT_PICK_REJECTED', v: PROTOCOL_VERSION, toPlayerId, packId, reason }
    const conn = this.findGuestConn(toPlayerId)
    if (conn) this.sendTo(conn, msg)
  }

  /** Host only: every pack in this round has been fully picked through. */
  broadcastDraftRoundComplete(round: number): void {
    const msg: NetMessage = { type: 'DRAFT_ROUND_COMPLETE', v: PROTOCOL_VERSION, round }
    this.emit('draftRoundComplete', round)
    if (this.role === 'host') {
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    }
  }

  /** Host only: every round is done; move to deck-building. */
  broadcastDraftComplete(): void {
    const msg: NetMessage = { type: 'DRAFT_COMPLETE', v: PROTOCOL_VERSION }
    this.emit('draftComplete')
    if (this.role === 'host') {
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    }
  }

  /** Host only: sparse seat->pick-count map, for a "waiting on…" readout. */
  broadcastDraftProgress(picksBySeat: Partial<Record<Seat, number>>): void {
    const msg: NetMessage = { type: 'DRAFT_PROGRESS', v: PROTOCOL_VERSION, picksBySeat }
    this.emit('draftProgress', picksBySeat)
    if (this.role === 'host') {
      for (const guest of this.guests.values()) this.sendTo(guest.conn, msg)
    }
  }

  /** Host only: current seat->playerId directory, so a higher layer (useDraftSession) can
   *  translate a draftEngine seat into the `toPlayerId` sendDraftPack/sendDraftPickRejected need. */
  getSeatPlayerIds(): Partial<Record<Seat, string>> {
    const map: Partial<Record<Seat, string>> = {}
    if (this.ownSeat !== null) map[this.ownSeat] = this.local.playerId
    for (const guest of this.guests.values()) {
      if (guest.seat !== null && guest.playerId) map[guest.seat] = guest.playerId
    }
    return map
  }

  /** False when the connection isn't open and the message was dropped. */
  private sendTo(conn: DataConnection, msg: NetMessage): boolean {
    if (!conn.open) return false
    conn.send(serialize(msg))
    return true
  }

  disconnect(): void {
    // Set before anything is torn down: the teardown below fires the same 'close' events an
    // unexpected drop would, and without this flag handleGuestDisconnect would dutifully start
    // reconnecting to a session the player just chose to leave.
    this.deliberateDisconnect = true
    if (this.rejoinTimer !== null) {
      window.clearTimeout(this.rejoinTimer)
      this.rejoinTimer = null
    }
    this.clearAttemptTimeout()
    this.roomCode = null
    this.rejoinAttempts = 0
    this.versionMismatchReported = false
    this.guests.clear()
    this.lastBoards.clear()
    this.lastSeatByPlayerId.clear()
    this.lastActiveSeat = null
    this.lastTurn = null
    this.lastFirstSeat = null
    this.lastRadioStation = null
    this.hostConn = null
    // Detached first — see handleSignalingDisconnect.
    const peer = this.peer
    this.peer = null
    peer?.destroy()
    this.role = null
    this.ownSeat = null
    this.emit('status', 'closed')
  }
}

// PeerJS error types that are about the broker (signaling) socket rather than a peer-to-peer
// data connection.
const SIGNALING_ERROR_TYPES = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'])

function describePeerError(err: unknown): string {
  const type = (err as { type?: string })?.type
  switch (type) {
    case 'peer-unavailable':
      return "Couldn't find a game with that code. Check it and try again."
    case 'unavailable-id':
      return 'That room code is taken. Try hosting again.'
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Network problem reaching the signaling server.'
    case 'webrtc':
      return "Couldn't establish a direct connection (this can happen on some home networks)."
    default:
      return (err as { message?: string })?.message ?? 'Connection error.'
  }
}

/** Re-exported so callers can validate/derive a code without importing protocol directly. */
export { isValidRoomCode, peerIdToRoomCode } from './protocol'
