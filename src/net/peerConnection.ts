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
import {
  HOST_SEAT,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  type GivenCard,
  type NetMessage,
  type PublicBoard,
  type RollResult,
  type Seat,
  deserialize,
  generateRoomCode,
  nextFreeSeat,
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
  /** A die/coin roll from any player (including relayed ones from other guests). */
  roll: (playerId: string, name: string, roll: RollResult) => void
  /** A "look here" ping at a table-space point, from any player (including relayed ones). */
  ping: (playerId: string, name: string, x: number, y: number) => void
  /** Flash-highlight a specific card, from any player (including relayed ones). */
  highlight: (instanceId: string) => void
  /** A one-click emoji reaction, from any player (including relayed ones). */
  reaction: (playerId: string, name: string, emoji: string) => void
  /** Whose turn it is now, from any player's Pass Turn (including relayed ones, and the
   *  host's replay of its cached value to a newly-joined guest). */
  turnPass: (activeSeat: Seat) => void
  /** The shared table radio's station changed (including relayed ones, and the host's replay
   *  of its cached value to a newly-joined guest). Null means it's off. */
  radio: (station: string | null) => void
}

type EventKey = keyof PeerConnectionEvents

/** Per-guest bookkeeping the host keeps for each open connection. Seat is assigned once
 *  HELLO arrives (see acceptGuest/onHostData), not at raw connection-open time — assignment
 *  needs to know playerId first so a reconnecting player can be offered their old seat back. */
type GuestRecord = {
  conn: DataConnection
  seat: Seat | null
  playerId?: string // learned from HELLO
}

const MAX_ID_RETRIES = 5

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
  // Cached like lastActiveSeat so a late joiner hears whatever station is already playing
  // instead of silence until someone happens to change it.
  private lastRadioStation: string | null = null

  // Guest state: the single connection to the host.
  private hostConn: DataConnection | null = null

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
    roll: new Set(),
    ping: new Set(),
    highlight: new Set(),
    reaction: new Set(),
    turnPass: new Set(),
    radio: new Set(),
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(handler as (...a: any[]) => void)(...args)
    }
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

        peer.on('open', () => {
          this.emit('seat', HOST_SEAT)
          this.emit('code', code)
          this.emit('status', 'connected')
          resolve(code)
        })
        peer.on('connection', (conn) => this.acceptGuest(conn))
        peer.on('error', (err) => {
          const type = (err as unknown as { type?: string }).type
          if (type === 'unavailable-id' && retriesLeft > 0) {
            // Code collided with an existing room — throw it away and try another.
            peer.destroy()
            attempt(retriesLeft - 1)
            return
          }
          this.emit('status', 'error', describePeerError(err))
          reject(err)
        })
        peer.on('disconnected', () => this.emit('status', 'error', 'Lost connection to the signaling server.'))
      }
      attempt(MAX_ID_RETRIES)
    })
  }

  private acceptGuest(conn: DataConnection) {
    conn.on('open', () => {
      // Reject once the pod is full — the guest's connection just closes. Seat isn't
      // assigned yet (that happens on HELLO, once we know playerId — see onHostData),
      // so this is just a raw-connection-slot cap.
      if (this.guests.size >= MAX_PLAYERS - 1) {
        conn.close()
        return
      }
      this.guests.set(conn.peer, { conn, seat: null })
    })
    conn.on('data', (data) => this.onHostData(conn, data))
    conn.on('close', () => this.dropGuest(conn.peer))
    conn.on('error', () => this.dropGuest(conn.peer))
  }

  private onHostData(conn: DataConnection, data: unknown) {
    const msg = deserialize(data)
    if (!msg) return
    const record = this.guests.get(conn.peer)
    if (!record) return

    switch (msg.type) {
      case 'HELLO': {
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
        this.lastSeatByPlayerId.set(msg.playerId, seat)
        // Tell the guest its seat, then replay every board we already know so it
        // sees a populated table immediately instead of empty quadrants.
        this.sendTo(conn, { type: 'WELCOME', v: PROTOCOL_VERSION, playerId: msg.playerId, seat })
        for (const board of this.lastBoards.values()) {
          this.sendTo(conn, { type: 'STATE', v: PROTOCOL_VERSION, board })
        }
        if (this.lastActiveSeat !== null) {
          this.sendTo(conn, { type: 'TURN_PASS', v: PROTOCOL_VERSION, activeSeat: this.lastActiveSeat })
        }
        if (this.lastRadioStation !== null) {
          this.sendTo(conn, { type: 'RADIO', v: PROTOCOL_VERSION, station: this.lastRadioStation })
        }
        break
      }
      case 'STATE': {
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
        // A guest handed a card to someone; route it to the intended recipient.
        this.deliverGive(msg)
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
      case 'ROLL': {
        this.emit('roll', msg.playerId, msg.name, msg.roll)
        // Fan out to every other guest, same star-relay pattern as STATE.
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
        this.emit('turnPass', msg.activeSeat)
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
      default:
        break
    }
  }

  /** Deliver a GIVE_CARD to its target: to us if we're the recipient, else to that guest's connection. */
  private deliverGive(msg: Extract<NetMessage, { type: 'GIVE_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardGiven', msg.card)
      return
    }
    for (const guest of this.guests.values()) {
      if (guest.playerId === msg.toPlayerId) {
        this.sendTo(guest.conn, msg)
        return
      }
    }
  }

  /** Deliver a RELOCATE_CARD to its target board's owner, same routing as deliverGive. */
  private deliverRelocate(msg: Extract<NetMessage, { type: 'RELOCATE_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardRelocated', { instanceId: msg.instanceId, x: msg.x, y: msg.y, atSeat: msg.atSeat })
      return
    }
    for (const guest of this.guests.values()) {
      if (guest.playerId === msg.toPlayerId) {
        this.sendTo(guest.conn, msg)
        return
      }
    }
  }

  /** Deliver a TAP_CARD to the card owner's client, same routing as deliverRelocate. */
  private deliverTap(msg: Extract<NetMessage, { type: 'TAP_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardTapRequested', { instanceId: msg.instanceId, tapped: msg.tapped })
      return
    }
    for (const guest of this.guests.values()) {
      if (guest.playerId === msg.toPlayerId) {
        this.sendTo(guest.conn, msg)
        return
      }
    }
  }

  /** Deliver a FLIP_CARD to the card owner's client, same routing as deliverTap. */
  private deliverFlip(msg: Extract<NetMessage, { type: 'FLIP_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardFlipRequested', { instanceId: msg.instanceId })
      return
    }
    for (const guest of this.guests.values()) {
      if (guest.playerId === msg.toPlayerId) {
        this.sendTo(guest.conn, msg)
        return
      }
    }
  }

  /** Deliver a DELETE_CARD to the card owner's client, same routing as deliverFlip. */
  private deliverDelete(msg: Extract<NetMessage, { type: 'DELETE_CARD' }>) {
    if (msg.toPlayerId === this.local.playerId) {
      this.emit('cardDeleteRequested', { instanceId: msg.instanceId })
      return
    }
    for (const guest of this.guests.values()) {
      if (guest.playerId === msg.toPlayerId) {
        this.sendTo(guest.conn, msg)
        return
      }
    }
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
    }
  }

  // --- guest -------------------------------------------------------------

  /** Connect to a host by room code. Resolves once the data channel opens. */
  joinGame(roomCode: string): Promise<void> {
    this.role = 'guest'
    this.emit('status', 'connecting')
    return new Promise<void>((resolve, reject) => {
      const peer = new Peer()
      this.peer = peer

      peer.on('open', () => {
        const conn = peer.connect(roomCodeToPeerId(roomCode), { reliable: true })
        this.hostConn = conn
        conn.on('open', () => {
          this.emit('status', 'connected')
          this.sendTo(conn, {
            type: 'HELLO',
            v: PROTOCOL_VERSION,
            playerId: this.local.playerId,
            name: this.local.name,
            deckFormat: this.local.deckFormat,
          })
          resolve()
        })
        conn.on('data', (data) => this.onGuestData(data))
        conn.on('close', () => this.emit('status', 'closed', 'The host ended the session.'))
        conn.on('error', (err) => this.emit('status', 'error', describePeerError(err)))
      })
      peer.on('error', (err) => {
        this.emit('status', 'error', describePeerError(err))
        reject(err)
      })
      peer.on('disconnected', () => this.emit('status', 'error', 'Lost connection to the signaling server.'))
    })
  }

  private onGuestData(data: unknown) {
    const msg = deserialize(data)
    if (!msg) return
    switch (msg.type) {
      case 'WELCOME':
        this.ownSeat = msg.seat
        this.emit('seat', msg.seat)
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
      case 'ROLL':
        this.emit('roll', msg.playerId, msg.name, msg.roll)
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
        this.emit('turnPass', msg.activeSeat)
        break
      case 'RADIO':
        this.emit('radio', msg.station)
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
  giveCard(toPlayerId: string, card: GivenCard): void {
    const msg: NetMessage = { type: 'GIVE_CARD', v: PROTOCOL_VERSION, toPlayerId, card }
    if (this.role === 'host') {
      this.deliverGive(msg)
    } else if (this.role === 'guest' && this.hostConn) {
      this.sendTo(this.hostConn, msg)
    }
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
   * Publish a die/coin roll to the pod. Not cached anywhere (unlike broadcastState) —
   * a late joiner simply never sees rolls that happened before they joined.
   */
  broadcastRoll(roll: RollResult): void {
    const msg: NetMessage = { type: 'ROLL', v: PROTOCOL_VERSION, playerId: this.local.playerId, name: this.local.name, roll }
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
  broadcastTurnPass(activeSeat: Seat): void {
    const msg: NetMessage = { type: 'TURN_PASS', v: PROTOCOL_VERSION, activeSeat }
    // Unlike broadcastState (whose sender always renders its own board locally, never
    // through the `boards` map), the turn highlight has no separate "my own" render path —
    // it's driven entirely by this one shared value, so every sender (host or guest) has
    // to hear its own pass too, not just whoever it gets relayed to.
    this.emit('turnPass', activeSeat)
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

  private sendTo(conn: DataConnection, msg: NetMessage): void {
    if (conn.open) conn.send(serialize(msg))
  }

  disconnect(): void {
    this.guests.clear()
    this.lastBoards.clear()
    this.lastSeatByPlayerId.clear()
    this.lastActiveSeat = null
    this.lastRadioStation = null
    this.hostConn = null
    this.peer?.destroy()
    this.peer = null
    this.role = null
    this.ownSeat = null
    this.emit('status', 'closed')
  }
}

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
