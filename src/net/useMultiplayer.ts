/**
 * React glue around `PeerConnection` — owns the connection for the lifetime of a
 * playtest session and projects its events into render state.
 *
 * This is the single object steps 4 (shared-table mirror) and 5 (Host/Join UI)
 * build on: it exposes the local seat, the map of opponents' public boards to
 * mirror, connection status, and the host/join/leave/broadcast controls.
 *
 * The connection is created only on an explicit `host()`/`join()` call (a user
 * action), never inside an effect, so React StrictMode's double-mount can't
 * spawn a duplicate peer.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { PeerConnection, type ConnectionStatus, type LocalPlayer, type RelocatedCard } from './peerConnection'
import type { GivenCard, PublicBoard, RollResult, Seat } from './protocol'

export type MultiplayerRole = 'host' | 'guest'

export type MultiplayerSession = {
  role: MultiplayerRole | null
  status: ConnectionStatus
  /** Human-readable reason accompanying an `error`/`closed` status, if any. */
  statusDetail: string | null
  /** Host's room code to share; null until hosting registers. */
  roomCode: string | null
  /** This client's own seat, or null before it's assigned. */
  seat: Seat | null
  /** Opponents' latest public boards, keyed by playerId (never includes self). */
  boards: Map<string, PublicBoard>
  /** Whose turn it is, for the highlight — a visual cue only, never enforced. Null until
   *  someone's first Pass Turn (or, for a late joiner, the host's cached replay). */
  activeSeat: Seat | null
  /** True once the transport is live (regardless of how many others are seated). */
  isActive: boolean
  host: () => Promise<void>
  join: (roomCode: string) => Promise<void>
  leave: () => void
  /** Publish this client's public board to the pod. No-op when not connected. */
  broadcast: (board: PublicBoard) => void
  /** Hand control of a card to another player. No-op when not connected. */
  giveCard: (toPlayerId: string, card: GivenCard) => void
  /** Reposition a card on another player's board, without taking control of it. No-op when not connected. */
  relocateCard: (toPlayerId: string, instanceId: string, x: number, y: number, atSeat?: Seat) => void
  /** Ask a card's owner to tap/untap it (a taken card sitting on our board). No-op when not connected. */
  tapRemoteCard: (toPlayerId: string, instanceId: string, tapped: boolean) => void
  /** Ask a card's owner to flip it face up/down (a taken card sitting on our board). No-op when not connected. */
  flipRemoteCard: (toPlayerId: string, instanceId: string) => void
  /** Ask a card's owner to send it to their own graveyard (a taken card sitting on our board). No-op when not connected. */
  deleteRemoteCard: (toPlayerId: string, instanceId: string) => void
  /** Publish a die/coin roll to the pod. No-op when not connected. */
  broadcastRoll: (roll: RollResult) => void
  /** Publish a "look here" ping (table-space x/y) to the pod. No-op when not connected. */
  broadcastPing: (x: number, y: number) => void
  /** Publish a flash-highlight for a specific card to the pod. No-op when not connected. */
  broadcastHighlight: (instanceId: string) => void
  /** Publish a one-click emoji reaction to the pod. No-op when not connected. */
  broadcastReaction: (emoji: string) => void
  /** Publish whose turn it is now. No-op when not connected. */
  broadcastTurnPass: (activeSeat: Seat) => void
  /** The shared table radio's current station id (see RADIO_STATIONS), or null when it's off —
   *  like `activeSeat`, a late joiner gets whatever's already cached on the host. */
  radioStation: string | null
  /** Change the shared table radio's station (null to turn it off). No-op when not connected. */
  broadcastRadio: (station: string | null) => void
}

export function useMultiplayer(
  local: LocalPlayer,
  onCardReceived?: (card: GivenCard) => void,
  onRollReceived?: (playerId: string, name: string, roll: RollResult) => void,
  onPingReceived?: (playerId: string, name: string, x: number, y: number) => void,
  onCardRelocated?: (card: RelocatedCard) => void,
  onCardTapRequested?: (req: { instanceId: string; tapped: boolean }) => void,
  onCardFlipRequested?: (req: { instanceId: string }) => void,
  onCardDeleteRequested?: (req: { instanceId: string }) => void,
  onHighlightReceived?: (instanceId: string) => void,
  onReactionReceived?: (playerId: string, name: string, emoji: string) => void,
): MultiplayerSession {
  const connRef = useRef<PeerConnection | null>(null)

  // Keep the latest identity in a ref so host()/join() (created once) always read
  // the current profile name / deck format without being re-created.
  const localRef = useRef(local)
  localRef.current = local
  const onCardReceivedRef = useRef(onCardReceived)
  onCardReceivedRef.current = onCardReceived
  const onCardRelocatedRef = useRef(onCardRelocated)
  onCardRelocatedRef.current = onCardRelocated
  const onCardTapRequestedRef = useRef(onCardTapRequested)
  onCardTapRequestedRef.current = onCardTapRequested
  const onCardFlipRequestedRef = useRef(onCardFlipRequested)
  onCardFlipRequestedRef.current = onCardFlipRequested
  const onCardDeleteRequestedRef = useRef(onCardDeleteRequested)
  onCardDeleteRequestedRef.current = onCardDeleteRequested
  const onRollReceivedRef = useRef(onRollReceived)
  onRollReceivedRef.current = onRollReceived
  const onPingReceivedRef = useRef(onPingReceived)
  onPingReceivedRef.current = onPingReceived
  const onHighlightReceivedRef = useRef(onHighlightReceived)
  onHighlightReceivedRef.current = onHighlightReceived
  const onReactionReceivedRef = useRef(onReactionReceived)
  onReactionReceivedRef.current = onReactionReceived

  const [role, setRole] = useState<MultiplayerRole | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [statusDetail, setStatusDetail] = useState<string | null>(null)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [seat, setSeat] = useState<Seat | null>(null)
  const [boards, setBoards] = useState<Map<string, PublicBoard>>(new Map())
  const [activeSeat, setActiveSeat] = useState<Seat | null>(null)
  const [radioStation, setRadioStation] = useState<string | null>(null)

  const reset = useCallback(() => {
    setRole(null)
    setStatus('idle')
    setStatusDetail(null)
    setRoomCode(null)
    setSeat(null)
    setBoards(new Map())
    setActiveSeat(null)
    setRadioStation(null)
  }, [])

  /** Builds a connection wired to our state setters, or returns the existing one. */
  const ensureConnection = useCallback(() => {
    if (connRef.current) return connRef.current
    const conn = new PeerConnection(localRef.current)
    conn.on('status', (s, detail) => {
      setStatus(s)
      setStatusDetail(detail ?? null)
      // A dropped host / fatal error tears the pod down; clear the mirrors.
      if (s === 'closed' || s === 'error') setBoards(new Map())
    })
    conn.on('code', (code) => setRoomCode(code))
    conn.on('seat', (s) => setSeat(s))
    conn.on('board', (board) => {
      setBoards((prev) => {
        // Defensive: never mirror our own board even if it somehow echoes back.
        if (board.playerId === localRef.current.playerId) return prev
        const next = new Map(prev)
        next.set(board.playerId, board)
        return next
      })
    })
    conn.on('playerLeft', (playerId) => {
      setBoards((prev) => {
        if (!prev.has(playerId)) return prev
        const next = new Map(prev)
        next.delete(playerId)
        return next
      })
    })
    conn.on('cardGiven', (card) => onCardReceivedRef.current?.(card))
    conn.on('cardRelocated', (card) => onCardRelocatedRef.current?.(card))
    conn.on('cardTapRequested', (req) => onCardTapRequestedRef.current?.(req))
    conn.on('cardFlipRequested', (req) => onCardFlipRequestedRef.current?.(req))
    conn.on('cardDeleteRequested', (req) => onCardDeleteRequestedRef.current?.(req))
    conn.on('roll', (playerId, name, roll) => onRollReceivedRef.current?.(playerId, name, roll))
    conn.on('ping', (playerId, name, x, y) => onPingReceivedRef.current?.(playerId, name, x, y))
    conn.on('highlight', (instanceId) => onHighlightReceivedRef.current?.(instanceId))
    conn.on('reaction', (playerId, name, emoji) => onReactionReceivedRef.current?.(playerId, name, emoji))
    conn.on('turnPass', (activeSeat) => setActiveSeat(activeSeat))
    conn.on('radio', (station) => setRadioStation(station))
    connRef.current = conn
    return conn
  }, [])

  const host = useCallback(async () => {
    setRole('host')
    await ensureConnection().hostGame()
  }, [ensureConnection])

  const join = useCallback(
    async (code: string) => {
      setRole('guest')
      await ensureConnection().joinGame(code)
    },
    [ensureConnection],
  )

  const leave = useCallback(() => {
    connRef.current?.disconnect()
    connRef.current = null
    reset()
  }, [reset])

  const broadcast = useCallback((board: PublicBoard) => {
    connRef.current?.broadcastState(board)
  }, [])

  const giveCard = useCallback((toPlayerId: string, card: GivenCard) => {
    connRef.current?.giveCard(toPlayerId, card)
  }, [])

  const relocateCard = useCallback((toPlayerId: string, instanceId: string, x: number, y: number, atSeat?: Seat) => {
    connRef.current?.relocateCard(toPlayerId, instanceId, x, y, atSeat)
  }, [])

  const tapRemoteCard = useCallback((toPlayerId: string, instanceId: string, tapped: boolean) => {
    connRef.current?.tapCard(toPlayerId, instanceId, tapped)
  }, [])

  const flipRemoteCard = useCallback((toPlayerId: string, instanceId: string) => {
    connRef.current?.flipCard(toPlayerId, instanceId)
  }, [])

  const deleteRemoteCard = useCallback((toPlayerId: string, instanceId: string) => {
    connRef.current?.deleteCard(toPlayerId, instanceId)
  }, [])

  const broadcastRoll = useCallback((roll: RollResult) => {
    connRef.current?.broadcastRoll(roll)
  }, [])

  const broadcastPing = useCallback((x: number, y: number) => {
    connRef.current?.broadcastPing(x, y)
  }, [])

  const broadcastHighlight = useCallback((instanceId: string) => {
    connRef.current?.broadcastHighlight(instanceId)
  }, [])

  const broadcastReaction = useCallback((emoji: string) => {
    connRef.current?.broadcastReaction(emoji)
  }, [])

  const broadcastTurnPass = useCallback((next: Seat) => {
    connRef.current?.broadcastTurnPass(next)
  }, [])

  const broadcastRadio = useCallback((station: string | null) => {
    connRef.current?.broadcastRadio(station)
  }, [])

  // Tear the connection down if the component using this hook unmounts (e.g.
  // leaving the playtest view) so we don't leak an open peer.
  useEffect(() => {
    return () => {
      connRef.current?.disconnect()
      connRef.current = null
    }
  }, [])

  const isActive = status === 'connecting' || status === 'connected'

  return {
    role,
    status,
    statusDetail,
    roomCode,
    seat,
    boards,
    activeSeat,
    isActive,
    host,
    join,
    leave,
    broadcast,
    giveCard,
    relocateCard,
    tapRemoteCard,
    flipRemoteCard,
    deleteRemoteCard,
    broadcastRoll,
    broadcastPing,
    broadcastHighlight,
    broadcastReaction,
    broadcastTurnPass,
    radioStation,
    broadcastRadio,
  }
}
