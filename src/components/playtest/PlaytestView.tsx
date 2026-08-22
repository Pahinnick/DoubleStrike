import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent,
} from 'react'
import { getCardById } from '../../api/scryfall'
import { BATTLEFIELD_SKINS, normalizeBattlefieldSkin, useBattlefieldSkin, type BattlefieldSkin } from '../../hooks/useBattlefieldSkin'
import { useCardSnapshots } from '../../hooks/useCardSnapshots'
import { usePlaytestWindowMode } from '../../hooks/usePlaytestWindowMode'
import { useProfileSettings } from '../../hooks/useProfileSettings'
import { FACE_DOWN_SCRYFALL_ID, type PublicBoard, type RollResult, type Seat } from '../../net/protocol'
import { toPublicBoard } from '../../net/publicBoard'
import { useMultiplayer } from '../../net/useMultiplayer'
import { useDeck } from '../../state/DeckContext'
import { useProfiles } from '../../state/ProfileContext'
import {
  buildStartingCards,
  gameReducer,
  maxCommanderDamage,
  shuffle,
  startingLifeFor,
  zoneCards,
  SOLO_CMDR_SOURCE,
  type GameState,
  type GameZone,
} from '../../state/gameReducer'
import type { Deck, FoilKind } from '../../state/types'
import { isFlippableSnapshot } from '../../storage/cardCache'
import { getSoloGameSave, saveSoloGameSave } from '../../storage/soloGameStorage'
import { isPlaytestWindow, openDedicatedPlaytestWindow, requestSwitchToInlineAndClose } from '../../utils/playtestWindowBridge'
import { playCue, setSessionMuted } from '../../utils/sound'
import ActionsTray, { type TrayAction } from './ActionsTray'
import BattlefieldEmberAura from './BattlefieldEmberAura'
import BattlefieldLavaGround from './BattlefieldLavaGround'
import BattlefieldLeyLines from './BattlefieldLeyLines'
import BattlefieldNeonGlow from './BattlefieldNeonGlow'
import BattlefieldParticles, { type BattlefieldParticlesHandle } from './BattlefieldParticles'
import BattlefieldRunicCircle from './BattlefieldRunicCircle'
import BattlefieldTriangleGrid from './BattlefieldTriangleGrid'
import CardContextMenu, { type ContextMenuAction } from '../shared/CardContextMenu'
import ConfirmModal from '../shared/ConfirmModal'
import { useTutorialContext } from '../shared/TutorialContext'
import { COUNTER_COLORS, formatPtCounters, formatSigned } from './counterFormat'
import CounterPileStack from './CounterPileStack'
import DeckManagerModal from '../deck/DeckManagerModal'
import DeckScanTray from './DeckScanTray'
import TurnOrderTray from './TurnOrderTray'
import { getCounterDragData, isDraggingCounterPile } from './dragCounterPile'
import { getCurrentDragData, getGameDragData, type DraggedGameCard } from './dragGameCard'
import GoldfishPanel, { type GoldfishRow } from './GoldfishPanel'
import LibraryPeekModal, { type PeekEntry, type PeekPlacement } from './LibraryPeekModal'
import MultiplayerModal from './MultiplayerModal'
import NumberInputPrompt from './NumberInputPrompt'
import PingMarker from './PingMarker'
import PlaytestCard from './PlaytestCard'
import { ALL_SEATS, buildSpinSequence, nextActiveSeat, pickRandomSeat, SEAT_COLOR_NAMES, SEAT_COLORS, SEAT_GRID, seatOrigin, tableSize } from './podLayout'
import PtCounterPileStack from './PtCounterPileStack'
import ReactionMarker from './ReactionMarker'
import ReactionsTray from './ReactionsTray'
import RollLog, { type RollLogEntry } from './RollLog'
import SeatOverlay from './SeatOverlay'
import SettingsModal from '../settings/SettingsModal'
import ShortcutsModal from './ShortcutsModal'
import TableRadio from './TableRadio'
import TokenPickerModal from './TokenPickerModal'
import ZonePile from './ZonePile'
import ZoneViewerModal from './ZoneViewerModal'
import { drawsByTurn } from '../../engine/castability'
import { collectDeckTokens } from '../../engine/deckTokens'
import { UNCATEGORIZED_LABEL } from '../../engine/deckGrouping'
import './playtest.css'

// Distinct border/text colors for each commander's tax circle, in commander order — a partner
// deck's second commander gets a visibly different color from the first, cycling if there were
// ever more than two (e.g. a Background pairing, though 2 is the realistic max today).
const COMMANDER_TAX_COLORS = ['var(--color-w)', 'var(--color-u)', 'var(--color-r)', 'var(--color-g)']

const SCRY_SURVEIL_COUNTS = [1, 2, 3, 4, 5]
const DIE_SIZES = [4, 6, 8, 10, 12, 20, 100]
// Newest-first cap on the shared roll log so it doesn't grow unbounded over a long session.
const ROLL_LOG_LIMIT = 8
// How long a single roll stays visible before it self-clears.
const ROLL_ENTRY_TTL_MS = 7000
// How long a "look here" ping stays visible before it self-clears — brief, since it's
// meant as a momentary attention-grabber, not a log (contrast with ROLL_ENTRY_TTL_MS).
const PING_TTL_MS = 1700
// How long a card's flash-highlight stays applied — must comfortably cover the CSS pulse
// animation's total duration (see .playtest__battlefield-card.is-highlighted in playtest.css)
// so the class isn't removed mid-animation.
const HIGHLIGHT_TTL_MS = 1600
// How long a one-click emoji reaction stays visible near a nameplate before it self-clears.
const REACTION_TTL_MS = 2000
// How long the "whose turn" banner stays up after a pass — long enough to actually read a
// name, short enough to not still be sitting there several actions into the new turn.
const TURN_ANNOUNCE_TTL_MS = 2600
// Small fixed set of one-click pod reactions — pure fun, not meant to be exhaustive.
const REACTION_EMOJIS = ['👍', '😂', '😱', '😡', '🎉', '🤔']

// Must match the --game-card-width sizing in playtest.css: used to clamp drops
// so a card can't be placed hanging off the battlefield edge.
const CARD_W_PX = 90
const CARD_H_PX = 126

// The battlefield is a fixed-size virtual surface that the viewport pans/zooms
// over, rather than a viewport-sized area — see playtest backlog item #5 in
// HANDOFF.md. Card x/y are canvas-space pixels, not percentages. Sized so cards
// (~90px) aren't lost in dead space; a 2×2 pod tiles this into a 2688×1792 table.
// ~20% smaller than the original 1680×1120 per user feedback ("the playing space
// is a little too big").
const CANVAS_W = 1344
const CANVAS_H = 896
// Low enough that the whole 2688×1792 pod table fits the viewport ("see everyone
// at once"); harmless in solo, it just permits zooming further out.
const ZOOM_MIN = 0.12
const ZOOM_MAX = 2

// How much of the viewport a framed region fills (leaves a margin), and how long
// the center-on-seat / fit-all camera glide takes.
const FRAME_PADDING = 0.9
const CAMERA_ANIM_MS = 260

// Coalesce bursts of discrete actions (mashing a life bubble, a flurry of moves)
// into a single trailing broadcast so the pod isn't spammed. The reducer only
// updates on discrete actions — panning/zoom touch camera state, not game
// state — so this fires roughly once per settled game change.
const BROADCAST_DEBOUNCE_MS = 150

// Same coalescing idea as the network broadcast above, but a longer window — an IndexedDB write
// doesn't need to keep up with live opponents, just needs to settle before the tab actually closes.
const SOLO_AUTOSAVE_DEBOUNCE_MS = 800

type Camera = { x: number; y: number; zoom: number }

type Props = {
  onClose: () => void
}

function initGame(deck: Deck): GameState {
  return gameReducer({} as GameState, {
    type: 'START_GAME',
    cards: buildStartingCards(deck),
    startingLife: startingLifeFor(deck),
  })
}

function PlaytestView({ onClose }: Props) {
  const { deck, dispatch: deckDispatch } = useDeck()
  const tutorial = useTutorialContext()
  const { profiles, activeProfileId } = useProfiles()
  const playerName = profiles.find((p) => p.id === activeProfileId)?.name ?? 'Player'
  const [state, rawDispatch] = useReducer(gameReducer, deck, initGame)

  // Multi-level undo/redo (Ctrl+Z / Ctrl+Y — walk back through misclicks, wrong drop targets,
  // accidental taps, wrong counter adjustments, etc., and back forward again), no visible
  // button (tried one, user didn't like it as a UI element even though they want the feature
  // itself). `dispatch` (used everywhere else in this component) pushes a snapshot of the state
  // as it was just before onto `undoStackRef` ahead of every real action, and clears
  // `redoStackRef` — same as any editor's undo/redo, a fresh action invalidates whatever redo
  // history existed. `handleUndo`/`handleRedo` move a snapshot across the two stacks and replace
  // the live state wholesale via RESTORE_STATE, dispatched straight through `rawDispatch` so
  // undoing/redoing itself never gets pushed onto either stack.
  //
  // `stateRef` mirrors `state` synchronously each render so `dispatch` always reads the latest
  // value regardless of which stale closure calls it, without needing `state` in its own deps
  // (which would otherwise recreate `dispatch` — and everything that closes over it — every
  // action). Capped so a long session can't grow it unboundedly.
  //
  // A burst of several dispatches from one user gesture (e.g. deleting a multi-selection, see
  // the Delete/Backspace handler below) all read the same `stateRef.current` — React doesn't
  // re-render between them — so the "skip if the top of the stack is already this exact state"
  // check below collapses the whole burst into a single undo step instead of one per card.
  const UNDO_HISTORY_LIMIT = 50
  const stateRef = useRef(state)
  stateRef.current = state
  const undoStackRef = useRef<GameState[]>([])
  const redoStackRef = useRef<GameState[]>([])
  const dispatch = useCallback((action: Parameters<typeof rawDispatch>[0]) => {
    const current = stateRef.current
    if (undoStackRef.current[undoStackRef.current.length - 1] !== current) {
      undoStackRef.current.push(current)
      if (undoStackRef.current.length > UNDO_HISTORY_LIMIT) undoStackRef.current.shift()
    }
    redoStackRef.current = []
    rawDispatch(action)
  }, [])
  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop()
    if (!prev) return
    redoStackRef.current.push(stateRef.current)
    rawDispatch({ type: 'RESTORE_STATE', state: prev })
  }, [])
  const handleRedo = useCallback(() => {
    const next = redoStackRef.current.pop()
    if (!next) return
    undoStackRef.current.push(stateRef.current)
    rawDispatch({ type: 'RESTORE_STATE', state: next })
  }, [])

  // Network identity is a fresh per-session id, NOT the profile id: two tabs on
  // the same origin share IndexedDB (same profile), so reusing the profile id
  // would collide when testing locally and in the boards map. The profile only
  // supplies the display name.
  const playerIdRef = useRef<string>(crypto.randomUUID())
  const playerId = playerIdRef.current

  // Recent dice/coin rolls, newest first — resolved to a display seat at render
  // time (see rollLogEntries below) since a network roll only carries a playerId.
  // Each entry expires on its own after ROLL_ENTRY_TTL_MS (tracked here so unmount
  // can clear any still-pending timeouts rather than letting them fire into a
  // stale closure).
  const [rolls, setRolls] = useState<{ id: string; playerId: string; name: string; roll: RollResult }[]>([])
  const rollTimeoutsRef = useRef<Map<string, number>>(new Map())
  const addRollEntry = useCallback((rollerId: string, name: string, roll: RollResult) => {
    const id = crypto.randomUUID()
    setRolls((prev) => [{ id, playerId: rollerId, name, roll }, ...prev].slice(0, ROLL_LOG_LIMIT))
    const timeout = window.setTimeout(() => {
      setRolls((prev) => prev.filter((entry) => entry.id !== id))
      rollTimeoutsRef.current.delete(id)
    }, ROLL_ENTRY_TTL_MS)
    rollTimeoutsRef.current.set(id, timeout)
  }, [])
  useEffect(() => {
    const timeouts = rollTimeoutsRef.current
    return () => {
      for (const timeout of timeouts.values()) window.clearTimeout(timeout)
    }
  }, [])

  // "Look here" pings — same self-expiring-entry shape as rolls, but table-absolute
  // x/y (not seat-relative) since a ping can point anywhere on the shared table,
  // not just the sender's own quadrant, and a much shorter TTL (a flash, not a log).
  const [pings, setPings] = useState<{ id: string; playerId: string; name: string; x: number; y: number }[]>([])
  const pingTimeoutsRef = useRef<Map<string, number>>(new Map())
  const addPing = useCallback((pingerId: string, name: string, x: number, y: number) => {
    const id = crypto.randomUUID()
    setPings((prev) => [...prev, { id, playerId: pingerId, name, x, y }])
    const timeout = window.setTimeout(() => {
      setPings((prev) => prev.filter((entry) => entry.id !== id))
      pingTimeoutsRef.current.delete(id)
    }, PING_TTL_MS)
    pingTimeoutsRef.current.set(id, timeout)
  }, [])
  useEffect(() => {
    const timeouts = pingTimeoutsRef.current
    return () => {
      for (const timeout of timeouts.values()) window.clearTimeout(timeout)
    }
  }, [])

  // Flash-highlight a specific card — sibling to the ping state above, same self-expiring-set
  // shape, but keyed by instanceId instead of a table point (see HIGHLIGHT_TTL_MS/CSS animation).
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set())
  const highlightTimeoutsRef = useRef<Map<string, number>>(new Map())
  const addHighlight = useCallback((instanceId: string) => {
    setHighlightedIds((prev) => new Set(prev).add(instanceId))
    const existing = highlightTimeoutsRef.current.get(instanceId)
    if (existing) window.clearTimeout(existing)
    const timeout = window.setTimeout(() => {
      setHighlightedIds((prev) => {
        if (!prev.has(instanceId)) return prev
        const next = new Set(prev)
        next.delete(instanceId)
        return next
      })
      highlightTimeoutsRef.current.delete(instanceId)
    }, HIGHLIGHT_TTL_MS)
    highlightTimeoutsRef.current.set(instanceId, timeout)
  }, [])
  useEffect(() => {
    const timeouts = highlightTimeoutsRef.current
    return () => {
      for (const timeout of timeouts.values()) window.clearTimeout(timeout)
    }
  }, [])

  // One-click emoji reactions — same self-expiring-entry shape as pings/rolls, but rendered
  // near the sender's nameplate (see reactionsBySeat below) rather than a table point, since
  // this app has no cursor-position tracking to broadcast.
  const [reactions, setReactions] = useState<{ id: string; playerId: string; emoji: string }[]>([])
  const reactionTimeoutsRef = useRef<Map<string, number>>(new Map())
  const addReaction = useCallback((reactorId: string, emoji: string) => {
    const id = crypto.randomUUID()
    setReactions((prev) => [...prev, { id, playerId: reactorId, emoji }])
    const timeout = window.setTimeout(() => {
      setReactions((prev) => prev.filter((entry) => entry.id !== id))
      reactionTimeoutsRef.current.delete(id)
    }, REACTION_TTL_MS)
    reactionTimeoutsRef.current.set(id, timeout)
  }, [])
  useEffect(() => {
    const timeouts = reactionTimeoutsRef.current
    return () => {
      for (const timeout of timeouts.values()) window.clearTimeout(timeout)
    }
  }, [])

  // Multiplayer session. `boards` is the map of opponents' public boards driving
  // the shared-table mirror.
  const {
    seat: mySeat,
    isActive: mpActive,
    boards,
    activeSeat: mpActiveSeat,
    radioStation: mpRadioStation,
    broadcast,
    broadcastRoll,
    broadcastPing,
    broadcastHighlight,
    broadcastReaction,
    broadcastTurnPass,
    broadcastRadio,
    status: mpStatus,
    statusDetail: mpStatusDetail,
    roomCode: mpRoomCode,
    role: mpRole,
    host: mpHost,
    join: mpJoin,
    leave: mpLeave,
    giveCard,
    relocateCard,
    tapRemoteCard,
    flipRemoteCard,
    deleteRemoteCard,
  } = useMultiplayer(
    {
      playerId,
      name: playerName,
      deckFormat: deck.format ?? 'casual',
    },
    // A card handed to us by another player joins our battlefield under our control.
    (card) => dispatch({ type: 'RECEIVE_GIVEN_CARD', card }),
    // Another player's die/coin result, relayed to us — just log it, nothing to broadcast back.
    (rollerId, name, roll) => addRollEntry(rollerId, name, roll),
    // Another player's ping, relayed to us — just show it, nothing to broadcast back.
    (pingerId, name, x, y) => addPing(pingerId, name, x, y),
    // Another player repositioned one of our own cards — reposition it locally.
    (card) => dispatch({ type: 'RECEIVE_RELOCATED_CARD', instanceId: card.instanceId, x: card.x, y: card.y, atSeat: card.atSeat }),
    // Another player tapped/untapped one of our own cards sitting on their board (a card they
    // took via relocate) — apply it locally; our next STATE broadcast shows everyone.
    (req) => dispatch({ type: 'SET_TAPPED', instanceId: req.instanceId, tapped: req.tapped }),
    // Another player flipped one of our own cards sitting on their board (a card they took via
    // relocate) — apply it locally; our next STATE broadcast shows everyone.
    (req) => dispatch({ type: 'FLIP_CARD', instanceId: req.instanceId }),
    // Another player sent one of our own cards sitting on their board (a card they took via
    // relocate) to the graveyard — apply it locally; our next STATE broadcast shows everyone.
    (req) => dispatch({ type: 'MOVE_CARD', instanceId: req.instanceId, toZone: 'graveyard' }),
    // Another player's card flash-highlight, relayed to us — just show it, nothing to broadcast back.
    (instanceId) => addHighlight(instanceId),
    // Another player's emoji reaction, relayed to us — just show it, nothing to broadcast back.
    (reactorId, _name, emoji) => addReaction(reactorId, emoji),
  )
  const [mpModalOpen, setMpModalOpen] = useState(false)
  // The persisted per-profile volume (Settings page) applies globally via useProfileSettings'
  // own effect — this is just a session-local quick-mute on top of it (the topbar 🔊 button)
  // that deliberately does NOT persist: muting for one distracting game shouldn't silently
  // change the permanent volume preference. Cleanup un-mutes on exit so leaving Playtest can't
  // leave sound.ts stuck muted for the search/deck-list screens.
  const { goldfishStatsDefault } = useProfileSettings()
  const [muted, setMuted] = useState(false)
  useEffect(() => {
    setSessionMuted(muted)
    return () => setSessionMuted(false)
  }, [muted])
  const [battlefieldSkin, setBattlefieldSkin] = useBattlefieldSkin()
  const [playtestWindowMode, setPlaytestWindowMode] = usePlaytestWindowMode()
  // Opt-in goldfish practice stat (lands drawn vs. expected) — solo-only, purely a local display
  // preference like battlefieldSkin above, never part of GameState/the wire (nothing here is
  // shared info, and it wouldn't mean anything on an opponent's board anyway). Seeded from the
  // Settings page's default so it doesn't have to be re-toggled on every fresh Playtest session.
  const [goldfishOn, setGoldfishOn] = useState(goldfishStatsDefault)
  // The shared table radio's current station (or null, off) — see TableRadio.tsx. Local state
  // rather than something read straight off the wire, so it also works solo/in the dev mock
  // preview (which have no `mpRadioStation` at all); the effect below keeps it in sync with
  // whatever a real pod's host/other players broadcast, same "local state, wire-synced when
  // connected" shape as reactions/pings above.
  const [radioStation, setRadioStation] = useState<string | null>(null)

  // If we drop out of a session we were actually connected to (host disappeared, network
  // hiccup, etc.), pop the modal open so the "why did my opponents vanish" explanation is
  // never missed just because the modal wasn't open at the moment it happened.
  const wasConnectedRef = useRef(false)
  useEffect(() => {
    if (mpStatus === 'connected') wasConnectedRef.current = true
    if ((mpStatus === 'closed' || mpStatus === 'error') && wasConnectedRef.current) {
      setMpModalOpen(true)
      wasConnectedRef.current = false
    }
  }, [mpStatus])

  // Broadcast our public board on every settled game change while connected.
  // Hidden info stays local: toPublicBoard emits only battlefield + life/poison/
  // commander-damage + a hand count, never hand or library card identities.
  useEffect(() => {
    if (!mpActive || mySeat === null) return
    const handle = window.setTimeout(() => {
      broadcast(toPublicBoard(state, { playerId, name: playerName, seat: mySeat, battlefieldSkin }))
    }, BROADCAST_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [state, mySeat, mpActive, broadcast, playerId, playerName, battlefieldSkin])

  // DEV-only "preview pod" seam: inject mock opponents so the shared-table layout
  // and camera can be exercised without a live connection (real P2P joining is
  // step 5). Off in production builds.
  const [mockBoards, setMockBoards] = useState<PublicBoard[] | null>(null)
  // DEV only: which seat "I" occupy in the mock preview — see swapMockSeat. Only meaningful
  // while mockBoards is non-null; a real connection's mySeat (from useMultiplayer) always
  // takes priority once one exists.
  const [mockMySeat, setMockMySeat] = useState<Seat>(0)
  // Same dev-only duality as mockBoards: Pass Turn needs to be exercisable in the
  // mock-pod preview too, but broadcastTurnPass is a real-connection no-op there.
  const [mockActiveSeat, setMockActiveSeat] = useState<Seat | null>(null)
  // Local-only override while the "Who Goes First" spin animation is running — takes
  // priority over the authoritative activeSeat (network or mock) so the intermediate
  // flashes are purely cosmetic and never themselves get broadcast; only the final
  // landing seat does, once the animation completes.
  const [spinSeat, setSpinSeat] = useState<Seat | null>(null)
  const spinTimers = useRef<number[]>([])

  useEffect(() => {
    const timers = spinTimers.current
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  const inPod = mpActive || mockBoards !== null

  // Adopt whatever station a real pod's host/other players have broadcast — covers both
  // someone else changing it and, via the host's cached replay on HELLO, a late joiner
  // hearing whatever's already playing instead of silence.
  useEffect(() => {
    if (mpActive) setRadioStation(mpRadioStation)
  }, [mpActive, mpRadioStation])

  /** Change the table radio's station and share it with the pod (if connected) — same
   *  local-then-broadcast shape as sendReaction/sendHighlight. */
  function handleChangeRadioStation(next: string | null) {
    setRadioStation(next)
    if (mpActive) broadcastRadio(next)
  }

  // Autosave solo progress only — a pod session deliberately isn't resumable (same
  // reconnect/host-migration problem already cut from this project's scope, see
  // multiplayer-vtt-spike memory), so this effect goes silent the moment inPod flips true and
  // simply leaves the last-saved-while-solo snapshot alone until the pod is left again. Mirrors
  // the broadcast effect's debounce-on-every-settled-change shape above.
  useEffect(() => {
    if (inPod) return
    const handle = window.setTimeout(() => {
      saveSoloGameSave(deck.id, { state, deckUpdatedAt: deck.updatedAt })
    }, SOLO_AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [state, inPod, deck.id, deck.updatedAt])

  /** The window-mode toggle's click handler — seamlessly hands the live game off to the other
   *  window instead of just flipping the preference for next time. Flushes the current board
   *  to the solo autosave *now* (bypassing the debounce above) so whichever window opens next
   *  resumes exactly here, via the same resume path a plain app relaunch already uses (see the
   *  deck-switch effect above). Gated on !inPod: a pod connection can't be carried across
   *  windows (same reconnect/host-migration limitation as the autosave itself, just above), so
   *  the toggle button is disabled with an explanatory title while connected — see its JSX.
   */
  async function handleToggleWindowMode() {
    const next = playtestWindowMode === 'window' ? 'inline' : 'window'
    setPlaytestWindowMode(next)
    if (inPod) return
    await saveSoloGameSave(deck.id, { state, deckUpdatedAt: deck.updatedAt })
    if (isPlaytestWindow) {
      // We're the dedicated window switching to inline — hand off to the main window and close.
      requestSwitchToInlineAndClose()
    } else {
      // We're inline in the main window switching to a dedicated window — pop it out, then
      // hide this inline view (mirrors "Exit Playtest", just not user-initiated).
      openDedicatedPlaytestWindow()
      onClose()
    }
  }

  const mySeatResolved: Seat = mySeat ?? (mockBoards !== null ? mockMySeat : 0)
  const myOrigin = inPod ? seatOrigin(mySeatResolved, CANVAS_W, CANVAS_H) : { x: 0, y: 0 }
  const surface = inPod ? tableSize(CANVAS_W, CANVAS_H) : { width: CANVAS_W, height: CANVAS_H }
  // A locally-seated top-row player's (seat 2/3) own view flips 180° so their own quadrant
  // renders near the bottom of their screen — where a hand overlay and bottom-row seats
  // already sit — instead of feeling like they're facing away from the table. This is purely
  // a per-client rendering/input transform: every other player still sees the same unrotated
  // canonical table, and every stored/broadcast position (card x/y, pings) always stays
  // canonical — only `mirror` calls at render/input boundaries know about the flip.
  const viewRotated = inPod && SEAT_GRID[mySeatResolved].row === 0
  /** Canonical table-space <-> this client's own (possibly flipped) display space, for a box
   *  of the given size (0 for a bare point). A 180° point reflection about the table's center
   *  when `viewRotated` — self-inverse, so the same call converts canonical->display for
   *  rendering and display->canonical for input (see surfacePointAt). */
  function mirror(x: number, y: number, w = 0, h = 0): { x: number; y: number } {
    if (!viewRotated) return { x, y }
    return { x: surface.width - x - w, y: surface.height - y - h }
  }
  const opponentBoards: PublicBoard[] = useMemo(() => mockBoards ?? [...boards.values()], [mockBoards, boards])
  // Eliminated: 0 life or below (real Commander rules), OR a voluntary Scoop — either one is the
  // same "out" state everywhere it's checked (turn rotation, quadrant scrim, nameplate badge), per
  // [[mtg-deckbuilder-vtt-auto-skip-eliminated]] and [[mtg-deckbuilder-vtt-scoop]].
  const lifeBySeat = new Map<Seat, number>([[mySeatResolved, state.life], ...opponentBoards.map((b) => [b.seat, b.life] as const)])
  const scoopedBySeat = new Map<Seat, boolean>([
    [mySeatResolved, state.scooped],
    ...opponentBoards.map((b) => [b.seat, !!b.scooped] as const),
  ])
  const isEliminated = (seat: Seat) => (lifeBySeat.get(seat) ?? 0) <= 0 || scoopedBySeat.get(seat) === true
  // Every seat's name, keyed by seat — needed to label an opponent's incoming commander-damage
  // pills (see the SeatOverlay calls below): a source dealing damage to opponent B could be us
  // or any other opponent C, not just whoever's card we're currently rendering.
  const seatNameBySeat = new Map<Seat, string>([[mySeatResolved, playerName], ...opponentBoards.map((b) => [b.seat, b.name] as const)])
  const activeSeat: Seat | null = spinSeat ?? (mockBoards !== null ? mockActiveSeat : mpActiveSeat)

  // "Whose turn" banner — a brief, hard-to-miss announcement on every genuine pass (Pass Turn or
  // Who Goes First landing), complementing the always-on topbar badge above (easy to miss once
  // you've panned/zoomed away from the table). Watches the *synced* seat rather than `activeSeat`
  // itself, since spinSeat overrides that one on every frame of Who Goes First's spin animation —
  // watching it directly would fire one of these per frame instead of once at the end. Skips the
  // very first value it ever observes so joining a game already in progress (which hydrates this
  // same seat from the host) doesn't announce a "pass" that never actually happened.
  const syncedActiveSeat = mockBoards !== null ? mockActiveSeat : mpActiveSeat
  const [turnAnnouncement, setTurnAnnouncement] = useState<{ seat: Seat; key: string } | null>(null)
  const turnAnnounceTimeoutRef = useRef<number | null>(null)
  const prevSyncedActiveSeatRef = useRef<Seat | null | undefined>(undefined)
  useEffect(() => {
    if (!inPod) return
    const prev = prevSyncedActiveSeatRef.current
    prevSyncedActiveSeatRef.current = syncedActiveSeat
    if (prev === undefined || syncedActiveSeat === null || syncedActiveSeat === prev) return
    setTurnAnnouncement({ seat: syncedActiveSeat, key: crypto.randomUUID() })
    if (turnAnnounceTimeoutRef.current) window.clearTimeout(turnAnnounceTimeoutRef.current)
    turnAnnounceTimeoutRef.current = window.setTimeout(() => setTurnAnnouncement(null), TURN_ANNOUNCE_TTL_MS)
  }, [inPod, syncedActiveSeat])
  useEffect(() => {
    return () => {
      if (turnAnnounceTimeoutRef.current) window.clearTimeout(turnAnnounceTimeoutRef.current)
    }
  }, [])

  // Only the player whose turn it currently is may pass it on; before anyone's gone
  // (activeSeat === null) it's up for grabs so the first Pass Turn click can kick things off.
  // Also up for grabs if activeSeat belonged to someone who's since left the pod (their board
  // drops out of opponentBoards on 'playerLeft' — see useMultiplayer) — otherwise activeSeat
  // stays pointed at a vacated seat forever and canPassTurn is false for every remaining real
  // player, softlocking turn rotation. nextActiveSeat already tolerates a `current` seat that
  // isn't in its own occupied list (falls back to the first occupied seat — see podLayout), so
  // the fix is purely this gate.
  const occupiedSeats: Seat[] = [mySeatResolved, ...opponentBoards.map((b) => b.seat)]
  const canPassTurn = activeSeat === null || activeSeat === mySeatResolved || !occupiedSeats.includes(activeSeat)

  function handlePassTurn() {
    if (!canPassTurn) return
    // Board stays visible and playable (e.g. still passing damage/reactions) — only an
    // eliminated seat's own turn is skipped from the rotation.
    const living = [mySeatResolved, ...opponentBoards.map((b) => b.seat)].filter((seat) => !isEliminated(seat))
    const next = nextActiveSeat(activeSeat, living)
    if (mockBoards !== null) setMockActiveSeat(next)
    else if (mpActive) broadcastTurnPass(next)
  }

  // Voluntary concede ("Scoop," this group's term — not "concede"). Reuses the exact same
  // eliminated concept 0 life triggers automatically (see isEliminated above): no separate
  // mechanism, just another way to set it. No "unscoop" — Ctrl+Z covers a misclick, same as
  // any other action. Confirmed via ConfirmModal since it's a one-way declaration for the game.
  const [confirmScoopOpen, setConfirmScoopOpen] = useState(false)
  function handleScoop() {
    dispatch({ type: 'SCOOP' })
    setConfirmScoopOpen(false)
  }

  /** "Who Goes First" — spins the turn highlight around the table, fast at first and
   *  slowing down, before landing on a uniformly random occupied seat. Only the final
   *  result is broadcast; the spin itself is a purely local flourish. */
  function handleRandomizeStart() {
    if (spinSeat !== null) return // a spin is already in progress
    const occupied = [mySeatResolved, ...opponentBoards.map((b) => b.seat)]
    const finalSeat = pickRandomSeat(occupied)
    const sequence = buildSpinSequence(occupied, finalSeat)
    const total = sequence.length
    const MIN_DELAY_MS = 70
    const MAX_DELAY_MS = 420
    let cumulative = 0
    sequence.forEach((seat, i) => {
      const t = total > 1 ? i / (total - 1) : 1
      cumulative += MIN_DELAY_MS + (MAX_DELAY_MS - MIN_DELAY_MS) * t * t // ease-out: slows down toward the end
      const timer = window.setTimeout(() => {
        setSpinSeat(seat)
        if (i === total - 1) {
          if (mockBoards !== null) setMockActiveSeat(seat)
          else if (mpActive) broadcastTurnPass(seat)
          setSpinSeat(null)
        }
      }, cumulative)
      spinTimers.current.push(timer)
    })
  }

  const [viewerZone, setViewerZone] = useState<'graveyard' | 'exile' | 'library' | null>(null)
  // Read-only view of an opponent's public zone (graveyard/exile) in a pod.
  const [oppZoneView, setOppZoneView] = useState<{ board: PublicBoard; zone: 'graveyard' | 'exile' | 'hand' } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ instanceId: string; x: number; y: number } | null>(null)
  // Separate from `contextMenu` above (which looks its card up in `battlefield`) since this one
  // looks its card up in `hand` instead — see handCardActions.
  const [handContextMenu, setHandContextMenu] = useState<{ instanceId: string; x: number; y: number } | null>(null)
  const [countPrompt, setCountPrompt] = useState<{ mode: 'scry' | 'surveil' | 'cascade' | 'dice' | 'bottom' | 'reveal'; x: number; y: number } | null>(null)
  // Snapshot of instanceIds captured the moment "Look at top N" is confirmed — deliberately NOT a
  // live count, so dragging one of them away doesn't pull a new card into view to replace it (an
  // "exile the top 5" effect means exactly those 5, not "keep 5 visible as you remove them"). A
  // dragged-away card naturally drops out of the rendered tray on its own: it's filtered against
  // the live `library` array below, and leaving the library removes it from that array entirely.
  const [peekedLibraryIds, setPeekedLibraryIds] = useState<string[]>([])
  const [peek, setPeek] = useState<{ title: string; note?: string; entries: PeekEntry[]; shuffleBottom: boolean } | null>(null)
  const [tokenPickerOpen, setTokenPickerOpen] = useState(false)
  // Where to place the next token(s) picked from TokenPickerModal. Set from a right-click on
  // empty battlefield (see handleCanvasContextMenu); null means "opened from the Actions tray",
  // which falls back to the usual staggered autoPosition() instead of a specific point.
  const [tokenSpawnPoint, setTokenSpawnPoint] = useState<{ x: number; y: number } | null>(null)
  const [deckManagerOpen, setDeckManagerOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // How many bottom-of-library cards to show; null means the viewer is closed. Unlike the Tutor
  // view (viewerZone === 'library'), closing this never shuffles — it's meant as a repeatable
  // "play from the bottom" capability, not a one-shot search effect.
  const [bottomViewerCount, setBottomViewerCount] = useState<number | null>(null)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  // Landing-spot preview while dragging a card over the battlefield (table-space, for children
  // of the camera-transformed surface — see computeDropPreview). One entry per moving card, so
  // a multi-select group drag previews all of them, not just the one actually grabbed. Cleared
  // on drop and on any dragend (including a cancelled drag, e.g. Esc or dropping outside a target).
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number }[] | null>(null)
  useEffect(() => {
    function clearPreview() {
      setDragPreview(null)
      // Same cancelled/dropped-outside-a-target cleanup, for a counter-pile drag's own hover
      // highlight (see counterDropTargetId) — a normal drop already clears it itself, this just
      // covers Esc/dropping somewhere that isn't a card.
      setCounterDropTargetId(null)
    }
    window.addEventListener('dragend', clearPreview)
    return () => window.removeEventListener('dragend', clearPreview)
  }, [])
  // Shift-click multi-select on your own battlefield — see handleBattlefieldCardClick.
  // Cleared on a plain click on empty canvas, Escape, or a restart/deck switch.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelectedIds(new Set())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Which of your own cards (hand or battlefield) the cursor is currently over — Delete/
  // Backspace sends it to the graveyard, see the keydown effect below. Only ever set from your
  // own cards' wrapper divs, never opponents' (killing another player's permanent by hotkey
  // isn't something a keyboard shortcut should be able to do).
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null)
  // Which of your own battlefield cards a dragged counter pile is currently hovering over — a
  // drop-target highlight, distinct from hoveredInstanceId above (a plain mouseover, unrelated
  // to a drag in progress). See the wrapper div's onDragEnter/onDragLeave/onDrop below.
  const [counterDropTargetId, setCounterDropTargetId] = useState<string | null>(null)
  // Separate from hoveredInstanceId (battlefield cards only) since the library pile shows at
  // most one card (its top) but isn't itself a GameCard the F-key handler can look up by id —
  // see the F-key effect below and TOGGLE_REVEAL_TOP.
  const [libraryHovered, setLibraryHovered] = useState(false)
  // Shift+drag-on-empty-canvas selection box (table-space corners, live while dragging) —
  // see handleCanvasMouseDown. Plain drag is reserved for panning, so this only ever starts
  // with shift held, same modifier as the individual-card multi-select click.
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const particlesRef = useRef<BattlefieldParticlesHandle>(null)
  const panState = useRef<{ startX: number; startY: number; camera: Camera } | null>(null)
  // Latest camera, readable synchronously (animation start point, gesture cancel).
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const cameraAnimRef = useRef<number | null>(null)

  const cancelCameraAnim = useCallback(() => {
    if (cameraAnimRef.current !== null) {
      cancelAnimationFrame(cameraAnimRef.current)
      cameraAnimRef.current = null
    }
  }, [])

  const centerCamera = useCallback(() => {
    cancelCameraAnim()
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    setCamera({ x: (rect.width - CANVAS_W) / 2, y: (rect.height - CANVAS_H) / 2, zoom: 1 })
  }, [cancelCameraAnim])

  /** Camera that frames a table-space region centered in the viewport, capped at `maxZoom`. */
  const cameraForRegion = useCallback((rx: number, ry: number, rw: number, rh: number, maxZoom: number): Camera | null => {
    const viewport = viewportRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    const zoom = Math.max(ZOOM_MIN, Math.min(maxZoom, Math.min(rect.width / rw, rect.height / rh) * FRAME_PADDING))
    return { zoom, x: rect.width / 2 - (rx + rw / 2) * zoom, y: rect.height / 2 - (ry + rh / 2) * zoom }
  }, [])

  /** Eased glide to a target camera so center-on-seat / fit-all isn't a jarring jump. */
  const animateCameraTo = useCallback(
    (target: Camera | null) => {
      if (!target) return
      cancelCameraAnim()
      const start = cameraRef.current
      const startTime = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - startTime) / CAMERA_ANIM_MS)
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 // easeInOutQuad
        setCamera({
          x: start.x + (target.x - start.x) * e,
          y: start.y + (target.y - start.y) * e,
          zoom: start.zoom + (target.zoom - start.zoom) * e,
        })
        cameraAnimRef.current = t < 1 ? requestAnimationFrame(tick) : null
      }
      cameraAnimRef.current = requestAnimationFrame(tick)
    },
    [cancelCameraAnim],
  )

  const centerOnSeat = useCallback(
    (seat: Seat) => {
      const o = seatOrigin(seat, CANVAS_W, CANVAS_H)
      // Frame wherever this seat's quadrant actually renders on screen, not its canonical
      // slot — see `mirror`/`viewRotated` above (inlined here since this is memoized and
      // `mirror` itself isn't).
      const d = viewRotated ? { x: surface.width - o.x - CANVAS_W, y: surface.height - o.y - CANVAS_H } : o
      animateCameraTo(cameraForRegion(d.x, d.y, CANVAS_W, CANVAS_H, 1))
    },
    [animateCameraTo, cameraForRegion, viewRotated, surface.width, surface.height],
  )

  const fitAll = useCallback(() => {
    const { width, height } = tableSize(CANVAS_W, CANVAS_H)
    animateCameraTo(cameraForRegion(0, 0, width, height, 1))
  }, [animateCameraTo, cameraForRegion])

  // Centers the canvas in the viewport once it's actually measurable, rather than at (0,0).
  useLayoutEffect(() => centerCamera(), [centerCamera])

  // Clean up any in-flight camera glide on unmount.
  useEffect(() => cancelCameraAnim, [cancelCameraAnim])

  // Restart the local game whenever the active deck actually changes (switching decks via the
  // topbar's Switch Deck button, without leaving Playtest). `state` is otherwise fully owned by
  // the reducer after its one-time lazy init (see initGame) — it never re-derives from `deck` on
  // its own, so without this, switching decks would silently desync the board from the new deck.
  // Keyed on deck.id (not the deck object reference, which changes on every reload including
  // re-picking the same deck) so re-selecting the current deck is a no-op, not a reset.
  //
  // Starts at null (not "the current deck.id") so this effect's very first run — mount — is
  // distinguishable from a later actual switch: on mount, isSwitch is false and the fresh
  // START_GAME below is skipped (the reducer's own lazy init, see initGame, already built one),
  // but the autosave-resume check below still runs — covering both "opening Playtest for a deck
  // with a saved game" and "switching to one."
  const lastDeckIdRef = useRef<string | null>(null)
  // A request counter, not a plain cancelled-by-cleanup boolean: StrictMode's dev-only
  // mount->cleanup->remount dance (see useMultiplayer.ts/DeckListContext.tsx for other spots
  // that already account for it in this codebase) can leave more than one of this effect's
  // invocations pending at once, and a cleanup-scoped boolean has no way to tell "the discarded
  // first attempt" apart from "the one that's actually still current" — only the LATEST attempt
  // (highest token) is ever allowed to apply its result, however many ran.
  const resumeAttemptRef = useRef(0)
  useEffect(() => {
    if (lastDeckIdRef.current === deck.id) return
    const isSwitch = lastDeckIdRef.current !== null
    lastDeckIdRef.current = deck.id
    if (isSwitch) {
      dispatch({ type: 'START_GAME', cards: buildStartingCards(deck), startingLife: startingLifeFor(deck) })
      setSelectedIds(new Set())
      centerCamera()
    }
    // Resume a solo autosave for this deck, if one exists and the decklist hasn't changed since
    // it was saved (see SoloGameSave.deckUpdatedAt) — replaces whatever fresh/switched-to state
    // was just set above. Never gated on inPod here: this only ever runs at mount or right after
    // a deck switch, both always solo (a pod is only ever entered afterward, by explicit choice).
    const attempt = ++resumeAttemptRef.current
    getSoloGameSave(deck.id).then((saved) => {
      if (resumeAttemptRef.current !== attempt || !saved || saved.deckUpdatedAt !== deck.updatedAt) return
      dispatch({ type: 'RESTORE_STATE', state: saved.state })
    })
  }, [deck, centerCamera, dispatch])

  // Frame the table when entering a pod (focus your own seat) and return to the
  // plain centered view when leaving, or when your seat is (re)assigned.
  //
  // A real connection reaches `mpActive` (status connected) as soon as the data channel
  // opens, but the host's WELCOME reply carrying our actual seat is one more round-trip
  // away — on a slow link that gap is easily long enough to see. Centering on
  // mySeatResolved's 0 fallback in that window would show the wrong quadrant, then jump
  // once the real seat lands; better to just wait for it (skipped entirely for the
  // mock-preview path, whose mockMySeat is never "not yet known").
  const seatPending = mpActive && mySeat === null
  useEffect(() => {
    if (seatPending) return
    if (inPod) centerOnSeat(mySeatResolved)
    else centerCamera()
  }, [inPod, mySeatResolved, seatPending, centerOnSeat, centerCamera])

  // Pod camera hotkeys: 1–4 center on that seat; 0 fits the whole table. F used to be an alias
  // for this too, but now means "flip a card" (see the F-key effect below) — freed up since 0
  // already covers fit-all on its own and doesn't need a second key sharing the job.
  useEffect(() => {
    if (!inPod) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.key >= '1' && event.key <= '4') {
        event.preventDefault()
        centerOnSeat((Number(event.key) - 1) as Seat)
      } else if (event.key === '0') {
        event.preventDefault()
        fitAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inPod, centerOnSeat, fitAll])

  // WASD: continuous camera pan while held, game-style — not gated by inPod, useful solo too.
  // Same direction convention as the mouse drag-pan in handleCanvasMouseDown (dragging the
  // table down/right increases camera.x/y — you're moving the *table*, not a "camera" per se),
  // so W (pan view up) increases camera.y just like dragging the table down would, D (pan view
  // right) decreases camera.x like dragging the table left, etc.
  // heldKeys/rAF state lives in this effect's own closure rather than React state — this runs
  // every animation frame while a key's held, and re-rendering the component that often just to
  // read a Set would be wasteful; setCamera is the only piece that actually needs to be state.
  useEffect(() => {
    const PAN_SPEED = 700 // px/sec at zoom 1; divided by zoom below so it feels the same zoomed in/out
    const heldKeys = new Set<string>()
    let rafId: number
    let lastTime: number | null = null

    function tick(now: number) {
      rafId = requestAnimationFrame(tick)
      if (heldKeys.size === 0) {
        lastTime = null
        return
      }
      if (lastTime === null) {
        lastTime = now
        return
      }
      const dt = (now - lastTime) / 1000
      lastTime = now
      setCamera((prev) => {
        const distance = (PAN_SPEED / prev.zoom) * dt
        let dx = 0
        let dy = 0
        if (heldKeys.has('w')) dy += distance
        if (heldKeys.has('s')) dy -= distance
        if (heldKeys.has('a')) dx += distance
        if (heldKeys.has('d')) dx -= distance
        return dx === 0 && dy === 0 ? prev : { ...prev, x: prev.x + dx, y: prev.y + dy }
      })
    }
    rafId = requestAnimationFrame(tick)

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key !== 'w' && key !== 'a' && key !== 's' && key !== 'd') return
      if (!heldKeys.has(key)) {
        // A fresh press, not an OS auto-repeat re-firing the same key: cancel any in-flight
        // animateCameraTo glide (center-on-seat, fit-all) the moment manual panning starts, same
        // as a mouse-drag pan already does — otherwise the two fight over camera state.
        cancelCameraAnim()
        heldKeys.add(key)
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      heldKeys.delete(event.key.toLowerCase())
    }
    // Alt-tabbing away (or anything else that steals focus) mid-hold never fires keyup, which
    // would otherwise pan forever in one direction — the classic "stuck key" bug.
    function onBlur() {
      heldKeys.clear()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [cancelCameraAnim])

  // Ctrl+Z / Cmd+Z: undo. Ctrl+Y, or the Ctrl+Shift+Z / Cmd+Shift+Z convention most Mac (and
  // some Windows) apps use instead, redoes — walks back the other way to the state as it was
  // before the last undo. Not gated by inPod (useful in solo play too), unlike the seat-focused
  // shortcuts above.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && event.shiftKey) {
        event.preventDefault()
        handleRedo()
      } else if (key === 'z') {
        event.preventDefault()
        handleUndo()
      } else if (key === 'y') {
        event.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleUndo, handleRedo])

  // "?" opens the shortcuts cheat sheet — not gated by inPod, works in solo play too.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.key === '?') {
        event.preventDefault()
        setShortcutsOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Delete/Backspace: send card(s) to the graveyard — a keyboard shortcut for the same
  // destination as the battlefield card menu's "Move to Graveyard" (see battlefieldCardActions),
  // plus a quick way to discard from hand, which otherwise has no dedicated action. Tokens cease
  // to exist off the battlefield regardless (MOVE_CARD's own isToken handling), so this just as
  // naturally discards a token as removes it. Backspace is included alongside Delete since
  // that's the key actually labeled "delete" on most keyboards without a dedicated forward-
  // delete key.
  //
  // An active multi-selection (shift-click on the battlefield, see selectedIds) takes priority
  // over whatever's merely hovered and sends the whole group — the deliberate, explicit signal
  // wins over the incidental one. Each selected card gets its own MOVE_CARD dispatch rather than
  // one bulk action; looping plain dispatch calls here is safe (and, as a side effect, undoes as
  // a single unit) because `dispatch`'s previousStateRef snapshot only updates on render — every
  // call in this same synchronous handler reads the same pre-batch stateRef.current, so
  // RESTORE_STATE afterward rolls back the whole batch at once, not just the last card.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedIds.size > 0) {
        event.preventDefault()
        for (const instanceId of selectedIds) {
          dispatch({ type: 'MOVE_CARD', instanceId, toZone: 'graveyard' })
        }
        setSelectedIds(new Set())
        return
      }
      if (!hoveredInstanceId) return
      // A card someone else relocated onto our own quadrant (a "taken" card, same free-for-all
      // as tapRemoteCard/flipRemoteCard above) lives in ITS owner's battlefield array, not ours
      // — check opponentBoards first so deleting it routes to their own graveyard via a directed
      // DELETE_CARD instead of a local dispatch (deleting it doesn't make it ours, it just leaves
      // wherever it's actually sitting). Falls through to the plain local dispatch below for
      // anything actually ours (hand or own battlefield), same as before this existed.
      if (inPod) {
        let onSomeonesBoard = false
        for (const board of opponentBoards) {
          const pc = board.battlefield.find((c) => c.instanceId === hoveredInstanceId)
          if (!pc) continue
          onSomeonesBoard = true
          if (pc.atSeat !== undefined && pc.atSeat === mySeatResolved) {
            event.preventDefault()
            deleteRemoteCard(board.playerId, pc.instanceId)
            setHoveredInstanceId(null)
          }
          break
        }
        if (onSomeonesBoard) return
      }
      event.preventDefault()
      dispatch({ type: 'MOVE_CARD', instanceId: hoveredInstanceId, toZone: 'graveyard' })
      setHoveredInstanceId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hoveredInstanceId, selectedIds, dispatch, inPod, opponentBoards, mySeatResolved, deleteRemoteCard])

  // Include opponents' public cards so their images resolve from the snapshot
  // cache too (battlefield + graveyard + exile + command), not just our own. Skips
  // FACE_DOWN_SCRYFALL_ID — it's a masked placeholder (see toPublicCard), never a real card,
  // so fetching it would just be a guaranteed-empty Scryfall lookup.
  const uniqueIds = useMemo(() => {
    const ids = new Set(state.cards.map((c) => c.scryfallId))
    for (const board of mockBoards ?? boards.values()) {
      for (const c of board.battlefield) if (c.scryfallId !== FACE_DOWN_SCRYFALL_ID) ids.add(c.scryfallId)
      for (const c of board.graveyard ?? []) ids.add(c.scryfallId)
      for (const c of board.exile ?? []) ids.add(c.scryfallId)
      for (const c of board.command ?? []) ids.add(c.scryfallId)
      for (const c of board.hand ?? []) ids.add(c.scryfallId)
    }
    return [...ids]
  }, [state.cards, boards, mockBoards])
  const [snapshots] = useCardSnapshots(uniqueIds)

  // Distinct tokens the deck's cards can make (from their Scryfall `related_tokens`), for the picker.
  // Deliberately scoped to just the deck's own real mainboard cards (not `snapshots.values()`
  // wholesale) — once a token has been created and put on the battlefield, its own snapshot also
  // lands in `snapshots` (via `uniqueIds`), and some token printings' own `related_tokens` field
  // references other tokens too. Counting those would inflate/pollute sourceCount and reorder the
  // picker out from under the player mid-session (reported: clicking a token moved it elsewhere in
  // the list, making repeated clicks land on the wrong tile).
  const deckCardIds = useMemo(
    () => new Set(deck.cards.filter((c) => c.board === 'mainboard' && !c.isToken).map((c) => c.scryfallId)),
    [deck.cards],
  )
  const deckTokens = useMemo(
    () => collectDeckTokens([...snapshots].filter(([id]) => deckCardIds.has(id)).map(([, snapshot]) => snapshot)),
    [snapshots, deckCardIds],
  )

  const library = zoneCards(state, 'library')
  const topOfLibrary = library[0]
  // See startRevealTop's doc: a snapshot of ids, filtered against the live library so a card
  // dragged away drops out on its own instead of pulling a new one into view. Preserves the
  // library's own top-to-bottom order (matches the order they'd resolve in for a real effect).
  const peekedLibraryCards = library.filter((c) => peekedLibraryIds.includes(c.instanceId))
  const hand = zoneCards(state, 'hand')
  const battlefield = zoneCards(state, 'battlefield')
  const battlefieldIdsKey = battlefield.map((c) => c.instanceId).join(',')

  // Goldfish practice stat: how many cards of a category (lands, or one of the deck's own
  // below) have actually been drawn (any zone but library) vs. what the deck's own ratio for
  // that category predicts by this turn (see engine/castability's drawsByTurn, the same
  // sample-size convention the Mana Base panel's castability odds already use). Scoped to the
  // cards that actually started in the library — commanders/tokens never did, so they'd skew
  // every count.
  const deckPopulationCards = state.cards.filter((c) => !c.isCommander && !c.isToken)
  function goldfishStat(matches: (scryfallId: string) => boolean) {
    const size = deckPopulationCards.filter((c) => matches(c.scryfallId)).length
    const drawn = deckPopulationCards.filter((c) => c.zone !== 'library' && matches(c.scryfallId)).length
    const expected = deckPopulationCards.length > 0 ? drawsByTurn(state.turn, true) * (size / deckPopulationCards.length) : 0
    return { size, drawn, expected }
  }
  const landsStat = goldfishStat((id) => snapshots.get(id)?.type_line.includes('Land') ?? false)

  // Same category bucketing the deck list uses (see engine/deckGrouping's groupByCategory):
  // Uncategorized leads, the rest sort alphabetically. Mainboard-only, and never a commander/
  // token — matches deckPopulationCards above.
  const categoryByScryfallId = new Map<string, string>()
  for (const dc of deck.cards) {
    if (dc.board !== 'mainboard' || dc.isCommander || dc.isToken) continue
    categoryByScryfallId.set(dc.scryfallId, dc.category && deck.categories.includes(dc.category) ? dc.category : UNCATEGORIZED_LABEL)
  }
  const categoryOrder = [UNCATEGORIZED_LABEL, ...[...deck.categories].sort((a, b) => a.localeCompare(b))]
  const goldfishRows: GoldfishRow[] = [
    { label: 'Lands', drawn: landsStat.drawn, expected: landsStat.expected },
    ...categoryOrder
      .map((label) => ({ label, ...goldfishStat((id) => categoryByScryfallId.get(id) === label) }))
      .filter((row) => row.size > 0)
      .map(({ label, drawn, expected }) => ({ label, drawn, expected })),
  ]

  // One playmat "skin" layer per seat, each showing *that player's own* choice (not mine) —
  // multiplayer request: "It would also be cool to see each players personal playmat choice."
  // Quadrant-local (not offset by seat origin) since positioning now happens via the layer's own
  // `style.left/top`, same CANVAS_W×CANVAS_H box every seat uses. In solo play there's just the
  // one layer at the table's own origin (0,0), identical to the pre-multiplayer-aware behavior.
  // A plain derived value like `battlefield`/`opponentBoards` themselves above, not useMemo'd,
  // since its own inputs are already fresh references every render.
  type SkinLayer = { key: string; origin: { x: number; y: number }; skin: BattlefieldSkin; points: { x: number; y: number; tapped: boolean }[] }
  // A card's shader point belongs with whichever quadrant it's actually SHOWING in right now
  // (atSeat, when someone's relocated it elsewhere), not with whichever board's array it lives
  // in — otherwise a relocated card leaves a ghost point glowing on its home quadrant forever
  // (nothing rendered there to explain it) while never lighting up the quadrant it actually
  // landed on. `x`/`y` are already stored relative to that effective seat's own origin (same
  // convention the battlefield-card render loops above use), so no extra translation needed.
  const allSeatedCards: { atOrigin: Seat; x: number; y: number; tapped: boolean }[] = [
    ...battlefield.map((c) => ({ atOrigin: c.atSeat ?? mySeatResolved, x: c.x ?? 0, y: c.y ?? 0, tapped: !!c.tapped })),
    ...opponentBoards.flatMap((board) =>
      board.battlefield.map((pc) => ({ atOrigin: pc.atSeat ?? board.seat, x: pc.x, y: pc.y, tapped: !!pc.tapped })),
    ),
  ]
  const pointsForSeat = (seat: Seat) =>
    allSeatedCards
      .filter((c) => c.atOrigin === seat)
      .map((c) => ({ x: c.x + CARD_W_PX / 2, y: c.y + CARD_H_PX / 2, tapped: c.tapped }))
  const skinLayers: SkinLayer[] = inPod
    ? [
        {
          key: `skin-${mySeatResolved}`,
          origin: myOrigin,
          skin: battlefieldSkin,
          points: pointsForSeat(mySeatResolved),
        },
        ...opponentBoards.map((board) => ({
          key: `skin-${board.seat}`,
          origin: seatOrigin(board.seat, CANVAS_W, CANVAS_H),
          skin: normalizeBattlefieldSkin(board.battlefieldSkin),
          points: pointsForSeat(board.seat),
        })),
      ]
    : [
        {
          key: 'skin-solo',
          origin: { x: 0, y: 0 },
          skin: battlefieldSkin,
          points: battlefield.map((c) => ({ x: (c.x ?? 0) + CARD_W_PX / 2, y: (c.y ?? 0) + CARD_H_PX / 2, tapped: !!c.tapped })),
        },
      ]

  // Newly-landed cards (played, tokened, given) get a brief pop/glow so the eye is
  // drawn to them. Each id's removal timer is independent of React's render cycle
  // (not effect cleanup) so an unrelated state change — tapping a card, a life
  // tick — can't cancel another card's still-pending glow.
  const seenBattlefieldIds = useRef<Set<string>>(new Set())
  const enteringTimers = useRef<Map<string, number>>(new Map())
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(battlefield.map((c) => c.instanceId))
    const newIds: string[] = []
    for (const id of currentIds) {
      if (!seenBattlefieldIds.current.has(id)) newIds.push(id)
    }
    seenBattlefieldIds.current = currentIds
    if (newIds.length === 0) return
    setEnteringIds((prev) => new Set([...prev, ...newIds]))
    newIds.forEach((id) => {
      const timer = window.setTimeout(() => {
        enteringTimers.current.delete(id)
        setEnteringIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 500)
      enteringTimers.current.set(id, timer)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battlefieldIdsKey])

  // Clear any outstanding timers on unmount only — not on every id-set change (see above).
  useEffect(() => {
    const timers = enteringTimers.current
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  // Same pop/glow, mirrored for opponents' battlefields: PublicBoard sync is a full-state
  // replace with no transition of its own, so without this a card an opponent plays just
  // pops into existence instead of animating in like a locally-played card does.
  const opponentBattlefieldIdsKey = opponentBoards
    .flatMap((b) => b.battlefield.map((c) => c.instanceId))
    .sort()
    .join(',')
  const seenOpponentBattlefieldIds = useRef<Set<string>>(new Set())
  const enteringOpponentTimers = useRef<Map<string, number>>(new Map())
  const [enteringOpponentIds, setEnteringOpponentIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(opponentBoards.flatMap((b) => b.battlefield.map((c) => c.instanceId)))
    const newIds: string[] = []
    for (const id of currentIds) {
      if (!seenOpponentBattlefieldIds.current.has(id)) newIds.push(id)
    }
    seenOpponentBattlefieldIds.current = currentIds
    if (newIds.length === 0) return
    setEnteringOpponentIds((prev) => new Set([...prev, ...newIds]))
    newIds.forEach((id) => {
      const timer = window.setTimeout(() => {
        enteringOpponentTimers.current.delete(id)
        setEnteringOpponentIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 500)
      enteringOpponentTimers.current.set(id, timer)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponentBattlefieldIdsKey])

  useEffect(() => {
    const timers = enteringOpponentTimers.current
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  const graveyard = zoneCards(state, 'graveyard')
  const exile = zoneCards(state, 'exile')
  const command = zoneCards(state, 'command')
  // All commander cards regardless of current zone — commander tax persists whether the
  // commander is sitting in Command or out on the battlefield (see GameCard.isCommander).
  const commanders = state.cards.filter((c) => c.isCommander)

  function clampToCanvas(x: number, y: number): { x: number; y: number } {
    return {
      x: Math.min(Math.max(x, 0), CANVAS_W - CARD_W_PX),
      y: Math.min(Math.max(y, 0), CANVAS_H - CARD_H_PX),
    }
  }

  /** Staggered fill for cards played without an explicit drop point, with the
   *  row block centered horizontally on the canvas so early cards land near the
   *  middle of the view rather than off toward an edge. */
  function autoPosition(): { x: number; y: number } {
    const n = battlefield.length
    const cols = 6
    const stepX = CARD_W_PX + 14
    const blockW = cols * stepX
    return clampToCanvas(
      (CANVAS_W - blockW) / 2 + (n % cols) * stepX,
      CANVAS_H / 2 - 220 + Math.floor(n / cols) * (CARD_H_PX + 20),
    )
  }

  function playToBattlefield(instanceId: string) {
    const { x, y } = autoPosition()
    dispatch({ type: 'MOVE_CARD', instanceId, toZone: 'battlefield', x, y })
    playCue('play-card')
  }

  /** Like playToBattlefield, but hides the card's identity from opponents from the moment it
   *  lands (a morph-style play) instead of playing face up and turning it down after. */
  function playToBattlefieldFaceDown(instanceId: string) {
    const { x, y } = autoPosition()
    dispatch({ type: 'MOVE_CARD', instanceId, toZone: 'battlefield', x, y, faceDown: true })
    playCue('play-card')
  }

  function handleDraw() {
    dispatch({ type: 'DRAW' })
    playCue('draw')
  }

  /** Mass tap: taps/untaps every card in `ids` together, as one group — the multi-select
   *  equivalent of clicking a single card. Toggles by consensus rather than flipping each
   *  card's own state independently (which would leave the group in a mixed, harder-to-read
   *  state): if every one of them is already tapped, this untaps the whole group; otherwise it
   *  taps whatever in the group isn't already tapped. Skips cards already in the target state so
   *  a repeat call (e.g. holding T) doesn't spam no-op dispatches.
   *  useCallback (rather than a plain function, like most handlers in this file) purely so the
   *  T-shortcut effect below has a stable dependency instead of resubscribing every render. */
  const tapSelection = useCallback(
    (ids: Set<string>) => {
      const selected = battlefield.filter((c) => ids.has(c.instanceId))
      if (selected.length === 0) return
      const nextTapped = !selected.every((c) => c.tapped)
      for (const c of selected) {
        if (c.tapped !== nextTapped) dispatch({ type: 'SET_TAPPED', instanceId: c.instanceId, tapped: nextTapped })
      }
    },
    [battlefield, dispatch],
  )

  /** Shift-click toggles a battlefield card into/out of the multi-select group instead of
   *  tapping it. A plain click on a card that's part of an active multi-selection (2+ cards)
   *  mass-taps the whole group instead — the group stays selected, so a repeat click (or the T
   *  shortcut — see the keydown effect below) keeps working on it, e.g. through several combat
   *  steps. A plain click on anything else taps just that one card and drops any selection, as
   *  before (a "click" only fires when the gesture didn't turn into a drag — see PlaytestCard's
   *  didDrag guard). Alt+click instead flash-highlights the card for the pod (see sendHighlight)
   *  — same modifier-key precedent as Alt+click on empty battlefield dropping a position ping. */
  function handleBattlefieldCardClick(gameCard: (typeof battlefield)[number], event: ReactMouseEvent) {
    if (event.altKey) {
      sendHighlight(gameCard.instanceId)
      return
    }
    const point = surfacePointAt(event.clientX, event.clientY)
    if (point) {
      const burstPoint = mirror(point.x, point.y)
      particlesRef.current?.burst(burstPoint.x, burstPoint.y, 9)
    }
    if (event.shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(gameCard.instanceId)) next.delete(gameCard.instanceId)
        else next.add(gameCard.instanceId)
        return next
      })
      return
    }
    if (selectedIds.size > 1 && selectedIds.has(gameCard.instanceId)) {
      tapSelection(selectedIds)
      return
    }
    setSelectedIds(new Set())
    dispatch({ type: 'SET_TAPPED', instanceId: gameCard.instanceId, tapped: !gameCard.tapped })
  }

  function createToken(source: (typeof battlefield)[number]) {
    const { x, y } = clampToCanvas((source.x ?? 0) + 16, (source.y ?? 0) + 16)
    dispatch({ type: 'CREATE_TOKEN', sourceInstanceId: source.instanceId, x, y })
  }

  // T: the keyboard version of clicking a card within an active multi-selection (see
  // tapSelection/handleBattlefieldCardClick) — mass-tap without needing to click one of the
  // selected cards specifically. Guarded against event.repeat: held down, an OS auto-repeat
  // would otherwise refire this every ~30-50ms and rapidly flip the group back and forth
  // between tapped/untapped instead of applying it once.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.toLowerCase() !== 't') return
      if (selectedIds.size === 0) return
      event.preventDefault()
      tapSelection(selectedIds)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, tapSelection])

  /** Opens a card's Scryfall page (which includes its rulings) in a new tab. The trimmed-down
   *  CardSnapshot this app caches deliberately drops set/collector_number (see storage/cardCache.ts),
   *  so this needs the fuller ScryfallCard — getCardById serves the in-memory search cache when
   *  possible, otherwise a single live lookup.
   *
   *  Opens the blank tab synchronously, before the `await` below, and navigates it once the
   *  lookup resolves — opening it only after an awaited fetch gets silently popup-blocked in
   *  most browsers, since the async gap breaks the "this came from a real click" gesture chain
   *  they check for. Can't use `noopener` here (it nulls the reference this needs to navigate
   *  the tab later), so `tab.opener` is cleared manually instead — same reverse-tabnabbing
   *  protection, just applied after the fact rather than via the `window.open` option.
   *
   *  Silently closes the blank tab on failure (offline, deleted printing, etc.) — a failed
   *  rulings lookup shouldn't interrupt the game it's attached to, same philosophy as the sound
   *  cues (see utils/sound.ts). */
  async function lookUpRulings(scryfallId: string) {
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const card = await getCardById(scryfallId)
      if (card.set && card.collector_number && tab) {
        tab.location.href = `https://scryfall.com/card/${card.set}/${card.collector_number}`
      } else {
        tab?.close()
      }
    } catch {
      tab?.close()
    }
  }

  /** Right-click menu for a battlefield card — replaces the old bolt-on clone/counter buttons with one consistent interaction. */
  function battlefieldCardActions(gameCard: (typeof battlefield)[number]): ContextMenuAction[] {
    const snapshot = snapshotFor(gameCard.scryfallId)
    const actions: ContextMenuAction[] = [
      {
        label: gameCard.tapped ? 'Untap' : 'Tap',
        onSelect: () => dispatch({ type: 'SET_TAPPED', instanceId: gameCard.instanceId, tapped: !gameCard.tapped }),
      },
      { label: 'Clone as Token', onSelect: () => createToken(gameCard) },
      {
        label: 'Add Counter',
        submenu: COUNTER_COLORS.map((c) => ({
          label: c.label,
          onSelect: () => dispatch({ type: 'ADD_COUNTER_PILE', instanceId: gameCard.instanceId, color: c.id }),
        })),
      },
      {
        label: 'Add Power/Toughness Counter',
        submenu: COUNTER_COLORS.map((c) => ({
          label: c.label,
          onSelect: () => dispatch({ type: 'ADD_PT_COUNTER_PILE', instanceId: gameCard.instanceId, color: c.id }),
        })),
      },
    ]
    if (snapshot && isFlippableSnapshot(snapshot)) {
      actions.push({
        label: gameCard.showBackFace ? 'Flip to Front' : 'Flip to Back',
        onSelect: () => dispatch({ type: 'FLIP_CARD', instanceId: gameCard.instanceId }),
      })
    }
    actions.push({
      // Distinct from Flip to Front/Back above: this hides the card's identity entirely
      // (a generic back to everyone else, like a morph) rather than showing its own printed
      // back face — see GameCard.faceDown / toPublicCard.
      label: gameCard.faceDown ? 'Turn Face Up' : 'Turn Face Down',
      onSelect: () => dispatch({ type: 'SET_FACE_DOWN', instanceId: gameCard.instanceId, faceDown: !gameCard.faceDown }),
    })
    const moveTargets: { zone: GameZone; label: string; libraryPosition?: 'top' | 'bottom' }[] = [
      { zone: 'hand', label: 'Move to Hand' },
      { zone: 'graveyard', label: 'Move to Graveyard' },
      { zone: 'exile', label: 'Move to Exile' },
      { zone: 'library', label: 'Move to Library (Top)', libraryPosition: 'top' },
    ]
    if (deck.format === 'commander') moveTargets.push({ zone: 'command', label: 'Move to Command' })
    for (const { zone, label, libraryPosition } of moveTargets) {
      actions.push({ label, onSelect: () => dispatch({ type: 'MOVE_CARD', instanceId: gameCard.instanceId, toZone: zone, libraryPosition }) })
    }
    // Always the card's real identity even if currently played face-down — this is only ever
    // shown for our own battlefield cards, whose faceDown state hides them from opponents, not
    // from us (see GameCard.faceDown doc).
    actions.push({ label: 'Look Up Rulings', onSelect: () => lookUpRulings(gameCard.scryfallId) })
    return actions
  }

  /** Right-click menu for a card sitting in hand (see #35/#36) — hand cards otherwise only
   *  support a plain click (playToBattlefield). Deliberately just these two actions: Look Up
   *  Rulings needs no zone change, and playing face down is a distinct action from the plain
   *  click, not a toggle applied after playing normally. */
  function handCardActions(gameCard: (typeof hand)[number]): ContextMenuAction[] {
    return [
      { label: 'Play Face Down', onSelect: () => playToBattlefieldFaceDown(gameCard.instanceId) },
      { label: 'Look Up Rulings', onSelect: () => lookUpRulings(gameCard.scryfallId) },
    ]
  }

  function moveFromViewer(instanceId: string, toZone: GameZone) {
    if (toZone === 'battlefield') {
      playToBattlefield(instanceId)
      return
    }
    dispatch({ type: 'MOVE_CARD', instanceId, toZone, libraryPosition: 'top' })
  }

  /** Closing the tutor deliberately does NOT auto-shuffle (it used to — user found the forced
   *  shuffle on every library peek/right-click more annoying than helpful). Real Magic does
   *  require shuffling after a search, but that's now the player's own call via the R shortcut
   *  (hover the library, press R — see the R-key effect), like reaching for your deck at a real
   *  table. The viewer's note text reminds them. */
  function closeViewer() {
    setViewerZone(null)
  }

  /** Shuffles the library, with the cue — shared by the R shortcut and anything else that wants
   *  an explicit shuffle. */
  function shuffleLibrary() {
    dispatch({ type: 'SHUFFLE_LIBRARY', shuffledOrder: shuffle(library.map((c) => c.instanceId)) })
    playCue('shuffle')
  }

  /** "Look at top N": reveals the top N library cards as real, individually draggable cards (see
   *  PlaytestCard's draggableFromZone) right next to the library pile — for effects like "exile
   *  the top 5 cards of your library" where you want to drag each one straight to wherever it's
   *  actually going (battlefield, graveyard, exile, hand) rather than picking from button-based
   *  destinations in a modal. Purely local UI state, same as the existing Tutor/scry/surveil
   *  peeks — nothing here touches game state or the network. */
  function startRevealTop(count: number) {
    setPeekedLibraryIds(library.slice(0, count).map((c) => c.instanceId))
    setCountPrompt(null)
  }

  function startScryOrSurveil(mode: 'scry' | 'surveil', count: number) {
    const entries: PeekEntry[] = library.slice(0, count).map((gameCard) => ({
      gameCard,
      snapshot: snapshotFor(gameCard.scryfallId),
      foil: foilFor(gameCard.scryfallId),
      options: mode === 'scry' ? ['top', 'bottom'] : ['top', 'graveyard'],
    }))
    setPeek({ title: `${mode === 'scry' ? 'Scry' : 'Surveil'} ${count}`, entries, shuffleBottom: false })
    setCountPrompt(null)
  }

  /** Exiles cards off the top until finding a nonland whose mana value is under the cascading spell's
   *  own mana value (or the library runs out) — the real rule, not just "first nonland." Everything
   *  exiled this way that isn't cast goes to the bottom, shuffled; see HANDOFF.md for the exile-trigger note. */
  function startCascade(manaValue: number) {
    const revealed: typeof library = []
    let hitIndex = -1
    for (const card of library) {
      revealed.push(card)
      const snapshot = snapshotFor(card.scryfallId)
      // Scryfall's top-level type_line concatenates both faces for MDFC/split layouts (e.g.
      // "Sorcery // Land"), which would wrongly read a nonland front face as a land — check the
      // front face's own type_line first, same "prefer card_faces[0]" pattern already used for
      // mana costs in getCastingManaCost (api/scryfall.ts).
      const typeLine = snapshot ? (snapshot.card_faces?.[0]?.type_line ?? snapshot.type_line) : ''
      const isLand = typeLine.toLowerCase().includes('land')
      // A card whose snapshot hasn't loaded yet can't be confirmed as a qualifying nonland, so it
      // never stops the reveal — better to keep looking than to guess and stop in the wrong place.
      if (!isLand && snapshot && snapshot.cmc < manaValue) {
        hitIndex = revealed.length - 1
        break
      }
    }
    const found = hitIndex >= 0
    const exiledCount = revealed.length
    const entries: PeekEntry[] = revealed.map((gameCard, index) => ({
      gameCard,
      snapshot: snapshotFor(gameCard.scryfallId),
      foil: foilFor(gameCard.scryfallId),
      options: index === hitIndex ? ['hand', 'bottom'] : ['bottom'],
    }))
    // The card you might actually take is the one that matters — put it first instead of
    // wherever it fell in reveal order, so it's not buried under a pile of auto-skipped lands.
    if (hitIndex > 0) {
      const [hitEntry] = entries.splice(hitIndex, 1)
      entries.unshift(hitEntry)
    }
    setPeek({
      title: `Cascade for ${manaValue}`,
      note: found
        ? `Exiled ${exiledCount} card${exiledCount === 1 ? '' : 's'} looking for a nonland under mana value ${manaValue} — found one. Decide whether to take it; the rest shuffle to the bottom. (${exiledCount} exile triggers, if anything cares.)`
        : `Exiled all ${exiledCount} remaining card${exiledCount === 1 ? '' : 's'} without finding a nonland under mana value ${manaValue} — everything shuffles to the bottom. (${exiledCount} exile triggers, if anything cares.)`,
      entries,
      shuffleBottom: true,
    })
    setCountPrompt(null)
  }

  /** Rolls an N-sided die, logs it locally, and shares it with the pod (if connected). */
  function rollDie(sides: number) {
    const roll: RollResult = { kind: 'die', sides, value: 1 + Math.floor(Math.random() * sides) }
    addRollEntry(playerId, playerName, roll)
    if (mpActive) broadcastRoll(roll)
    setCountPrompt(null)
  }

  /** Flips a coin, logs it locally, and shares it with the pod (if connected). */
  function flipCoin() {
    const roll: RollResult = { kind: 'coin', value: Math.random() < 0.5 ? 'heads' : 'tails' }
    addRollEntry(playerId, playerName, roll)
    if (mpActive) broadcastRoll(roll)
  }

  function openBottomViewer(count: number) {
    setBottomViewerCount(count)
    setCountPrompt(null)
  }

  function confirmPeek(placements: PeekPlacement[]) {
    if (!peek) return
    const topOrder: string[] = []
    const bottomIds: string[] = []
    const graveyardIds: string[] = []
    const handIds: string[] = []
    for (const { instanceId, destination } of placements) {
      if (destination === 'top') topOrder.push(instanceId)
      else if (destination === 'graveyard') graveyardIds.push(instanceId)
      else if (destination === 'hand') handIds.push(instanceId)
      else bottomIds.push(instanceId)
    }
    const bottomFinal = peek.shuffleBottom ? shuffle(bottomIds) : bottomIds
    const touchedIds = new Set([...topOrder, ...bottomFinal, ...graveyardIds, ...handIds])
    const untouched = library.map((c) => c.instanceId).filter((id) => !touchedIds.has(id))
    dispatch({ type: 'SHUFFLE_LIBRARY', shuffledOrder: [...topOrder, ...untouched, ...bottomFinal] })
    for (const id of graveyardIds) dispatch({ type: 'MOVE_CARD', instanceId: id, toZone: 'graveyard' })
    for (const id of handIds) dispatch({ type: 'MOVE_CARD', instanceId: id, toZone: 'hand' })
    setPeek(null)
  }

  /** Which seat's quadrant a table-space point falls in (pod only). */
  function seatAtSurfacePoint(x: number, y: number): Seat {
    const col = x >= CANVAS_W ? 1 : 0
    const row = y >= CANVAS_H ? 1 : 0
    return ALL_SEATS.find((s) => SEAT_GRID[s].col === col && SEAT_GRID[s].row === row) ?? mySeatResolved
  }

  /** Table-space position(s) (for children of the camera-transformed surface) a card — and any
   *  group riding along with it — would land at right now, mirroring handleBattlefieldDrop's own
   *  math exactly, including switching to an opponent's quadrant mid-drag if that's where a
   *  battlefield card would be given away, so the preview can never show a spot the actual drop
   *  wouldn't use. Group members are clamped individually, same as the real drop. */
  function computeDropPreview(clientX: number, clientY: number): { x: number; y: number }[] | null {
    const drag = getCurrentDragData()
    const viewport = viewportRef.current
    if (!drag || !viewport) return null
    const rect = viewport.getBoundingClientRect()
    // Always centers the fixed battlefield card size under the cursor — computed from our own
    // known table-space dimensions, not from wherever the dragged element grabbed the pointer
    // (which used to vary with hand-card size, zoom, and click position; see handleDragStart).
    // Reflect the raw cursor point (display -> canonical) before centering, so everything
    // below (origin subtraction, clampToCanvas, seatAtSurfacePoint) runs in canonical space
    // exactly as it did before rotation existed.
    const cursor = mirror((clientX - rect.left - camera.x) / camera.zoom, (clientY - rect.top - camera.y) / camera.zoom)
    const surfaceX = cursor.x - CARD_W_PX / 2
    const surfaceY = cursor.y - CARD_H_PX / 2

    let origin = myOrigin
    if (inPod && mpActive && drag.fromZone === 'battlefield') {
      const targetSeat = seatAtSurfacePoint(surfaceX, surfaceY)
      if (targetSeat !== mySeatResolved && opponentBoards.some((b) => b.seat === targetSeat)) {
        origin = seatOrigin(targetSeat, CANVAS_W, CANVAS_H)
      }
    }
    const anchor = clampToCanvas(surfaceX - origin.x, surfaceY - origin.y)
    const positions = [{ x: origin.x + anchor.x, y: origin.y + anchor.y }]
    for (const g of drag.groupOffsets ?? []) {
      const member = clampToCanvas(surfaceX - origin.x + g.dx, surfaceY - origin.y + g.dy)
      positions.push({ x: origin.x + member.x, y: origin.y + member.y })
    }
    return positions
  }

  function handleBattlefieldDragOver(event: DragEvent) {
    event.preventDefault()
    setDragPreview(computeDropPreview(event.clientX, event.clientY))
  }

  function handleBattlefieldDrop(event: DragEvent) {
    event.preventDefault()
    setDragPreview(null)
    const data = getGameDragData(event)
    const viewport = viewportRef.current
    if (!data || !viewport) return
    const rect = viewport.getBoundingClientRect()
    // Same centering as computeDropPreview — keep these in sync (including the display ->
    // canonical `mirror` call, so everything below stays in canonical space).
    const cursor = mirror((event.clientX - rect.left - camera.x) / camera.zoom, (event.clientY - rect.top - camera.y) / camera.zoom)
    const surfaceX = cursor.x - CARD_W_PX / 2
    const surfaceY = cursor.y - CARD_H_PX / 2

    // Dragging a card that lives on ANOTHER player's board (see PlaytestCard's remoteOwnerId) —
    // just reposition it wherever it landed, on any quadrant including its owner's own, without
    // touching our local state (we have no copy of this card; its owner's client applies the
    // move and re-broadcasts). This is the "move any card anywhere" table-talk feature, distinct
    // from giving a card away below (which only ever moves *our own* cards to someone else).
    if (inPod && data.fromPlayerId) {
      const targetSeat = seatAtSurfacePoint(surfaceX, surfaceY)
      const targetOrigin = seatOrigin(targetSeat, CANVAS_W, CANVAS_H)
      const { x, y } = clampToCanvas(surfaceX - targetOrigin.x, surfaceY - targetOrigin.y)
      // x/y above are relative to targetSeat's own origin, not the card owner's — the owner's
      // client (and everyone re-rendering their board) has to know to offset by targetSeat too,
      // not their fixed board.seat, or the card would render back in the wrong quadrant (see
      // atSeat on PublicCard/GameCard). Normalize to undefined when dropped back on the card's
      // own natural seat, so it doesn't carry a redundant explicit atSeat forever after.
      const ownerSeat = opponentBoards.find((b) => b.playerId === data.fromPlayerId)?.seat
      const atSeat = targetSeat === ownerSeat ? undefined : targetSeat
      const burstPoint = mirror(surfaceX + CARD_W_PX / 2, surfaceY + CARD_H_PX / 2)
      particlesRef.current?.burst(burstPoint.x, burstPoint.y)
      if (mpActive) {
        relocateCard(data.fromPlayerId, data.instanceId, x, y, atSeat)
      } else if (mockBoards) {
        // DEV-only preview pod has no live peer to deliver a RELOCATE_CARD to — apply the
        // move straight to the mock board so the "move any card anywhere" feature is actually
        // exercisable without a second real client (see buildMockBoards/togglePreviewPod).
        setMockBoards((prev) =>
          (prev ?? []).map((b) =>
            b.playerId === data.fromPlayerId
              ? { ...b, battlefield: b.battlefield.map((c) => (c.instanceId === data.instanceId ? { ...c, x, y, atSeat } : c)) }
              : b,
          ),
        )
      }
      return
    }

    // Dropped a battlefield *or hand* card into a live opponent's quadrant → hand it (and any
    // multi-selected group riding along, battlefield-only) over. Giving straight from hand
    // (not just cards already played on your own board) matches how handing someone a card
    // actually works.
    if (inPod && mpActive && (data.fromZone === 'battlefield' || data.fromZone === 'hand')) {
      const targetSeat = seatAtSurfacePoint(surfaceX, surfaceY)
      const targetBoard = targetSeat !== mySeatResolved ? opponentBoards.find((b) => b.seat === targetSeat) : undefined
      const sourceCards = data.fromZone === 'battlefield' ? battlefield : hand
      const card = targetBoard ? sourceCards.find((c) => c.instanceId === data.instanceId) : undefined
      if (targetBoard && card) {
        const targetOrigin = seatOrigin(targetSeat, CANVAS_W, CANVAS_H)
        const local = clampToCanvas(surfaceX - targetOrigin.x, surfaceY - targetOrigin.y)
        const giveOne = (c: (typeof battlefield)[number], x: number, y: number) => {
          giveCard(targetBoard.playerId, {
            instanceId: c.instanceId,
            scryfallId: c.scryfallId,
            // Preserve the true owner if this card was itself given to us.
            ownerSeat: c.ownerSeat ?? mySeatResolved,
            x,
            y,
            tapped: c.tapped,
            counters: c.counters,
            ptCounters: c.ptCounters,
            showBackFace: c.showBackFace,
            isToken: c.isToken,
            faceDown: c.faceDown,
          })
          dispatch({ type: 'REMOVE_CARD', instanceId: c.instanceId })
        }
        const burstPoint = mirror(surfaceX + CARD_W_PX / 2, surfaceY + CARD_H_PX / 2)
        particlesRef.current?.burst(burstPoint.x, burstPoint.y)
        giveOne(card, local.x, local.y)
        for (const g of data.groupOffsets ?? []) {
          const member = battlefield.find((c) => c.instanceId === g.instanceId)
          if (!member) continue
          const memberLocal = clampToCanvas(surfaceX - targetOrigin.x + g.dx, surfaceY - targetOrigin.y + g.dy)
          giveOne(member, memberLocal.x, memberLocal.y)
        }
        return
      }
    }

    // Otherwise a normal drop: keep the card (and any group riding along) in our own quadrant.
    const { x, y } = clampToCanvas(surfaceX - myOrigin.x, surfaceY - myOrigin.y)
    const burstPoint = mirror(surfaceX + CARD_W_PX / 2, surfaceY + CARD_H_PX / 2)
    particlesRef.current?.burst(burstPoint.x, burstPoint.y)
    if (data.fromZone === 'battlefield') {
      dispatch({ type: 'SET_POSITION', instanceId: data.instanceId, x, y })
      for (const g of data.groupOffsets ?? []) {
        const member = clampToCanvas(surfaceX - myOrigin.x + g.dx, surfaceY - myOrigin.y + g.dy)
        dispatch({ type: 'SET_POSITION', instanceId: g.instanceId, x: member.x, y: member.y })
      }
    } else {
      dispatch({ type: 'MOVE_CARD', instanceId: data.instanceId, toZone: 'battlefield', x, y })
      playCue('play-card')
    }
  }

  /** Wheel-to-zoom, keeping the point under the cursor fixed on screen. Alt+scroll is reserved for
   *  resizing the hover-preview popup (a window-level listener in HoverPreviewContext handles that) —
   *  swallow the event here without zooming so the two interactions don't fight over the same gesture. */
  function handleWheel(event: WheelEvent) {
    event.preventDefault()
    if (event.altKey) return
    setContextMenu(null)
    cancelCameraAnim()
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    setCamera((prev) => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor))
      const canvasPointX = (mouseX - prev.x) / prev.zoom
      const canvasPointY = (mouseY - prev.y) / prev.zoom
      return { zoom, x: mouseX - canvasPointX * zoom, y: mouseY - canvasPointY * zoom }
    })
  }

  /** Shows a "look here" marker at a table-absolute point and shares it with the pod (if connected). */
  function sendPing(x: number, y: number) {
    addPing(playerId, playerName, x, y)
    if (mpActive) broadcastPing(x, y)
  }

  /** Flash-highlights a specific card (own or an opponent's) and shares it with the pod
   *  (if connected) — the "look at THIS card" gesture, triggered by Alt+click landing on a
   *  card instead of empty battlefield (see handleBattlefieldCardClick and the opponent
   *  battlefield card's onClick, below). */
  function sendHighlight(instanceId: string) {
    addHighlight(instanceId)
    if (mpActive) broadcastHighlight(instanceId)
  }

  /** Fires a one-click emoji reaction and shares it with the pod (if connected) — pure fun,
   *  same local-then-broadcast shape as sendPing/sendHighlight above. */
  function sendReaction(emoji: string) {
    addReaction(playerId, emoji)
    if (mpActive) broadcastReaction(emoji)
  }

  /** Table-space point under the cursor, using the CURRENT camera (via cameraRef, not the
   *  possibly-stale `camera` closed over by whichever render attached this handler) — shared
   *  by the marquee's move/up listeners so a mid-drag zoom can't throw off the selection box. */
  function surfacePointAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const viewport = viewportRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    const cam = cameraRef.current
    const x = (clientX - rect.left - cam.x) / cam.zoom
    const y = (clientY - rect.top - cam.y) / cam.zoom
    // What's under the cursor on screen is display space; callers (marquee hit-testing
    // against canonical card positions, sendPing's canonical broadcast) all want canonical —
    // `mirror` is self-inverse so this converts display -> canonical the same way render
    // sites convert canonical -> display.
    return mirror(x, y)
  }

  /** Drag-on-empty-canvas-to-pan, or shift+drag for a marquee selection box. Only starts when
   *  the mousedown lands directly on the canvas background, not a card. Alt+click instead drops
   *  a ping at that point (see backlog "ping a board position") — it doesn't start a drag. */
  function handleCanvasMouseDown(event: ReactMouseEvent) {
    if (event.button !== 0 || event.target !== canvasRef.current) return
    const point = surfacePointAt(event.clientX, event.clientY)
    if (point) {
      const burstPoint = mirror(point.x, point.y)
      particlesRef.current?.burst(burstPoint.x, burstPoint.y)
    }
    playCue('board-tap')
    setContextMenu(null)
    // A plain click on empty background drops the selection — shift doesn't, so an accidental
    // miss between cards (a click, or the start of a marquee drag) doesn't wipe out the group.
    if (!event.shiftKey) setSelectedIds(new Set())
    cancelCameraAnim()
    if (event.altKey) {
      const point = surfacePointAt(event.clientX, event.clientY)
      if (point) sendPing(point.x, point.y)
      return
    }

    if (event.shiftKey) {
      const start = surfacePointAt(event.clientX, event.clientY)
      if (!start) return
      setMarquee({ x1: start.x, y1: start.y, x2: start.x, y2: start.y })

      function onMove(moveEvent: globalThis.MouseEvent) {
        const point = surfacePointAt(moveEvent.clientX, moveEvent.clientY)
        if (point) setMarquee((prev) => (prev ? { ...prev, x2: point.x, y2: point.y } : prev))
      }
      function onUp(upEvent: globalThis.MouseEvent) {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const end = surfacePointAt(upEvent.clientX, upEvent.clientY)
        setMarquee((prev) => {
          if (!prev) return null
          const point = end ?? { x: prev.x2, y: prev.y2 }
          const left = Math.min(prev.x1, point.x)
          const right = Math.max(prev.x1, point.x)
          const top = Math.min(prev.y1, point.y)
          const bottom = Math.max(prev.y1, point.y)
          const hitIds = battlefield
            .filter((c) => {
              const cx = (c.x ?? 0) + myOrigin.x
              const cy = (c.y ?? 0) + myOrigin.y
              return cx < right && cx + CARD_W_PX > left && cy < bottom && cy + CARD_H_PX > top
            })
            .map((c) => c.instanceId)
          if (hitIds.length > 0) setSelectedIds((prevSel) => new Set([...prevSel, ...hitIds]))
          return null
        })
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      return
    }

    panState.current = { startX: event.clientX, startY: event.clientY, camera }

    function onMove(moveEvent: globalThis.MouseEvent) {
      const start = panState.current
      if (!start) return
      setCamera({ ...start.camera, x: start.camera.x + (moveEvent.clientX - start.startX), y: start.camera.y + (moveEvent.clientY - start.startY) })
    }
    function onUp() {
      panState.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** Right-click empty battlefield background → open the token picker, dropping the chosen
   *  token at the actual clicked point instead of the usual staggered autoPosition() fill. Only
   *  fires when the right-click lands directly on the playmat (not a card, which has its own
   *  context menu — see battlefieldCardActions). */
  function handleCanvasContextMenu(event: ReactMouseEvent) {
    if (event.target !== canvasRef.current) return
    event.preventDefault()
    setContextMenu(null)
    const point = surfacePointAt(event.clientX, event.clientY)
    if (!point) return
    setTokenSpawnPoint(clampToCanvas(point.x - CARD_W_PX / 2 - myOrigin.x, point.y - CARD_H_PX / 2 - myOrigin.y))
    setTokenPickerOpen(true)
  }

  function dropToZone(toZone: GameZone, libraryPosition?: 'top' | 'bottom') {
    return (data: DraggedGameCard) => {
      if (data.fromZone === toZone && toZone !== 'library') return
      dispatch({ type: 'MOVE_CARD', instanceId: data.instanceId, toZone, libraryPosition })
    }
  }

  /** Drop target for dragging a counter-pile chip (see CounterPileStack/PtCounterPileStack) onto
   *  one of your own OTHER battlefield cards — moves the whole pile there, merging into a
   *  same-color pile already on the target (see gameReducer's MOVE_COUNTER_PILE doc). Own cards
   *  only, same scope the chips are even draggable in the first place (only interactive — i.e.
   *  your own — piles carry a sourceInstanceId to drag with). */
  function handleCounterPileDrop(event: DragEvent, toInstanceId: string) {
    const data = getCounterDragData(event)
    if (!data) return
    event.preventDefault()
    event.stopPropagation()
    setCounterDropTargetId(null)
    if (data.fromInstanceId === toInstanceId) return
    if (data.kind === 'generic') {
      dispatch({ type: 'MOVE_COUNTER_PILE', fromInstanceId: data.fromInstanceId, pileId: data.pileId, toInstanceId })
    } else {
      dispatch({ type: 'MOVE_PT_COUNTER_PILE', fromInstanceId: data.fromInstanceId, pileId: data.pileId, toInstanceId })
    }
  }

  function handleMulligan() {
    const ids = [...hand, ...library].map((c) => c.instanceId)
    dispatch({ type: 'MULLIGAN', shuffledOrder: shuffle(ids) })
    playCue('shuffle')
  }

  function handleRestart() {
    dispatch({ type: 'START_GAME', cards: buildStartingCards(deck), startingLife: startingLifeFor(deck) })
    setSelectedIds(new Set())
    centerCamera()
  }

  /** DEV only: fabricate 3 opponents from cards already in this deck, filling whichever
   *  seats `seatForMe` isn't occupying — so their images resolve from the snapshot cache.
   *  Lets step 4's shared table be exercised before real joining (step 5) exists, and lets
   *  `swapMockSeat` re-seat "me" without the mocks colliding with my new seat. */
  function buildMockBoards(seatForMe: Seat): PublicBoard[] {
    const pick = (n: number) => uniqueIds[n % Math.max(1, uniqueIds.length)] ?? ''
    // Distinct battlefieldSkin per mock opponent — exercises the "see each player's own
    // playmat choice" feature (see skinLayers above) without needing a second real connection.
    const mockSkins: Record<Seat, string> = { 0: 'felt', 1: 'neonGlow', 2: 'prism', 3: 'triangles' }
    const mk = (
      seat: Seat,
      name: string,
      cards: PublicBoard['battlefield'],
      graveyard: PublicBoard['graveyard'] = [],
      exile: PublicBoard['exile'] = [],
      command: PublicBoard['command'] = [],
      hand?: PublicBoard['hand'],
    ): PublicBoard => ({
      playerId: `mock-${seat}`,
      name,
      seat,
      life: 40 - seat * 4,
      commanderDamage: {},
      poison: seat === 3 ? 3 : 0,
      handCount: 4 + seat,
      battlefield: cards,
      graveyard,
      exile,
      command,
      hand,
      battlefieldSkin: mockSkins[seat],
    })
    const [seatA, seatB, seatC] = ALL_SEATS.filter((s) => s !== seatForMe)
    return [
      mk(
        seatA,
        'Ramp Rachel',
        [
          { instanceId: 'mock-1a', scryfallId: pick(0), x: 300, y: 300, tapped: false },
          {
            instanceId: 'mock-1b',
            scryfallId: pick(1),
            x: 620,
            y: 520,
            tapped: true,
            counters: [{ id: 'mock-pile-1', color: 'gold', value: 2 }],
            ptCounters: [{ id: 'mock-pt-pile-1', color: 'green', power: 1, toughness: -1 }],
          },
          // Exercises the face-down rendering path — real toPublicCard masking isn't exercised
          // by this hand-authored mock data (it bypasses toPublicCard entirely), only the
          // receiving-side card-back render; the masking itself needs a real two-client test.
          { instanceId: 'mock-1d', scryfallId: pick(2), x: 480, y: 420, tapped: false, faceDown: true },
        ],
        [
          { instanceId: 'mock-1g1', scryfallId: pick(5) },
          { instanceId: 'mock-1g2', scryfallId: pick(6) },
        ],
        [{ instanceId: 'mock-1e1', scryfallId: pick(7) }],
        [{ instanceId: 'mock-1c1', scryfallId: pick(9) }],
      ),
      mk(
        seatB,
        'Combo Carl',
        [{ instanceId: 'mock-2a', scryfallId: pick(2), x: 420, y: 360, tapped: false }],
        [{ instanceId: 'mock-2g1', scryfallId: pick(8) }],
        [],
        [],
        // Exercises the "reveal hand" chip/viewer path — a real revealed hand only ever comes from
        // the wire (see toPublicBoard's revealHand branch), so this hand-authored mock stands in
        // for a live opponent who's toggled it on.
        [
          { instanceId: 'mock-2h1', scryfallId: pick(3) },
          { instanceId: 'mock-2h2', scryfallId: pick(4) },
        ],
      ),
      mk(
        seatC,
        'Aggro Ana',
        [
          { instanceId: 'mock-3a', scryfallId: pick(3), x: 360, y: 340, tapped: false },
          { instanceId: 'mock-3b', scryfallId: pick(4), x: 700, y: 640, tapped: false, isToken: true },
        ],
        [],
        [],
        // Two commanders, to exercise the multi-commander (partner) nameplate display too.
        [
          { instanceId: 'mock-3c1', scryfallId: pick(10) },
          { instanceId: 'mock-3c2', scryfallId: pick(11) },
        ],
      ),
    ]
  }

  function togglePreviewPod() {
    if (mockBoards !== null) {
      setMockBoards(null)
      return
    }
    setMockBoards(buildMockBoards(mockMySeat))
  }

  /** DEV only: cycle which seat "I" occupy in the preview pod, regenerating the mock
   *  opponents into the other three seats — the fastest way to exercise per-seat rendering
   *  (e.g. the top-row view rotation) without a real second client. */
  function swapMockSeat() {
    const next = (((mockMySeat as number) + 1) % 4) as Seat
    setMockMySeat(next)
    if (mockBoards !== null) setMockBoards(buildMockBoards(next))
  }

  const snapshotFor = useCallback((scryfallId: string) => snapshots.get(scryfallId), [snapshots])

  // F: flip whatever's relevant under the cursor, matching real-table "flip that" talk —
  //  - a hovered battlefield card that's actually double-faced flips to its other face
  //    (dispatches the same FLIP_CARD the card's own right-click menu offers)
  //  - a hovered battlefield card that ISN'T double-faced instead turns face down/up, same as
  //    that card's own "Turn Face Down"/"Turn Face Up" context-menu action (SET_FACE_DOWN) —
  //    "flip" for an ordinary card means physically turning it over, not transforming it
  //  - otherwise, hovering the library pile flips its top card face-up/down (TOGGLE_REVEAL_TOP,
  //    same action as the Actions tray's Reveal/Hide Top Card button)
  // A specific hovered card (flippable or not) wins over the library fallback, same priority the
  // Delete-key handler above gives an explicit target over an implicit one. (Placed here, well
  // after battlefield/library/snapshotFor are declared, since the effect below closes over them
  // directly in its dependency array — not just inside the deferred keydown callback — so they
  // need to already exist by the time this line itself runs, not just by the time a key is
  // actually pressed.)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.key !== 'f' && event.key !== 'F') return
      if (hoveredInstanceId) {
        const hoveredCard = battlefield.find((c) => c.instanceId === hoveredInstanceId)
        const snapshot = hoveredCard ? snapshotFor(hoveredCard.scryfallId) : undefined
        if (hoveredCard && snapshot && isFlippableSnapshot(snapshot)) {
          event.preventDefault()
          dispatch({ type: 'FLIP_CARD', instanceId: hoveredInstanceId })
          return
        }
        if (hoveredCard) {
          event.preventDefault()
          dispatch({ type: 'SET_FACE_DOWN', instanceId: hoveredInstanceId, faceDown: !hoveredCard.faceDown })
          return
        }
        // Not one of ours — maybe it's a card someone relocated onto our own quadrant (a
        // "taken" card, same free-for-all as tapRemoteCard's onClick counterpart above):
        // still flippable from here, just routed to its real owner via a directed FLIP_CARD
        // instead of a local dispatch.
        if (!hoveredCard && inPod) {
          for (const board of opponentBoards) {
            const pc = board.battlefield.find((c) => c.instanceId === hoveredInstanceId)
            if (!pc) continue
            if (pc.atSeat !== undefined && pc.atSeat === mySeatResolved) {
              const remoteSnapshot = pc.faceDown ? undefined : snapshotFor(pc.scryfallId)
              if (remoteSnapshot && isFlippableSnapshot(remoteSnapshot)) {
                event.preventDefault()
                flipRemoteCard(board.playerId, pc.instanceId)
              }
            }
            return
          }
        }
      }
      if (libraryHovered && library.length > 0) {
        event.preventDefault()
        dispatch({ type: 'TOGGLE_REVEAL_TOP' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hoveredInstanceId, battlefield, libraryHovered, library, dispatch, snapshotFor, inPod, opponentBoards, mySeatResolved, flipRemoteCard])

  // R: shuffle the hovered library — the explicit replacement for the old shuffle-on-tutor-close
  // behavior (see closeViewer). Library only: it's the one zone whose order is hidden information;
  // graveyard/exile are public ordered piles where "shuffle" isn't a real Magic action.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.key !== 'r' && event.key !== 'R') return
      if (event.ctrlKey || event.metaKey) return // never eat the browser's own reload shortcut
      if (libraryHovered && library.length > 1) {
        event.preventDefault()
        shuffleLibrary()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // shuffleLibrary is a plain per-render function; library (which it closes over) standing in
    // for it here keeps the closure fresh without re-subscribing on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryHovered, library, dispatch])

  // Own-deck cosmetic foil lookup — GameCard doesn't carry it (see FoilKind's doc), so every
  // own-card render site looks it up here by printing. Never consulted for opponents' cards
  // (their foil choice is local to their own client and never sent over the wire).
  const foilByScryfallId = useMemo(() => {
    const map = new Map<string, FoilKind>()
    for (const c of deck.cards) if (c.foil) map.set(c.scryfallId, c.foil)
    return map
  }, [deck.cards])
  const foilFor = (scryfallId: string) => foilByScryfallId.get(scryfallId)
  const topOf = (cards: typeof graveyard) => (cards.length > 0 ? cards[cards.length - 1] : undefined)
  const graveyardTop = topOf(graveyard)
  const exileTop = topOf(exile)
  const commandTop = topOf(command)

  const trayActions: TrayAction[] = [
    { key: 'scry', label: 'Scry', icon: '🔮', onClick: (event) => setCountPrompt({ mode: 'scry', x: event.clientX, y: event.clientY }) },
    { key: 'surveil', label: 'Surveil', icon: '👀', onClick: (event) => setCountPrompt({ mode: 'surveil', x: event.clientX, y: event.clientY }) },
    { key: 'cascade', label: 'Cascade', icon: '🌊', onClick: (event) => setCountPrompt({ mode: 'cascade', x: event.clientX, y: event.clientY }) },
    {
      key: 'peek-top',
      label: 'Look at Top N',
      icon: '🔎',
      onClick: (event) => setCountPrompt({ mode: 'reveal', x: event.clientX, y: event.clientY }),
    },
    { key: 'tutor', label: 'Tutor', icon: '🔍', onClick: () => setViewerZone('library') },
    { key: 'tokens', label: 'Create Token', icon: '⭐', onClick: () => setTokenPickerOpen(true) },
    { key: 'dice', label: 'Roll Die', icon: '🎲', onClick: (event) => setCountPrompt({ mode: 'dice', x: event.clientX, y: event.clientY }) },
    { key: 'coin', label: 'Flip Coin', icon: '🪙', onClick: () => flipCoin() },
    {
      key: 'reveal-top',
      label: state.revealTopOfLibrary ? 'Hide Top Card' : 'Reveal Top Card',
      icon: state.revealTopOfLibrary ? '🙈' : '👁',
      onClick: () => dispatch({ type: 'TOGGLE_REVEAL_TOP' }),
    },
    {
      key: 'reveal-hand',
      label: state.revealHand ? 'Hide Hand' : 'Reveal Hand',
      icon: state.revealHand ? '🤜' : '🖐️',
      onClick: () => dispatch({ type: 'TOGGLE_REVEAL_HAND' }),
    },
    {
      key: 'bottom',
      label: 'View Bottom',
      icon: '📚',
      onClick: (event) => setCountPrompt({ mode: 'bottom', x: event.clientX, y: event.clientY }),
    },
    {
      key: 'shuffle',
      label: 'Shuffle Library',
      icon: '🔀',
      tutorialId: 'action-shuffle-library',
      onClick: () => {
        dispatch({ type: 'SHUFFLE_LIBRARY', shuffledOrder: shuffle(library.map((c) => c.instanceId)) })
        playCue('shuffle')
      },
    },
  ]

  // Resolves a bare playerId (all a wire message carries) to a display seat, for
  // color-coding rolls/pings — us via mySeatResolved (only meaningful in a pod —
  // it defaults to seat 0 in solo play, so null it there instead of miscoloring a
  // solo entry), or an opponent looked up in opponentBoards.
  function resolveRollerSeat(rollerId: string): Seat | null {
    if (rollerId === playerId) return inPod ? mySeatResolved : null
    return opponentBoards.find((b) => b.playerId === rollerId)?.seat ?? null
  }

  const rollLogEntries: RollLogEntry[] = rolls.map((entry) => ({
    id: entry.id,
    name: entry.name,
    roll: entry.roll,
    seat: resolveRollerSeat(entry.playerId),
  }))

  // Pings live in viewport space (constant marker size regardless of zoom) and use the same
  // corner-flip trick the old per-seat cluster positioning used to — anchor at a point, then
  // flip which way the box grows (via transform) so it renders on the correct side of that
  // point instead of straddling it. Player status itself is no longer table-anchored at all —
  // see .playtest__player-panel below, a single fixed sidebar that never moves with the camera.
  const pingMarkers = pings.map((p) => {
    const d = mirror(p.x, p.y)
    return {
      id: p.id,
      name: p.name,
      seat: resolveRollerSeat(p.playerId),
      style: { left: d.x * camera.zoom + camera.x, top: d.y * camera.zoom + camera.y },
    }
  })

  // Reactions render centered over the sender's own board quadrant rather than their sidebar
  // nameplate — same viewport-space projection as pingMarkers above, just anchored at that
  // seat's quadrant center (in solo play, with no occupied seat to anchor to, the reaction is
  // dropped rather than guessed onto some default corner).
  const reactionMarkers = reactions.flatMap((r) => {
    const seat = resolveRollerSeat(r.playerId)
    if (seat === null) return []
    const origin = seatOrigin(seat, CANVAS_W, CANVAS_H)
    const d = mirror(origin.x + CANVAS_W / 2, origin.y + CANVAS_H / 2)
    return [{ id: r.id, emoji: r.emoji, style: { left: d.x * camera.zoom + camera.x, top: d.y * camera.zoom + camera.y } }]
  })

  return (
    <div className="playtest" aria-label="Playtest">
      <div className="playtest__topbar">
        <span className="playtest__deck-name">{deck.name}</span>
        <span className="playtest__turn">Turn {state.turn}</span>
        {/* Whose turn it is, front and center in the topbar — not just the quadrant's gold glow
            (.playtest__quadrant.is-active-turn), which is easy to miss once you've panned/zoomed
            away from that seat. Same gold accent as that glow so "gold = whose turn" reads as one
            consistent visual language; `key={activeSeat}` remounts it on every turn pass so the
            pop-in animation actually replays instead of only firing once. */}
        {inPod && activeSeat !== null && (
          <span key={activeSeat} className="playtest__active-turn-badge" style={{ '--seat-color': SEAT_COLORS[activeSeat] } as CSSProperties}>
            <span className="playtest__seat-color-dot" />
            {activeSeat === mySeatResolved ? 'Your Turn' : `${seatNameBySeat.get(activeSeat) ?? `Seat ${activeSeat + 1}`}'s Turn`}
          </span>
        )}
        {inPod ? (
          <button
            type="button"
            onClick={handleRandomizeStart}
            disabled={spinSeat !== null}
            title="Spin to randomly pick who goes first."
          >
            {spinSeat !== null ? 'Spinning…' : 'Who Goes First?'}
          </button>
        ) : (
          <button type="button" onClick={() => dispatch({ type: 'NEXT_TURN' })}>
            Next Turn
          </button>
        )}
        <button
          type="button"
          onClick={handleMulligan}
          title="London mulligan: shuffle your hand into the library and draw a fresh 7. When you keep, put a number of cards equal to your mulligan count on the bottom yourself."
        >
          Mulligan{state.mulligans > 0 ? ` (${state.mulligans})` : ''}
        </button>
        <button type="button" onClick={handleRestart}>
          Restart
        </button>
        <button
          type="button"
          onClick={() => setDeckManagerOpen(true)}
          title="Pick a different deck without leaving Playtest — your own board restarts fresh; a live pod stays connected."
        >
          Switch Deck
        </button>
        {!inPod && (
          <button
            type="button"
            onClick={() => setGoldfishOn((prev) => !prev)}
            title="Goldfish practice stat: lands drawn vs. what your deck's land ratio predicts by this turn."
          >
            🎣 {goldfishOn ? 'Hide' : 'Show'} Goldfish Stats
          </button>
        )}
        {inPod && (
          <button type="button" onClick={fitAll} title="Fit the whole table in view (press 0 or F; 1–4 focus a seat)">
            Fit all
          </button>
        )}
        {inPod && (
          <button
            type="button"
            // Deliberately up here in the topbar rather than alongside Untap/Draw/Pass Turn in
            // the quickbar above the hand — a concede should never be one misclick away from the
            // buttons a player taps every turn.
            onClick={() => setConfirmScoopOpen(true)}
            disabled={isEliminated(mySeatResolved)}
            title={isEliminated(mySeatResolved) ? "You're already out." : 'Voluntarily concede — mark yourself eliminated for the rest of this game.'}
          >
            Scoop
          </button>
        )}
        {mpActive ? (
          <button
            type="button"
            className="playtest__mp-pill"
            data-tutorial-id="multiplayer-button"
            onClick={() => setMpModalOpen(true)}
            title="Multiplayer session — click for details"
          >
            <span className="playtest__mp-dot" />
            {mpRoomCode ?? 'Pod'} · {1 + boards.size}p
          </button>
        ) : (
          <button type="button" data-tutorial-id="multiplayer-button" onClick={() => setMpModalOpen(true)} title="Host or join a multiplayer pod">
            Multiplayer
          </button>
        )}
        {import.meta.env.DEV && !mpActive && (
          <button type="button" onClick={togglePreviewPod} title="DEV only: preview the shared table with mock opponents">
            {mockBoards !== null ? 'Exit pod preview' : 'Preview pod (dev)'}
          </button>
        )}
        {import.meta.env.DEV && mockBoards !== null && (
          <button
            type="button"
            onClick={swapMockSeat}
            title="DEV only: pretend to be a different seat, regenerating the mock opponents into the others — the fastest way to test per-seat rendering (e.g. the top-row view rotation) without a real second client"
          >
            Swap Seat ({SEAT_COLOR_NAMES[mockMySeat]})
          </button>
        )}
        <div className="playtest__spacer" />
        <button
          type="button"
          onClick={handleToggleWindowMode}
          disabled={inPod}
          title={
            inPod
              ? "Can't switch how Playtest opens while connected to a multiplayer pod — leaving now would disconnect you."
              : playtestWindowMode === 'window'
                ? 'Playtest opens in its own window — good for multiple monitors. Click to pop this game inline into this window instead.'
                : 'Playtest opens inline in this window — good for a single monitor. Click to pop this game out into its own window instead.'
          }
        >
          {playtestWindowMode === 'window' ? '🪟 Own Window' : '🖥️ Inline'}
        </button>
        <button
          type="button"
          onClick={() => {
            const idx = BATTLEFIELD_SKINS.findIndex((s) => s.id === battlefieldSkin)
            setBattlefieldSkin(BATTLEFIELD_SKINS[(idx + 1) % BATTLEFIELD_SKINS.length].id)
          }}
          title={`Playmat skin: ${BATTLEFIELD_SKINS.find((s) => s.id === battlefieldSkin)?.label} — click to try the next one (${BATTLEFIELD_SKINS.map((s) => s.label).join(', ')})`}
        >
          {BATTLEFIELD_SKINS.find((s) => s.id === battlefieldSkin)?.emoji} Playmat
        </button>
        <button
          type="button"
          onClick={() => setMuted((prev) => !prev)}
          title={muted ? 'Sound is off for this game — click to unmute (Settings has the permanent volume)' : 'Sound is on — click to mute for this game'}
          aria-label={muted ? 'Unmute sound' : 'Mute sound'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
          ⚙
        </button>
        <button
          type="button"
          data-tutorial-id="shortcuts-button"
          onClick={() => setShortcutsOpen(true)}
          title="Keyboard/mouse shortcuts (press ?)"
          aria-label="Shortcuts"
        >
          ❓
        </button>
        <button type="button" onClick={onClose}>
          Exit Playtest
        </button>
      </div>

      <div className="playtest__table">
        <div
          className="playtest__battlefield"
          ref={viewportRef}
          onDragOver={handleBattlefieldDragOver}
          onDragLeave={(event) => {
            // Only when the pointer actually leaves the battlefield (not just moving between
            // its own children, which also fire dragleave) — relatedTarget is null when it
            // leaves the window entirely, which should clear the ghost too.
            if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) {
              setDragPreview(null)
            }
          }}
          onDrop={handleBattlefieldDrop}
          onWheel={handleWheel}
        >
          {!inPod && battlefield.length === 0 && (
            <p className="playtest__battlefield-hint">Drag or click cards in your hand to play them.</p>
          )}
          {/* Parallax depth layers — fixed patterns whose background-position drifts at a
              fraction of the camera's own pan, so the void around the playmat reads as having
              real depth instead of being flat. Tiling backgrounds (not size-bound transforms)
              so they never run out of pattern no matter how far the camera pans. */}
          <div
            className="playtest__parallax playtest__parallax--far"
            style={{ backgroundPosition: `${camera.x * 0.08}px ${camera.y * 0.08}px` }}
          />
          <div
            className="playtest__parallax playtest__parallax--near"
            style={{ backgroundPosition: `${camera.x * 0.22}px ${camera.y * 0.22}px` }}
          />
          <div
            className="playtest__battlefield-surface"
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onContextMenu={handleCanvasContextMenu}
            title="Alt+click to ping this spot; right-click to create a token here"
            style={{
              width: surface.width,
              height: surface.height,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            }}
          >
            {/* Decorative playmat "skin" overlay(s) — see useBattlefieldSkin.ts. One layer per
                seat in a pod (each showing that player's own choice), or a single layer at the
                table's origin in solo play. Rendered first so they paint behind quadrant
                frames/cards (DOM-order stacking, no z-index needed). 'felt' renders nothing (the
                plain playmat look). */}
            {skinLayers.map((layer) => {
              const layerOrigin = mirror(layer.origin.x, layer.origin.y, CANVAS_W, CANVAS_H)
              const style = { left: layerOrigin.x, top: layerOrigin.y }
              // Glow points are quadrant-local (not offset by origin) — reflect them within
              // that local CANVAS_W×CANVAS_H frame too, same "reflect the box, reflect what's
              // inside it" split used for battlefield cards below.
              const points = viewRotated ? layer.points.map((p) => ({ ...p, x: CANVAS_W - p.x, y: CANVAS_H - p.y })) : layer.points
              if (layer.skin === 'triangles') {
                return <BattlefieldTriangleGrid key={layer.key} width={CANVAS_W} height={CANVAS_H} glowPoints={points} style={style} />
              }
              if (layer.skin === 'neonGlow') {
                return <BattlefieldNeonGlow key={layer.key} width={CANVAS_W} height={CANVAS_H} glowPoints={points} style={style} />
              }
              if (layer.skin === 'leyLines') {
                return <BattlefieldLeyLines key={layer.key} width={CANVAS_W} height={CANVAS_H} glowPoints={points} style={style} />
              }
              if (layer.skin === 'runicCircle') {
                return <BattlefieldRunicCircle key={layer.key} width={CANVAS_W} height={CANVAS_H} glowPoints={points} style={style} />
              }
              if (layer.skin === 'emberAura') {
                return (
                  <Fragment key={layer.key}>
                    <BattlefieldLavaGround width={CANVAS_W} height={CANVAS_H} style={style} />
                    <BattlefieldEmberAura width={CANVAS_W} height={CANVAS_H} glowPoints={points} style={style} />
                  </Fragment>
                )
              }
              if (layer.skin === 'prism') {
                return (
                  <div
                    key={layer.key}
                    className="playtest__skin-fx playtest__skin-fx--prism"
                    style={{ ...style, width: CANVAS_W, height: CANVAS_H }}
                    aria-hidden="true"
                  />
                )
              }
              return null
            })}
            {/* Seat quadrant frames (own seat highlighted). Non-interactive backdrop. */}
            {inPod &&
              ALL_SEATS.map((seat) => {
                const seatOrig = seatOrigin(seat, CANVAS_W, CANVAS_H)
                const o = mirror(seatOrig.x, seatOrig.y, CANVAS_W, CANVAS_H)
                return (
                  <div
                    key={`frame-${seat}`}
                    className={`playtest__quadrant ${seat === mySeatResolved ? 'is-self' : ''} ${seat === activeSeat ? 'is-active-turn' : ''} ${isEliminated(seat) ? 'is-eliminated' : ''}`}
                    style={{ left: o.x, top: o.y, width: CANVAS_W, height: CANVAS_H, '--seat-color': SEAT_COLORS[seat] } as CSSProperties}
                  />
                )
              })}

            {/* Opponents' battlefields — read-only mirrors, offset into their quadrants. Each
                card uses its OWN origin (atSeat, when another player has relocated it onto a
                different quadrant than this board's own seat) rather than always the board's,
                so a "move any card anywhere" drop actually renders where it was dropped. */}
            {inPod &&
              opponentBoards.flatMap((board) => {
                return board.battlefield.map((pc) => {
                  const displaySeat = pc.atSeat ?? board.seat
                  // ownerSeat only records a GIVE_CARD's original owner — for a card that's
                  // merely been relocated (never given), the true owner is whichever board's
                  // battlefield array it actually lives in (board.seat), same as displaySeat
                  // would be absent a relocate. Comparing against that instead of ownerSeat
                  // alone means a relocated-but-not-given card also gets ringed, not just a
                  // given one — a relocate is a visual move only, so the owner never stops
                  // being whoever's board this data lives on.
                  const trueOwnerSeat = pc.ownerSeat ?? board.seat
                  const origin = seatOrigin(displaySeat, CANVAS_W, CANVAS_H)
                  const foreign = displaySeat !== trueOwnerSeat
                  const pos = mirror(pc.x + origin.x, pc.y + origin.y, CARD_W_PX, CARD_H_PX)
                  return (
                  <div
                    key={`${board.playerId}-${pc.instanceId}`}
                    className={`playtest__battlefield-card ${foreign ? 'is-foreign' : ''} ${highlightedIds.has(pc.instanceId) ? 'is-highlighted' : ''}`}
                    style={{
                      left: pos.x,
                      top: pos.y,
                      ...(foreign ? { '--owner-color': SEAT_COLORS[trueOwnerSeat] } : {}),
                    } as CSSProperties}
                    onMouseEnter={() => setHoveredInstanceId(pc.instanceId)}
                    onMouseLeave={() => setHoveredInstanceId((cur) => (cur === pc.instanceId ? null : cur))}
                  >
                    <PlaytestCard
                      readOnly
                      remoteOwnerId={board.playerId}
                      hidden={pc.faceDown}
                      entering={enteringOpponentIds.has(pc.instanceId)}
                      onClick={(event) => {
                        if (event.altKey) {
                          sendHighlight(pc.instanceId)
                          return
                        }
                        // A card someone relocated ("gave a seat") onto MY quadrant should tap
                        // like anything else on my board, even though its state lives with its
                        // owner — send them a directed TAP_CARD; their STATE broadcast echoes
                        // the result back to the whole pod. Cards on anyone else's quadrant
                        // stay tap-inert from here: those remain their controller's business.
                        if (pc.atSeat !== undefined && pc.atSeat === mySeatResolved) {
                          tapRemoteCard(board.playerId, pc.instanceId, !pc.tapped)
                        }
                      }}
                      gameCard={{
                        instanceId: pc.instanceId,
                        scryfallId: pc.scryfallId,
                        zone: 'battlefield',
                        tapped: pc.tapped,
                        x: pc.x,
                        y: pc.y,
                        counters: pc.counters,
                        ptCounters: pc.ptCounters,
                        showBackFace: pc.showBackFace,
                        isToken: pc.isToken,
                        faceDown: pc.faceDown,
                      }}
                      snapshot={pc.faceDown ? undefined : snapshotFor(pc.scryfallId)}
                    />
                    {pc.isToken && <span className="playtest-card__token-badge" title="Token">T</span>}
                    <CounterPileStack
                      items={(pc.counters ?? []).map((p) => ({ id: p.id, color: p.color, text: formatSigned(p.value) }))}
                      side="left"
                    />
                    <CounterPileStack
                      items={(pc.ptCounters ?? []).map((p) => ({ id: p.id, color: p.color, text: formatPtCounters(p) }))}
                      side="right"
                    />
                  </div>
                  )
                })
              })}

            {/* Your own battlefield — interactive, offset into your quadrant. */}
            {battlefield.map((gameCard) => {
              // Same displaySeat-vs-trueOwnerSeat comparison as the opponent-board loop above —
              // a card of mine that got relocated (not given) onto someone else's quadrant should
              // still ring in my color, not just a card that was actually given away.
              const trueOwnerSeat = gameCard.ownerSeat ?? mySeatResolved
              const foreign = (gameCard.atSeat ?? mySeatResolved) !== trueOwnerSeat
              const isSelected = selectedIds.has(gameCard.instanceId)
              const groupOffsets =
                isSelected && selectedIds.size > 1
                  ? battlefield
                      .filter((c) => c.instanceId !== gameCard.instanceId && selectedIds.has(c.instanceId))
                      .map((c) => ({
                        instanceId: c.instanceId,
                        dx: (c.x ?? 0) - (gameCard.x ?? 0),
                        dy: (c.y ?? 0) - (gameCard.y ?? 0),
                      }))
                  : undefined
              // Usually myOrigin, unless another player dragged this card of ours onto a
              // different quadrant (gameCard.atSeat) — see RECEIVE_RELOCATED_CARD.
              const cardOrigin = gameCard.atSeat !== undefined ? seatOrigin(gameCard.atSeat, CANVAS_W, CANVAS_H) : myOrigin
              const pos = mirror((gameCard.x ?? 0) + cardOrigin.x, (gameCard.y ?? 0) + cardOrigin.y, CARD_W_PX, CARD_H_PX)
              return (
              <div
                key={gameCard.instanceId}
                className={`playtest__battlefield-card ${foreign ? 'is-foreign' : ''} ${highlightedIds.has(gameCard.instanceId) ? 'is-highlighted' : ''} ${counterDropTargetId === gameCard.instanceId ? 'is-counter-drop-target' : ''}`}
                style={{
                  left: pos.x,
                  top: pos.y,
                  ...(foreign ? { '--owner-color': SEAT_COLORS[trueOwnerSeat] } : {}),
                } as CSSProperties}
                onMouseEnter={() => setHoveredInstanceId(gameCard.instanceId)}
                onMouseLeave={() => setHoveredInstanceId((cur) => (cur === gameCard.instanceId ? null : cur))}
                onDragOver={(event) => {
                  if (isDraggingCounterPile(event)) event.preventDefault()
                }}
                onDragEnter={(event) => {
                  if (!isDraggingCounterPile(event)) return
                  setCounterDropTargetId(gameCard.instanceId)
                }}
                onDragLeave={(event) => {
                  if (!isDraggingCounterPile(event)) return
                  setCounterDropTargetId((cur) => (cur === gameCard.instanceId ? null : cur))
                }}
                onDrop={(event) => handleCounterPileDrop(event, gameCard.instanceId)}
              >
                <PlaytestCard
                  gameCard={gameCard}
                  snapshot={snapshotFor(gameCard.scryfallId)}
                  onClick={(event) => handleBattlefieldCardClick(gameCard, event)}
                  onContextMenu={(event) => setContextMenu({ instanceId: gameCard.instanceId, x: event.clientX, y: event.clientY })}
                  entering={enteringIds.has(gameCard.instanceId)}
                  selected={isSelected}
                  groupOffsets={groupOffsets}
                  foil={foilFor(gameCard.scryfallId)}
                />
                {gameCard.isToken && <span className="playtest-card__token-badge" title="Token">T</span>}
                <CounterPileStack
                  items={(gameCard.counters ?? []).map((p) => ({ id: p.id, color: p.color, text: formatSigned(p.value) }))}
                  side="left"
                  sourceInstanceId={gameCard.instanceId}
                  onAdjust={(pileId, delta) => dispatch({ type: 'ADJUST_COUNTER_PILE', instanceId: gameCard.instanceId, pileId, delta })}
                  onRemove={(pileId) => dispatch({ type: 'REMOVE_COUNTER_PILE', instanceId: gameCard.instanceId, pileId })}
                />
                <PtCounterPileStack
                  items={gameCard.ptCounters ?? []}
                  side="right"
                  sourceInstanceId={gameCard.instanceId}
                  onAdjust={(pileId, powerDelta, toughnessDelta) =>
                    dispatch({ type: 'ADJUST_PT_COUNTER_PILE', instanceId: gameCard.instanceId, pileId, powerDelta, toughnessDelta })
                  }
                  onRemove={(pileId) => dispatch({ type: 'REMOVE_PT_COUNTER_PILE', instanceId: gameCard.instanceId, pileId })}
                />
              </div>
              )
            })}
            {/* Eliminated-seat scrim — rendered after every card block so it sits visually on top
                (DOM order, not z-index) of that quadrant's cards, dimming the whole board at a
                glance without blocking interaction with it (pointer-events: none — an eliminated
                player's cards stay fully playable, only their own turn is skipped; see
                handlePassTurn/isEliminated above). */}
            {inPod &&
              ALL_SEATS.filter((seat) => isEliminated(seat)).map((seat) => {
                const seatOrig = seatOrigin(seat, CANVAS_W, CANVAS_H)
                const o = mirror(seatOrig.x, seatOrig.y, CANVAS_W, CANVAS_H)
                return (
                  <div
                    key={`eliminated-${seat}`}
                    className="playtest__quadrant-scrim"
                    style={{ left: o.x, top: o.y, width: CANVAS_W, height: CANVAS_H }}
                  >
                    <span className="playtest__quadrant-scrim-label">Eliminated</span>
                  </div>
                )
              })}
            {dragPreview?.map((p, i) => {
              const pos = mirror(p.x, p.y, CARD_W_PX, CARD_H_PX)
              return (
                <div
                  key={i}
                  className="playtest__drop-preview"
                  style={{ left: pos.x, top: pos.y, width: CARD_W_PX, height: CARD_H_PX }}
                />
              )
            })}
            {marquee && (() => {
              // Reflect each corner individually (as bare points), then re-derive the
              // min/width/height box from the reflected corners — width/height are actually
              // unaffected by a point reflection, but recomputing from the corners keeps this
              // correct without relying on that not being a coincidence.
              const c1 = mirror(marquee.x1, marquee.y1)
              const c2 = mirror(marquee.x2, marquee.y2)
              return (
                <div
                  className="playtest__marquee"
                  style={{
                    left: Math.min(c1.x, c2.x),
                    top: Math.min(c1.y, c2.y),
                    width: Math.abs(c2.x - c1.x),
                    height: Math.abs(c2.y - c1.y),
                  }}
                />
              )
            })()}
            {/* Table-space, not viewport-space — a child of the transformed surface (like
                cards) so a burst stays pinned to the table point it was spawned at rather
                than sliding on screen if the camera pans/zooms afterward. */}
            <BattlefieldParticles ref={particlesRef} width={surface.width} height={surface.height} />
          </div>
          {/* Fixed to the viewport (like .playtest__player-panel below), not table-space —
              deliberately off the playmat entirely rather than centered on it: table-space
              positioning put it at the mercy of wherever the camera happens to have the felt's
              edge on screen, which could land it off-screen in a short/cramped window. A shared
              object everyone in the pod sees the same station on, just presented as fixed UI
              chrome instead of a spatial object, since that's what's actually reliable across
              every camera state/viewport size. */}
          <TableRadio station={radioStation} onChangeStation={handleChangeRadioStation} />

          {/* Life / hand overlay: one static top-left panel (see .playtest__player-panel) for
              every seat, yours interactive — fixed to the screen, never anchored to the table,
              so it can't read as part of the battlefield no matter how the camera pans/zooms.
              Solo is just a pod of one: same card, no opponent cards listed below it. */}
          <div className="playtest__player-panel">
            <SeatOverlay
              seat={mySeatResolved}
              name={playerName}
              life={state.life}
              startingLife={state.startingLife}
              scooped={state.scooped}
              commanderSources={
                inPod
                  ? opponentBoards.map((b) => ({
                      seat: b.seat,
                      name: b.name,
                      damage: state.commanderDamage[b.seat] ?? 0,
                    }))
                  : undefined
              }
              soloCommanderDamage={
                inPod
                  ? undefined
                  : {
                      value: state.commanderDamage[SOLO_CMDR_SOURCE] ?? 0,
                      onChange: (delta) => dispatch({ type: 'ADJUST_COMMANDER_DAMAGE', fromSeat: SOLO_CMDR_SOURCE, delta }),
                    }
              }
              commanders={command.map((c) => ({
                scryfallId: c.scryfallId,
                name: snapshotFor(c.scryfallId)?.name ?? c.scryfallId,
                snapshot: snapshotFor(c.scryfallId),
              }))}
              poison={state.poison}
              showCommanderDamage={
                deck.format === 'commander' ||
                (inPod ? maxCommanderDamage(state.commanderDamage) > 0 : (state.commanderDamage[SOLO_CMDR_SOURCE] ?? 0) > 0)
              }
              handCount={hand.length}
              floatingMana={state.floatingMana}
              isSelf
              onFocus={() => centerOnSeat(mySeatResolved)}
              onLifeChange={(delta) => {
                dispatch({ type: 'ADJUST_LIFE', delta })
                playCue(delta > 0 ? 'life-up' : 'life-down')
              }}
              onCommanderDamageFrom={(fromSeat, delta) => dispatch({ type: 'ADJUST_COMMANDER_DAMAGE', fromSeat, delta })}
              onPoisonChange={(delta) => dispatch({ type: 'ADJUST_POISON', delta })}
              onFloatingManaChange={(color, delta) => dispatch({ type: 'ADJUST_FLOATING_MANA', color, delta })}
              onClearFloatingMana={() => dispatch({ type: 'CLEAR_FLOATING_MANA' })}
            />
            {inPod &&
              opponentBoards.map((board) => (
                <SeatOverlay
                  key={board.playerId}
                  seat={board.seat}
                  name={board.name}
                  life={board.life}
                  startingLife={board.startingLife}
                  scooped={board.scooped}
                  commanderSources={Object.entries(board.commanderDamage).map(([seatKey, damage]) => {
                    const srcSeat = Number(seatKey) as Seat
                    return { seat: srcSeat, name: seatNameBySeat.get(srcSeat) ?? `Seat ${srcSeat + 1}`, damage: damage ?? 0 }
                  })}
                  commanders={(board.command ?? []).map((c) => ({
                    scryfallId: c.scryfallId,
                    name: snapshotFor(c.scryfallId)?.name ?? c.scryfallId,
                    snapshot: snapshotFor(c.scryfallId),
                  }))}
                  poison={board.poison}
                  showCommanderDamage={deck.format === 'commander' || Object.keys(board.commanderDamage).length > 0}
                  handCount={board.handCount}
                  graveyardCount={board.graveyard?.length ?? 0}
                  exileCount={board.exile?.length ?? 0}
                  handRevealed={board.hand !== undefined}
                  floatingMana={board.floatingMana}
                  isSelf={false}
                  onFocus={() => centerOnSeat(board.seat)}
                  onViewZone={(zone) => setOppZoneView({ board, zone })}
                />
              ))}
          </div>
          {!inPod && goldfishOn && <GoldfishPanel turn={state.turn} rows={goldfishRows} />}
          <RollLog entries={rollLogEntries} />
          <DeckScanTray
            deck={deck}
            snapshots={snapshots}
            onSetMark={(scryfallId, mark) => deckDispatch({ type: 'SET_CARD_MARK', scryfallId, board: 'mainboard', mark })}
          />
          <TurnOrderTray />
          <button
            type="button"
            className="playtest__hand-sort-tab"
            disabled={hand.length < 2}
            title="Sort hand by mana value"
            onClick={() => {
              const sorted = [...hand].sort((a, b) => (snapshotFor(a.scryfallId)?.cmc ?? 0) - (snapshotFor(b.scryfallId)?.cmc ?? 0))
              dispatch({ type: 'REORDER_HAND', orderedInstanceIds: sorted.map((c) => c.instanceId) })
            }}
          >
            Sort by Cost
          </button>
          {pingMarkers.map((p) => (
            <PingMarker key={p.id} name={p.name} seat={p.seat} style={p.style} />
          ))}
          {reactionMarkers.map((r) => (
            <ReactionMarker key={r.id} emoji={r.emoji} style={r.style} />
          ))}
          {turnAnnouncement && (
            <div
              key={turnAnnouncement.key}
              className="playtest__turn-announce"
              style={{ '--seat-color': SEAT_COLORS[turnAnnouncement.seat] } as CSSProperties}
            >
              {turnAnnouncement.seat === mySeatResolved
                ? 'Your Turn'
                : `${seatNameBySeat.get(turnAnnouncement.seat) ?? `Seat ${turnAnnouncement.seat + 1}`}'s Turn`}
            </div>
          )}
          <div className="playtest__quickbar">
            <button type="button" className="playtest__quickbar-btn" onClick={() => dispatch({ type: 'UNTAP_ALL' })}>
              Untap
            </button>
            <button
              type="button"
              className="playtest__quickbar-btn"
              onClick={handleDraw}
              disabled={library.length === 0}
            >
              Draw
            </button>
            <ActionsTray
              actions={trayActions}
              forceOpen={tutorial.currentStep?.view === 'playtest' ? !!tutorial.currentStep.actionsTrayOpen : undefined}
            />
            {inPod && (
              <button
                type="button"
                className="playtest__quickbar-btn"
                onClick={handlePassTurn}
                disabled={!canPassTurn}
                title={
                  canPassTurn
                    ? 'Highlight whose turn it is for everyone at the table.'
                    : "It's not your turn."
                }
              >
                Pass Turn
              </button>
            )}
            {inPod && <ReactionsTray emojis={REACTION_EMOJIS} onSend={sendReaction} />}
          </div>
        </div>

        {confirmScoopOpen && (
          <ConfirmModal
            title="Scoop?"
            message="You'll be marked eliminated and skipped for the rest of this game. Your board stays visible and playable — this isn't a reset, just a concede."
            confirmLabel="Scoop"
            onConfirm={handleScoop}
            onCancel={() => setConfirmScoopOpen(false)}
          />
        )}

        {peekedLibraryCards.length > 0 && (
          <div className="library-peek-tray">
            <div className="library-peek-tray__header">
              <span>Looking at top {peekedLibraryCards.length}</span>
              <button type="button" onClick={() => setPeekedLibraryIds([])}>
                Put Away
              </button>
            </div>
            <div className="library-peek-tray__cards">
              {peekedLibraryCards.map((card) => (
                <div className="library-peek-tray__card" key={card.instanceId}>
                  <PlaytestCard readOnly draggableFromZone="library" gameCard={card} snapshot={snapshotFor(card.scryfallId)} foil={foilFor(card.scryfallId)} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="playtest__zones">
          <ZonePile
            label="Library"
            tutorialId="library-pile"
            count={library.length}
            onClick={library.length > 0 ? handleDraw : undefined}
            onContextMenu={library.length > 0 ? () => setViewerZone('library') : undefined}
            // Cards dragged in from hand (e.g. putting back mulligan discards) go to the bottom —
            // dropping them on top would hand the player free knowledge of their next draw.
            // Battlefield cards returned to the library (an explicit "put on top" effect) keep
            // going to the top, matching the same option already offered by that card's own
            // right-click menu.
            onDropCard={(data) => dropToZone('library', data.fromZone === 'hand' ? 'bottom' : 'top')(data)}
            onMouseEnter={() => setLibraryHovered(true)}
            onMouseLeave={() => setLibraryHovered(false)}
          >
            {library.length > 0 &&
              topOfLibrary &&
              (state.revealTopOfLibrary ? (
                <PlaytestCard
                  readOnly
                  draggableFromZone="library"
                  gameCard={topOfLibrary}
                  snapshot={snapshotFor(topOfLibrary.scryfallId)}
                  foil={foilFor(topOfLibrary.scryfallId)}
                />
              ) : (
                // Still draggable even face-down — you can pick up your top card blind and send
                // it to any zone (mill/impulse-style effects) without ever looking at it; only the
                // reveal-top toggle actually shows what it is. `hidden` keeps the card-back visual
                // identical to before this was made draggable.
                <PlaytestCard readOnly hidden draggableFromZone="library" gameCard={topOfLibrary} snapshot={snapshotFor(topOfLibrary.scryfallId)} />
              ))}
          </ZonePile>
          <ZonePile
            label="Graveyard"
            count={graveyard.length}
            onClick={() => setViewerZone('graveyard')}
            onDropCard={dropToZone('graveyard')}
          >
            {graveyardTop && (
              <PlaytestCard
                gameCard={graveyardTop}
                snapshot={snapshotFor(graveyardTop.scryfallId)}
                onClick={() => setViewerZone('graveyard')}
                foil={foilFor(graveyardTop.scryfallId)}
              />
            )}
          </ZonePile>
          <ZonePile label="Exile" count={exile.length} onClick={() => setViewerZone('exile')} onDropCard={dropToZone('exile')}>
            {exileTop && (
              <PlaytestCard
                gameCard={exileTop}
                snapshot={snapshotFor(exileTop.scryfallId)}
                onClick={() => setViewerZone('exile')}
                foil={foilFor(exileTop.scryfallId)}
              />
            )}
          </ZonePile>
          {(command.length > 0 || deck.format === 'commander') && (
            <ZonePile label="Command" count={command.length} onDropCard={dropToZone('command')}>
              {commandTop && (
                <PlaytestCard
                  gameCard={commandTop}
                  snapshot={snapshotFor(commandTop.scryfallId)}
                  onClick={() => playToBattlefield(commandTop.instanceId)}
                  foil={foilFor(commandTop.scryfallId)}
                />
              )}
            </ZonePile>
          )}
          {commanders.length > 0 && (
            <div className="playtest__commander-tax-row">
              {commanders.map((card, index) => {
                const name = snapshotFor(card.scryfallId)?.name
                const tax = card.commanderTax ?? 0
                const color = COMMANDER_TAX_COLORS[index % COMMANDER_TAX_COLORS.length]
                return (
                  <button
                    key={card.instanceId}
                    type="button"
                    className="playtest__commander-tax"
                    style={{ borderColor: color, color }}
                    onClick={() => dispatch({ type: 'ADJUST_COMMANDER_TAX', instanceId: card.instanceId, delta: 1 })}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      dispatch({ type: 'ADJUST_COMMANDER_TAX', instanceId: card.instanceId, delta: -1 })
                    }}
                    title={`Commander tax${name ? ` — ${name}` : ''}: left-click +1, right-click -1`}
                    aria-label={`Commander tax ${tax}${name ? ` for ${name}` : ''}`}
                  >
                    {tax}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div
        className="playtest__hand"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const data = getGameDragData(event)
          if (!data) return
          if (data.fromZone !== 'hand') {
            dispatch({ type: 'MOVE_CARD', instanceId: data.instanceId, toZone: 'hand' })
            return
          }
          // Reordering within the hand itself (distinct from playing a card in from elsewhere,
          // handled above) — insertion index comes from where the cursor sits relative to the
          // OTHER hand cards' midpoints (the dragged card's own element is excluded from that
          // comparison so its rect, mid-drag, can't skew where it lands).
          const draggedCard = hand.find((c) => c.instanceId === data.instanceId)
          if (!draggedCard) return
          const otherEls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.playtest__hand-card')).filter(
            (el) => el.dataset.instanceId !== data.instanceId,
          )
          let insertIndex = otherEls.length
          for (let i = 0; i < otherEls.length; i++) {
            const rect = otherEls[i].getBoundingClientRect()
            if (event.clientX < rect.left + rect.width / 2) {
              insertIndex = i
              break
            }
          }
          const withoutDragged = hand.filter((c) => c.instanceId !== data.instanceId)
          const reordered = [...withoutDragged.slice(0, insertIndex), draggedCard, ...withoutDragged.slice(insertIndex)]
          dispatch({ type: 'REORDER_HAND', orderedInstanceIds: reordered.map((c) => c.instanceId) })
        }}
      >
        <span className="playtest__hand-label">Hand ({hand.length})</span>
        <div className="playtest__hand-cards">
          {hand.map((gameCard, i) => {
            // Fan the cards around the row's center: rotate about each card's
            // bottom edge so the tops spread out and the bottoms stay together,
            // with the middle sitting slightly higher — like cards held in hand.
            const center = (hand.length - 1) / 2
            const offset = i - center
            const step = hand.length > 1 ? Math.min(4, 34 / (hand.length - 1)) : 0
            const maxOffset = center || 1
            const lift = -12 * (1 - (offset / maxOffset) ** 2)
            const fanStyle = {
              '--fan-angle': `${offset * step}deg`,
              '--fan-lift': `${lift}px`,
              zIndex: i,
            } as CSSProperties
            return (
              <div
                key={gameCard.instanceId}
                data-instance-id={gameCard.instanceId}
                className="playtest__hand-card"
                style={fanStyle}
                onMouseEnter={() => setHoveredInstanceId(gameCard.instanceId)}
                onMouseLeave={() => setHoveredInstanceId((cur) => (cur === gameCard.instanceId ? null : cur))}
              >
                <PlaytestCard
                  gameCard={gameCard}
                  snapshot={snapshotFor(gameCard.scryfallId)}
                  onClick={() => playToBattlefield(gameCard.instanceId)}
                  onContextMenu={(event) => setHandContextMenu({ instanceId: gameCard.instanceId, x: event.clientX, y: event.clientY })}
                  foil={foilFor(gameCard.scryfallId)}
                />
              </div>
            )
          })}
        </div>
      </div>

      {viewerZone && (
        <ZoneViewerModal
          label={viewerZone === 'graveyard' ? 'Graveyard' : viewerZone === 'library' ? 'Library' : 'Exile'}
          // Graveyard/exile read as a stack — most-recently-added on top, so the modal lists it
          // first (LIFO), matching topOf()'s existing single-card preview. Library is NOT
          // reversed: index 0 already *is* the top of the library (next card to draw), which is
          // already the correct top-to-bottom reading order — reversing it would show the bottom
          // of the library first instead.
          entries={(viewerZone === 'library' ? zoneCards(state, viewerZone) : zoneCards(state, viewerZone).reverse()).map((gameCard) => ({
            gameCard,
            snapshot: snapshotFor(gameCard.scryfallId),
            foil: foilFor(gameCard.scryfallId),
          }))}
          onMove={moveFromViewer}
          onClose={closeViewer}
          note={viewerZone === 'library' ? 'Searching your library means shuffling afterward — hover the library pile and press R.' : undefined}
          searchable={viewerZone === 'library'}
        />
      )}

      {bottomViewerCount !== null && (
        <ZoneViewerModal
          label={`Bottom ${bottomViewerCount} of Library`}
          entries={library
            .slice(-bottomViewerCount)
            .reverse()
            .map((gameCard) => ({ gameCard, snapshot: snapshotFor(gameCard.scryfallId), foil: foilFor(gameCard.scryfallId) }))}
          onMove={moveFromViewer}
          onClose={() => setBottomViewerCount(null)}
          note="No shuffle needed to close this — unlike the Tutor, looking at the bottom isn't a search effect."
        />
      )}

      {oppZoneView && (
        <ZoneViewerModal
          label={`${oppZoneView.board.name} — ${oppZoneView.zone === 'graveyard' ? 'Graveyard' : oppZoneView.zone === 'exile' ? 'Exile' : 'Hand'}`}
          // Graveyard/exile read as a stack (most-recently-added on top); a revealed hand has no
          // such ordering to preserve, so it's shown as-is instead of reversed.
          entries={(
            oppZoneView.zone === 'graveyard'
              ? (oppZoneView.board.graveyard ?? []).slice().reverse()
              : oppZoneView.zone === 'exile'
                ? (oppZoneView.board.exile ?? []).slice().reverse()
                : (oppZoneView.board.hand ?? [])
          ).map((pc) => ({
            gameCard: { instanceId: pc.instanceId, scryfallId: pc.scryfallId, zone: oppZoneView.zone, tapped: false, showBackFace: pc.showBackFace },
            snapshot: snapshotFor(pc.scryfallId),
          }))}
          onClose={() => setOppZoneView(null)}
          readOnly
        />
      )}

      {mpModalOpen && (
        <MultiplayerModal
          status={mpStatus}
          statusDetail={mpStatusDetail}
          role={mpRole}
          roomCode={mpRoomCode}
          mySeat={mySeat}
          myName={playerName}
          boards={[...boards.values()]}
          onHost={() => {
            mpHost().catch(() => {})
          }}
          onJoin={(code) => {
            mpJoin(code).catch(() => {})
          }}
          onLeave={mpLeave}
          onClose={() => setMpModalOpen(false)}
        />
      )}

      {contextMenu &&
        (() => {
          const gameCard = battlefield.find((c) => c.instanceId === contextMenu.instanceId)
          if (!gameCard) return null
          return (
            <CardContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              actions={battlefieldCardActions(gameCard)}
              onClose={() => setContextMenu(null)}
            />
          )
        })()}

      {handContextMenu &&
        (() => {
          const gameCard = hand.find((c) => c.instanceId === handContextMenu.instanceId)
          if (!gameCard) return null
          return (
            <CardContextMenu
              x={handContextMenu.x}
              y={handContextMenu.y}
              actions={handCardActions(gameCard)}
              onClose={() => setHandContextMenu(null)}
            />
          )
        })()}

      {countPrompt &&
        (() => {
          const mode = countPrompt.mode
          if (mode === 'cascade') {
            return (
              <NumberInputPrompt
                x={countPrompt.x}
                y={countPrompt.y}
                label="Mana value"
                onSubmit={startCascade}
                onClose={() => setCountPrompt(null)}
              />
            )
          }
          if (mode === 'dice') {
            return (
              <CardContextMenu
                x={countPrompt.x}
                y={countPrompt.y}
                actions={DIE_SIZES.map((sides) => ({ label: `d${sides}`, onSelect: () => rollDie(sides) }))}
                onClose={() => setCountPrompt(null)}
              />
            )
          }
          if (mode === 'bottom') {
            return (
              <CardContextMenu
                x={countPrompt.x}
                y={countPrompt.y}
                actions={SCRY_SURVEIL_COUNTS.map((count) => ({ label: `Bottom ${count}`, onSelect: () => openBottomViewer(count) }))}
                onClose={() => setCountPrompt(null)}
              />
            )
          }
          if (mode === 'reveal') {
            return (
              <CardContextMenu
                x={countPrompt.x}
                y={countPrompt.y}
                actions={SCRY_SURVEIL_COUNTS.map((count) => ({ label: `Look at top ${count}`, onSelect: () => startRevealTop(count) }))}
                onClose={() => setCountPrompt(null)}
              />
            )
          }
          return (
            <CardContextMenu
              x={countPrompt.x}
              y={countPrompt.y}
              actions={SCRY_SURVEIL_COUNTS.map((count) => ({
                label: `${mode === 'scry' ? 'Scry' : 'Surveil'} ${count}`,
                onSelect: () => startScryOrSurveil(mode, count),
              }))}
              onClose={() => setCountPrompt(null)}
            />
          )
        })()}

      {peek && (
        <LibraryPeekModal
          title={peek.title}
          note={peek.note}
          entries={peek.entries}
          shuffleBottom={peek.shuffleBottom}
          onConfirm={confirmPeek}
          onClose={() => setPeek(null)}
        />
      )}

      {tokenPickerOpen && (
        <TokenPickerModal
          tokens={deckTokens}
          onPick={(scryfallId) => {
            const { x, y } = tokenSpawnPoint ?? autoPosition()
            dispatch({ type: 'ADD_TOKEN', scryfallId, x, y })
            // The modal stays open for multiple picks — nudge the spawn point each time so a
            // right-click session's tokens fan out instead of stacking exactly on top of each other.
            if (tokenSpawnPoint) setTokenSpawnPoint(clampToCanvas(tokenSpawnPoint.x + 14, tokenSpawnPoint.y + 14))
          }}
          onClose={() => {
            setTokenPickerOpen(false)
            setTokenSpawnPoint(null)
          }}
        />
      )}

      {deckManagerOpen && <DeckManagerModal onClose={() => setDeckManagerOpen(false)} />}

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default PlaytestView
