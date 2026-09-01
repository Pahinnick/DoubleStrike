/**
 * React glue around a dedicated `PeerConnection` for draft mode — deliberately its own instance,
 * separate from useMultiplayer's (which the regular Commander VTT owns), rather than growing
 * that already-large, live-tested hook. Draft mode's own lobby/room lifecycle is much simpler
 * (no board mirrors, no card-movement routing) and this keeps the two fully decoupled while
 * draft mode is unfinished.
 *
 * Host-side pick resolution (round completion, dealing the next round) lives here rather than
 * in draftEngine.ts because it's orchestration glue over PeerConnection, not decidable pure
 * logic — same testing boundary the rest of net/ already draws (protocol.ts is unit-tested,
 * peerConnection.ts/useMultiplayer.ts are exercised live).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DraftConfigPayload } from '../net/draftProtocol'
import { PeerConnection, type ConnectionStatus } from '../net/peerConnection'
import type { Seat } from '../net/protocol'
import { applyPick, initDraftEngine, isRoundComplete, packsForRound, type DraftEngineState } from './draftEngine'
import type { CubeCard, DraftConfig } from './types'

export type DraftPhase = 'lobby' | 'drafting' | 'complete'

export type CurrentPack = { packId: string; round: number; cards: string[] }

export type DraftSession = {
  role: 'host' | 'guest' | null
  status: ConnectionStatus
  statusDetail: string | null
  roomCode: string | null
  seat: Seat | null
  /** Who's seated where, for the lobby roster. */
  roster: Partial<Record<Seat, string>>
  phase: DraftPhase
  config: DraftConfigPayload | null
  /** The pack we're currently picking from, or null if we're waiting on a neighbor. Picking is
   *  asynchronous per player — a faster neighbor can hand us a second pack before we've
   *  finished our first, so this is the front of an internal queue, not a single slot (see
   *  packQueueRef below); any pack behind it just waits its turn. */
  currentPack: CurrentPack | null
  /** Every card we've picked so far, in pick order. */
  myPool: string[]
  /** Sparse seat->pick-count map, for "waiting on…" — never reveals pack/pool contents. */
  picksBySeat: Partial<Record<Seat, number>>
  /** Set briefly when our own pick gets rejected (e.g. a stale double-click) — the picker UI
   *  should clear its optimistic state and wait for the next real DRAFT_PACK. */
  pickError: string | null
  host: () => Promise<void>
  join: (roomCode: string) => Promise<void>
  leave: () => void
  /** Host only: begin the draft from this cube — deals round 0 to every seated player.
   *  Requires exactly 4 seats filled (confirmed scope — no bot-filled seats). */
  startDraft: (cubeCards: CubeCard[], config: DraftConfig) => void
  /** Pick a card from our current pack. No-op if we don't currently hold a pack. */
  pickCard: (scryfallId: string) => void
}

export function useDraftSession(localPlayerId: string, localName: string): DraftSession {
  const connRef = useRef<PeerConnection | null>(null)
  const engineRef = useRef<DraftEngineState | null>(null)
  // Every pack we currently hold, oldest-received first — a plain ref (not state) because
  // pickCard needs to read-then-mutate it synchronously without risking a stale closure or a
  // double-fire under StrictMode's double-invoked updaters. `packQueueVersion` below just
  // forces a re-render whenever it changes; the array itself is always read fresh from the ref.
  const packQueueRef = useRef<CurrentPack[]>([])
  const [packQueueVersion, setPackQueueVersion] = useState(0)
  const bumpPackQueue = () => setPackQueueVersion((v) => v + 1)
  // The one pick we've optimistically applied locally but haven't heard confirmed (a new
  // DRAFT_PACK arriving is implicit confirmation) or rejected yet — see pickCard/
  // draftPickRejected below. Keyed by packId since, with a real queue, more than one pick
  // could theoretically be in flight; in practice the UI only ever has one outstanding.
  const pendingPicksRef = useRef<Map<string, { pack: CurrentPack; scryfallId: string }>>(new Map())
  const localIdRef = useRef(localPlayerId)
  localIdRef.current = localPlayerId
  const localNameRef = useRef(localName)
  localNameRef.current = localName

  const [role, setRole] = useState<'host' | 'guest' | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [statusDetail, setStatusDetail] = useState<string | null>(null)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [seat, setSeat] = useState<Seat | null>(null)
  const [roster, setRoster] = useState<Partial<Record<Seat, string>>>({})
  const [phase, setPhase] = useState<DraftPhase>('lobby')
  const [config, setConfig] = useState<DraftConfigPayload | null>(null)
  const [myPool, setMyPool] = useState<string[]>([])
  const [picksBySeat, setPicksBySeat] = useState<Partial<Record<Seat, number>>>({})
  const [pickError, setPickError] = useState<string | null>(null)

  const ensureConnection = useCallback(() => {
    if (connRef.current) return connRef.current
    const conn = new PeerConnection({ playerId: localIdRef.current, name: localNameRef.current, deckFormat: '' })
    conn.on('status', (s, detail) => {
      setStatus(s)
      setStatusDetail(detail ?? null)
    })
    conn.on('code', (code) => setRoomCode(code))
    conn.on('seat', (s) => setSeat(s))
    conn.on('draftRoster', (r) => setRoster(r))
    conn.on('draftConfig', (c) => setConfig(c))
    conn.on('draftStart', () => setPhase('drafting'))
    conn.on('draftPack', (pack) => {
      // Appended, not replaced — a faster neighbor can hand us a second pack before we've
      // finished picking through our first (see packQueueRef's doc).
      packQueueRef.current = [...packQueueRef.current, pack]
      bumpPackQueue()
      setPickError(null)
    })
    conn.on('draftPickRejected', ({ packId, reason }) => {
      // Roll back exactly the pack/pool addition this rejection refers to — it never landed,
      // so put the pack back at the FRONT of the queue (it's still the oldest one we hold).
      const pending = pendingPicksRef.current.get(packId)
      pendingPicksRef.current.delete(packId)
      if (pending) {
        packQueueRef.current = [pending.pack, ...packQueueRef.current]
        bumpPackQueue()
        setMyPool((prev) => (prev[prev.length - 1] === pending.scryfallId ? prev.slice(0, -1) : prev))
      }
      setPickError(reason)
    })
    conn.on('draftProgress', (p) => setPicksBySeat(p))
    conn.on('draftComplete', () => {
      setPhase('complete')
      packQueueRef.current = []
      bumpPackQueue()
    })

    // Host only: resolve every incoming pick request (including our own, self-routed by
    // sendDraftPick) against the authoritative engine state, then send whatever it decides.
    conn.on('draftPickReceived', ({ fromPlayerId, packId, scryfallId }) => {
      const state = engineRef.current
      if (!state) return
      const seatPlayerIds = conn.getSeatPlayerIds()
      const pickerSeatEntry = Object.entries(seatPlayerIds).find(([, playerId]) => playerId === fromPlayerId)
      if (!pickerSeatEntry) return
      const pickerSeat = Number(pickerSeatEntry[0]) as Seat

      const result = applyPick(state, packId, scryfallId, pickerSeat)
      if (!result.ok) {
        conn.sendDraftPickRejected(fromPlayerId, packId, result.reason)
        return
      }
      engineRef.current = result.nextState
      conn.broadcastDraftProgress(result.nextState.picksBySeat)

      if (result.passedTo) {
        const toPlayerId = seatPlayerIds[result.passedTo.toSeat]
        if (toPlayerId) conn.sendDraftPack(toPlayerId, result.passedTo.pack.packId, result.passedTo.pack.round, result.passedTo.pack.cards)
        return
      }

      if (!isRoundComplete(result.nextState, result.round)) return
      const isLastRound = result.round === state.config.packsPerPlayer - 1
      if (isLastRound) {
        conn.broadcastDraftComplete()
        return
      }
      conn.broadcastDraftRoundComplete(result.round)
      const nextRound = result.round + 1
      for (const pack of packsForRound(result.nextState, nextRound)) {
        const toPlayerId = seatPlayerIds[pack.holderSeat]
        if (toPlayerId) conn.sendDraftPack(toPlayerId, pack.packId, pack.round, pack.cards)
      }
    })

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
    engineRef.current = null
    pendingPicksRef.current.clear()
    packQueueRef.current = []
    bumpPackQueue()
    setRole(null)
    setStatus('idle')
    setStatusDetail(null)
    setRoomCode(null)
    setSeat(null)
    setRoster({})
    setPhase('lobby')
    setConfig(null)
    setMyPool([])
    setPicksBySeat({})
    setPickError(null)
  }, [])

  const startDraft = useCallback((cubeCards: CubeCard[], draftConfig: DraftConfig) => {
    const conn = connRef.current
    if (!conn) return
    const seatPlayerIds = conn.getSeatPlayerIds()
    const occupiedSeats = Object.keys(seatPlayerIds)
      .map((s) => Number(s) as Seat)
      .sort((a, b) => a - b)
    // Draft mode requires exactly 4 human players (no bot-filled seats) — the lobby UI should
    // already gate "Start Draft" on this, but guard here too since this is the one place that
    // actually deals cards.
    if (occupiedSeats.length !== 4) return

    const state = initDraftEngine(cubeCards, draftConfig, occupiedSeats)
    engineRef.current = state

    conn.broadcastDraftConfig({
      cubeId: draftConfig.cubeId,
      cubeName: draftConfig.cubeName,
      packSize: draftConfig.packSize,
      packsPerPlayer: draftConfig.packsPerPlayer,
    })
    conn.broadcastDraftStart()
    for (const pack of packsForRound(state, 0)) {
      const toPlayerId = seatPlayerIds[pack.holderSeat]
      if (toPlayerId) conn.sendDraftPack(toPlayerId, pack.packId, pack.round, pack.cards)
    }
  }, [])

  const pickCard = useCallback((scryfallId: string) => {
    const conn = connRef.current
    const pack = packQueueRef.current[0]
    if (!conn || !pack) return
    // Optimistic, same "sender applies locally" pattern the rest of this app's wire layer
    // uses — a rejection (draftPickRejected) rolls this back by restoring `pack` to the
    // front of the queue, leaving the picker waiting rather than silently losing the pack.
    pendingPicksRef.current.set(pack.packId, { pack, scryfallId })
    packQueueRef.current = packQueueRef.current.slice(1)
    bumpPackQueue()
    setMyPool((prev) => [...prev, scryfallId])
    conn.sendDraftPick(pack.packId, scryfallId)
  }, [])

  useEffect(() => {
    return () => {
      connRef.current?.disconnect()
      connRef.current = null
    }
  }, [])

  // Read fresh every render (packQueueVersion just forces the re-render) rather than mirrored
  // into its own state — see packQueueRef's doc for why the ref is the source of truth.
  void packQueueVersion
  const currentPack = packQueueRef.current[0] ?? null

  return {
    role,
    status,
    statusDetail,
    roomCode,
    seat,
    roster,
    phase,
    config,
    currentPack,
    myPool,
    picksBySeat,
    pickError,
    host,
    join,
    leave,
    startDraft,
    pickCard,
  }
}
