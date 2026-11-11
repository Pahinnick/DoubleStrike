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
 *
 * Disconnects mid-draft: the host's engine tracks packs by SEAT, not by connection, so a pack
 * passed to a player who has dropped simply waits with them — nothing is ever picked for a player
 * automatically. Only if the host explicitly chooses to (autoPickNow, for someone who isn't coming
 * back) does the host start picking for that seat (see autoPick.ts). When the player comes back — a network blip, a refreshed tab, an app restart
 * (see draftRejoin.ts) — the host sends a DRAFT_RESUME with every pack they now hold and their
 * whole pool, auto-picks included, and they carry on.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DraftConfigPayload, DraftMatchStatus } from '../net/draftProtocol'
import { isVirtualPlayerId, PeerConnection, type ConnectionStatus } from '../net/peerConnection'
import { DRAFT_MAX_PLAYERS, DRAFT_SEAT_ORDER, type Seat } from '../net/protocol'
import { chooseAutoPick, type AutoPickInfo } from './autoPick'
import {
  applyPick,
  initDraftEngine,
  isDraftComplete,
  isRoundComplete,
  packsForRound,
  packsHeldBy,
  type ApplyPickResult,
  type DraftEngineState,
} from './draftEngine'
import { clearDraftRejoin, loadDraftRejoin, saveDraftRejoin, type SavedDraftRejoin } from './draftRejoin'
import type { DraftConfig, DraftPackState } from './types'

/** One player is enough: a lone drafter gets a solo draft (see draftEngine's soloReserve). */
export const DRAFT_MIN_PLAYERS = 1

/** Pause before each auto-pick, so a run of them reads as picks being made rather than a pack
 *  teleporting straight through a seat. */
const AUTO_PICK_DELAY_MS = 700

export type DraftPhase = 'lobby' | 'drafting' | 'complete'

export type CurrentPack = { packId: string; round: number; cards: string[] }

export type DraftSession = {
  role: 'host' | 'guest' | null
  status: ConnectionStatus
  statusDetail: string | null
  roomCode: string | null
  seat: Seat | null
  /** Who's seated where. During a draft this keeps everyone who started it, even while away. */
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
  /** Drafting seats that have lost their connection. */
  awaySeats: Seat[]
  /** Away seats the host is now picking for. */
  autoPickingSeats: Seat[]
  /** Set briefly when our own pick gets rejected (e.g. a stale double-click) — the picker UI
   *  should clear its optimistic state and wait for the next real DRAFT_PACK. */
  pickError: string | null
  /** A draft this device was in as a guest and can walk back into (see draftRejoin.ts). */
  savedRejoin: SavedDraftRejoin | null
  host: () => Promise<void>
  join: (roomCode: string) => Promise<void>
  /** Rejoin `savedRejoin` — same player id, so the host gives back the seat, packs and pool. */
  rejoinSaved: () => Promise<void>
  /** Drop `savedRejoin` without rejoining. */
  forgetSaved: () => void
  /** Guest, after losing the host mid-draft: try the same room again with the same identity. */
  retryConnection: () => Promise<void>
  /** Guest, after losing the host for good: stop drafting and build a deck from what we have. */
  finishWithCurrentPool: () => void
  leave: () => void
  /** Lobby only: move to an open seat (draft rooms are three 1v1 tables of two). */
  chooseSeat: (seat: Seat) => void
  /** Host only: currently seated seats — what pack building needs to know who to deal to. */
  seatedSeats: () => Seat[]
  /** Host only: begin the draft with packs already built for `seatedSeats()` (cube or set — see
   *  packBuilder.ts / boosters.ts) — deals round 0 to every seated player. Needs 1-6 players.
   *  `autoPickInfo` (rarity/colors per card) is what auto-pick ranks cards by for absent players;
   *  `soloReserve` is required for a one-player draft (see packBuilder's buildSoloReserve). */
  startDraft: (rounds: DraftPackState[][], config: DraftConfig, options?: { autoPickInfo?: AutoPickInfo; soloReserve?: DraftPackState[][] }) => boolean
  /** Pick a card from our current pack. No-op if we don't currently hold a pack. */
  pickCard: (scryfallId: string) => void
  /** Host only, never automatic: pick for an away seat whose player isn't coming back, so the
   *  rest of the table can finish. Stops the moment that player reconnects. */
  autoPickNow: (seat: Seat) => void
  /** Host only, dev testing: seats filled by bots — the host's app picks for them (autoPick.ts). */
  botSeats: Seat[]
  /** After the draft: what each drafter is doing (building their deck, waiting at the table, playing). */
  matchStatuses: Partial<Record<Seat, DraftMatchStatus>>
  /** After the draft: tell everyone what we're doing now (see the Matches panel). */
  reportMatchStatus: (status: DraftMatchStatus) => void
  /** Host only, dev testing: fill an open lobby seat with a bot. */
  addBot: (seat: Seat) => void
  removeBot: (seat: Seat) => void
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
  // A rejoin reuses the player id the host already knows this seat by, overriding the fresh id
  // the view generated — read when the connection is created (see ensureConnection).
  const playerIdOverrideRef = useRef<string | null>(null)
  const localIdRef = useRef(localPlayerId)
  localIdRef.current = playerIdOverrideRef.current ?? localPlayerId
  const localNameRef = useRef(localName)
  localNameRef.current = localName
  const phaseRef = useRef<DraftPhase>('lobby')
  const joinedCodeRef = useRef<string | null>(null)

  // Host-only bookkeeping for the draft in progress. Seat -> player id and names are frozen at
  // the start, so packs keep their owner even while that owner's connection is gone.
  const draftSeatIdsRef = useRef<Partial<Record<Seat, string>>>({})
  const draftRosterRef = useRef<Partial<Record<Seat, string>>>({})
  const autoPickInfoRef = useRef<AutoPickInfo>({})
  const awaySeatsRef = useRef<Set<Seat>>(new Set())
  const autoSeatsRef = useRef<Set<Seat>>(new Set())
  const autoPickTimersRef = useRef<Map<Seat, number>>(new Map())

  const [role, setRole] = useState<'host' | 'guest' | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [statusDetail, setStatusDetail] = useState<string | null>(null)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [seat, setSeat] = useState<Seat | null>(null)
  const [roster, setRoster] = useState<Partial<Record<Seat, string>>>({})
  const [phase, setPhaseState] = useState<DraftPhase>('lobby')
  const [config, setConfig] = useState<DraftConfigPayload | null>(null)
  const [myPool, setMyPool] = useState<string[]>([])
  const [picksBySeat, setPicksBySeat] = useState<Partial<Record<Seat, number>>>({})
  const [awaySeats, setAwaySeats] = useState<Seat[]>([])
  const [autoPickingSeats, setAutoPickingSeats] = useState<Seat[]>([])
  const [pickError, setPickError] = useState<string | null>(null)
  const [botSeats, setBotSeats] = useState<Seat[]>([])
  const [matchStatuses, setMatchStatuses] = useState<Partial<Record<Seat, DraftMatchStatus>>>({})
  // Host only: the authoritative copy of everyone's match status (see draftMatchStatusReceived).
  const matchStatusesRef = useRef<Partial<Record<Seat, DraftMatchStatus>>>({})
  const [savedRejoin, setSavedRejoin] = useState<SavedDraftRejoin | null>(() => loadDraftRejoin())

  const setPhase = (next: DraftPhase) => {
    phaseRef.current = next
    setPhaseState(next)
  }

  const forgetRejoin = () => {
    clearDraftRejoin()
    setSavedRejoin(null)
  }

  // --- host: away seats and auto-pick -------------------------------------------------------

  function clearHostTimers() {
    for (const timer of autoPickTimersRef.current.values()) window.clearTimeout(timer)
    autoPickTimersRef.current.clear()
  }

  function broadcastPresence(conn: PeerConnection) {
    const sorted = (seats: Set<Seat>) => [...seats].sort((a, b) => a - b)
    conn.broadcastDraftPresence(sorted(awaySeatsRef.current), sorted(autoSeatsRef.current))
  }

  function seatOfPlayer(playerId: string): Seat | null {
    const entry = Object.entries(draftSeatIdsRef.current).find(([, id]) => id === playerId)
    return entry ? (Number(entry[0]) as Seat) : null
  }

  /** Hand a pack to whoever holds it now: over the wire to a connected player, into the auto-pick
   *  queue for a seat the host is picking for, or nowhere yet for a seat that's away — it waits in
   *  the engine (holderSeat) and goes out with their DRAFT_RESUME if they come back. */
  function deliverPack(conn: PeerConnection, pack: DraftPackState) {
    const holder = pack.holderSeat
    if (autoSeatsRef.current.has(holder)) {
      scheduleAutoPick(holder)
      return
    }
    if (awaySeatsRef.current.has(holder)) return
    const playerId = draftSeatIdsRef.current[holder]
    if (playerId) conn.sendDraftPack(playerId, pack.packId, pack.round, pack.cards)
  }

  /** The host's one place to apply a pick — a player's own, or one made for them — and send out
   *  whatever follows from it (the passed pack, the next round's packs, the end of the draft). */
  function resolvePick(conn: PeerConnection, pickerSeat: Seat, packId: string, cardKey: string): ApplyPickResult {
    const state = engineRef.current
    if (!state) return { ok: false, reason: 'No draft is in progress.' }
    const result = applyPick(state, packId, cardKey, pickerSeat)
    if (!result.ok) return result
    engineRef.current = result.nextState
    conn.broadcastDraftProgress(result.nextState.picksBySeat)

    if (result.passedTo) {
      deliverPack(conn, result.passedTo.pack)
    } else if (isRoundComplete(result.nextState, result.round)) {
      if (isDraftComplete(result.nextState)) {
        clearHostTimers()
        conn.broadcastDraftComplete()
        return result
      }
      conn.broadcastDraftRoundComplete(result.round)
      for (const pack of packsForRound(result.nextState, result.round + 1)) deliverPack(conn, pack)
    }
    // An auto-picked seat may be holding more packs that queued up behind this one.
    if (autoSeatsRef.current.has(pickerSeat)) scheduleAutoPick(pickerSeat)
    return result
  }

  function scheduleAutoPick(target: Seat) {
    if (autoPickTimersRef.current.has(target)) return
    const timer = window.setTimeout(() => {
      autoPickTimersRef.current.delete(target)
      runAutoPick(target)
    }, AUTO_PICK_DELAY_MS)
    autoPickTimersRef.current.set(target, timer)
  }

  function runAutoPick(target: Seat) {
    const conn = connRef.current
    const state = engineRef.current
    if (!conn || !state || !autoSeatsRef.current.has(target)) return
    const pack = packsHeldBy(state, target)[0]
    if (!pack) return
    const cardKey = chooseAutoPick(pack.cards, state.poolsBySeat[target] ?? [], autoPickInfoRef.current)
    if (cardKey) resolvePick(conn, target, pack.packId, cardKey)
  }

  function startAutoPicking(target: Seat) {
    const conn = connRef.current
    if (!conn || !engineRef.current || !awaySeatsRef.current.has(target) || autoSeatsRef.current.has(target)) return
    autoSeatsRef.current.add(target)
    broadcastPresence(conn)
    scheduleAutoPick(target)
  }

  function markAway(conn: PeerConnection, playerId: string) {
    // After the draft too: the post-draft Matches panel shows who has gone.
    if (!engineRef.current) return
    const away = seatOfPlayer(playerId)
    if (away === null || awaySeatsRef.current.has(away)) return
    awaySeatsRef.current.add(away)
    // Their packs just wait (see deliverPack) — no timer, no automatic picks.
    broadcastPresence(conn)
  }

  function welcomeBack(conn: PeerConnection, playerId: string) {
    const state = engineRef.current
    if (!state) return
    const back = seatOfPlayer(playerId)
    if (back === null) return
    const pickTimer = autoPickTimersRef.current.get(back)
    if (pickTimer !== undefined) window.clearTimeout(pickTimer)
    autoPickTimersRef.current.delete(back)
    awaySeatsRef.current.delete(back)
    autoSeatsRef.current.delete(back)

    conn.sendDraftResume(playerId, {
      config: state.config,
      phase: isDraftComplete(state) ? 'complete' : 'drafting',
      pool: state.poolsBySeat[back] ?? [],
      packs: packsHeldBy(state, back).map(({ packId, round, cards }) => ({ packId, round, cards })),
      picksBySeat: state.picksBySeat,
      roster: draftRosterRef.current,
    })
    broadcastPresence(conn)
    if (isDraftComplete(state)) conn.broadcastDraftMatches(matchStatusesRef.current)
  }

  // --- connection ---------------------------------------------------------------------------

  const ensureConnection = useCallback(() => {
    if (connRef.current) return connRef.current
    const conn = new PeerConnection(
      { playerId: localIdRef.current, name: localNameRef.current, deckFormat: '' },
      { maxPlayers: DRAFT_MAX_PLAYERS, seatOrder: DRAFT_SEAT_ORDER },
    )
    conn.on('status', (s, detail) => {
      if (connRef.current !== conn) return // a replaced connection's teardown, not ours
      setStatus(s)
      setStatusDetail(detail ?? null)
    })
    conn.on('code', (code) => setRoomCode(code))
    conn.on('seat', (s) => setSeat(s))
    conn.on('draftRoster', (r) => {
      // Once drafting, a seat that drops out of the live roster still belongs to that player
      // (they're away, not gone) — so merge rather than replace, keeping their name listed.
      setRoster((prev) => (phaseRef.current === 'lobby' ? r : { ...prev, ...r }))
    })
    conn.on('draftConfig', (c) => setConfig(c))
    conn.on('draftStart', () => {
      setPhase('drafting')
      if (joinedCodeRef.current) {
        const rejoin = { roomCode: joinedCodeRef.current, playerId: conn.playerId, name: localNameRef.current }
        saveDraftRejoin(rejoin)
        // Not surfaced as `savedRejoin` while we're in this very draft — that's for next time.
      }
    })
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
    conn.on('draftPresence', ({ away, autoPicking }) => {
      setAwaySeats(away)
      setAutoPickingSeats(autoPicking)
    })
    conn.on('draftMatches', (statuses) => setMatchStatuses(statuses))
    // Host only: keep everyone's post-draft match status and share each change with the room.
    conn.on('draftMatchStatusReceived', ({ seat: reporter, status }) => {
      matchStatusesRef.current = { ...matchStatusesRef.current, [reporter]: status }
      conn.broadcastDraftMatches(matchStatusesRef.current)
    })
    conn.on('draftComplete', () => {
      setPhase('complete')
      packQueueRef.current = []
      bumpPackQueue()
      // Away/host-picked seats are kept: the deckbuilder uses them to tell a bot opponent from a
      // real one (see DraftView opponentIsBot).
      // The deck gets saved as the builder opens, so there's nothing left to rejoin for.
      clearDraftRejoin()
    })
    conn.on('draftResume', (resume) => {
      // The host's word replaces ours wholesale: while we were gone, sends in either direction
      // may have been lost, and picks may have been made for us.
      pendingPicksRef.current.clear()
      packQueueRef.current = resume.packs
      bumpPackQueue()
      setConfig(resume.config)
      setRoster(resume.roster)
      setPicksBySeat(resume.picksBySeat)
      setMyPool(resume.pool)
      setPickError(null)
      setPhase(resume.phase)
      if (resume.phase === 'complete') clearDraftRejoin()
      else if (joinedCodeRef.current) saveDraftRejoin({ roomCode: joinedCodeRef.current, playerId: conn.playerId, name: localNameRef.current })
      setSavedRejoin(null)
    })

    // Host only: resolve every incoming pick request (including our own, self-routed by
    // sendDraftPick) against the authoritative engine state, then send whatever it decides.
    conn.on('draftPickReceived', ({ fromPlayerId, packId, scryfallId }) => {
      const pickerSeat = seatOfPlayer(fromPlayerId)
      if (pickerSeat === null) return
      const result = resolvePick(conn, pickerSeat, packId, scryfallId)
      if (!result.ok) conn.sendDraftPickRejected(fromPlayerId, packId, result.reason)
    })
    // Host only in effect: a guest has no engine, so markAway/welcomeBack are no-ops there.
    conn.on('playerLeft', (playerId) => markAway(conn, playerId))
    conn.on('playerJoined', ({ playerId }) => welcomeBack(conn, playerId))

    connRef.current = conn
    return conn
    // The handlers above only touch refs and state setters, so the first render's copies stay
    // correct for the connection's whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetLocalState = useCallback(() => {
    setBotSeats([])
    setMatchStatuses({})
    matchStatusesRef.current = {}
    engineRef.current = null
    clearHostTimers()
    draftSeatIdsRef.current = {}
    draftRosterRef.current = {}
    autoPickInfoRef.current = {}
    awaySeatsRef.current.clear()
    autoSeatsRef.current.clear()
    pendingPicksRef.current.clear()
    packQueueRef.current = []
    bumpPackQueue()
    joinedCodeRef.current = null
    playerIdOverrideRef.current = null
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
    setAwaySeats([])
    setAutoPickingSeats([])
    setPickError(null)
  }, [])

  const host = useCallback(async () => {
    setRole('host')
    await ensureConnection().hostGame()
  }, [ensureConnection])

  const join = useCallback(
    async (code: string) => {
      setRole('guest')
      joinedCodeRef.current = code
      // Guests keep the code too: every post-draft match room is worked out from it (matchRoomCode).
      setRoomCode(code.trim().toUpperCase())
      await ensureConnection().joinGame(code)
    },
    [ensureConnection],
  )

  const rejoinSaved = useCallback(async () => {
    const saved = loadDraftRejoin()
    setSavedRejoin(saved)
    if (!saved || connRef.current) return
    playerIdOverrideRef.current = saved.playerId
    localIdRef.current = saved.playerId
    await join(saved.roomCode)
  }, [join])

  const forgetSaved = useCallback(() => forgetRejoin(), [])

  const retryConnection = useCallback(async () => {
    const old = connRef.current
    const code = joinedCodeRef.current
    if (!old || !code) return
    // Same identity, fresh connection: the host treats it as the same player coming back.
    playerIdOverrideRef.current = old.playerId
    localIdRef.current = old.playerId
    connRef.current = null
    old.disconnect()
    await join(code)
  }, [join])

  const finishWithCurrentPool = useCallback(() => {
    connRef.current?.disconnect()
    connRef.current = null
    forgetRejoin()
    pendingPicksRef.current.clear()
    packQueueRef.current = []
    bumpPackQueue()
    setAwaySeats([])
    setAutoPickingSeats([])
    setPhase('complete')
  }, [])

  const leave = useCallback(() => {
    connRef.current?.disconnect()
    connRef.current = null
    forgetRejoin()
    resetLocalState()
  }, [resetLocalState])

  const chooseSeat = useCallback((target: Seat) => {
    connRef.current?.requestSeat(target)
  }, [])

  const seatedSeats = useCallback((): Seat[] => {
    const conn = connRef.current
    if (!conn) return []
    return Object.keys(conn.getSeatPlayerIds())
      .map((s) => Number(s) as Seat)
      .sort((a, b) => a - b)
  }, [])

  const startDraft = useCallback(
    (rounds: DraftPackState[][], draftConfig: DraftConfig, options: { autoPickInfo?: AutoPickInfo; soloReserve?: DraftPackState[][] } = {}): boolean => {
      const { autoPickInfo = {}, soloReserve } = options
      const conn = connRef.current
      if (!conn) return false
      const seatPlayerIds = conn.getSeatPlayerIds()
      const occupiedSeats = Object.keys(seatPlayerIds)
        .map((s) => Number(s) as Seat)
        .sort((a, b) => a - b)
      // The lobby UI already gates "Start Draft" on this, but guard here too since this is the one
      // place that actually deals cards. Packs were built for a specific set of seats, so a player
      // joining or leaving in between means they no longer line up — refuse rather than deal wrong.
      if (occupiedSeats.length < DRAFT_MIN_PLAYERS || occupiedSeats.length > DRAFT_MAX_PLAYERS) return false
      const dealtSeats = new Set(rounds[0]?.map((pack) => pack.holderSeat) ?? [])
      if (dealtSeats.size !== occupiedSeats.length || occupiedSeats.some((s) => !dealtSeats.has(s))) return false
      // Alone, there's no one to pass to: without the reserve packs every pass would hand the same
      // pack straight back.
      if (occupiedSeats.length === 1 && !soloReserve) return false

      const state = initDraftEngine(rounds, draftConfig, occupiedSeats, soloReserve)
      engineRef.current = state
      draftSeatIdsRef.current = seatPlayerIds
      draftRosterRef.current = { ...roster }
      autoPickInfoRef.current = autoPickInfo
      awaySeatsRef.current.clear()
      autoSeatsRef.current.clear()
      // Dev-mode bots (see addBot): the host picks for their seats from the very first pack.
      for (const [seatKey, playerId] of Object.entries(seatPlayerIds)) {
        if (playerId && isVirtualPlayerId(playerId)) autoSeatsRef.current.add(Number(seatKey) as Seat)
      }
      clearHostTimers()
      conn.lockSeats()

      conn.broadcastDraftConfig(draftConfig)
      conn.broadcastDraftStart()
      broadcastPresence(conn)
      for (const pack of packsForRound(state, 0)) deliverPack(conn, pack)
      return true
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster],
  )

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

  const autoPickNow = useCallback((target: Seat) => {
    startAutoPicking(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reportMatchStatus = useCallback((status: DraftMatchStatus) => {
    connRef.current?.sendDraftMatchStatus(status)
  }, [])

  const addBot = useCallback((target: Seat) => {
    const conn = connRef.current
    if (!conn) return
    if (conn.addVirtualSeat(target, `Bot ${target + 1}`)) setBotSeats((prev) => [...prev, target].sort((a, b) => a - b))
  }, [])

  const removeBot = useCallback((target: Seat) => {
    connRef.current?.removeVirtualSeat(target)
    setBotSeats((prev) => prev.filter((s) => s !== target))
  }, [])

  useEffect(() => {
    const autoPickTimers = autoPickTimersRef.current
    return () => {
      for (const timer of autoPickTimers.values()) window.clearTimeout(timer)
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
    awaySeats,
    autoPickingSeats,
    pickError,
    savedRejoin,
    host,
    join,
    rejoinSaved,
    forgetSaved,
    retryConnection,
    finishWithCurrentPool,
    leave,
    chooseSeat,
    seatedSeats,
    startDraft,
    pickCard,
    autoPickNow,
    botSeats,
    matchStatuses,
    reportMatchStatus,
    addBot,
    removeBot,
  }
}
