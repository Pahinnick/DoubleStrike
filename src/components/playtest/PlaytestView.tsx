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
import { isDismissableLayerOpen, useEscapeToClose } from '../../hooks/useEscapeToClose'
import { usePlaytestWindowMode } from '../../hooks/usePlaytestWindowMode'
import { useProfileSettings } from '../../hooks/useProfileSettings'
import { notifyInfo, notifyWarning } from '../../notifications'
import { FACE_DOWN_SCRYFALL_ID, type CounterPile, type PtCounterPile, type PublicBoard, type RollResult, type Seat } from '../../net/protocol'
import { toPublicBoard } from '../../net/publicBoard'
import { useMultiplayer } from '../../net/useMultiplayer'
import { useDeck } from '../../state/DeckContext'
import { useProfiles } from '../../state/ProfileContext'
import {
  buildStartingCards,
  gameReducer,
  type GameState,
  type GameZone,
  isOwnCommander,
  maxCommanderDamage,
  shuffle,
  SOLO_CMDR_SOURCE,
  startingLifeFor,
  zoneCards,
} from '../../state/gameReducer'
import type { Deck, FoilKind } from '../../state/types'
import { isFlippableSnapshot } from '../../storage/cardCache'
import { getSoloGameSave, saveSoloGameSave } from '../../storage/soloGameStorage'
import { isPlaytestWindow, openDedicatedPlaytestWindow, requestSwitchToInlineAndClose } from '../../utils/playtestWindowBridge'
import { consumeAutoOpenMultiplayerRequest } from '../../utils/multiplayerEntryBridge'
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
import { COUNTER_COLORS, counterPileLabel, counterPileName, formatPtCounters, isKeywordCounter, KEYWORD_COUNTERS } from './counterFormat'
import CounterPileStack from './CounterPileStack'
import HandCardFan from './HandCardFan'
import DeckManagerModal from '../deck/DeckManagerModal'
import DeckScanTray from './DeckScanTray'
import TurnOrderTray from './TurnOrderTray'
import { buildDomSnapshot, copySnapshot, startInputRecording } from './debugSnapshot'
import { getCounterDragData, isDraggingCounterPile } from './dragCounterPile'
import { getCurrentDragData, getGameDragData, type DraggedGameCard } from './dragGameCard'
import GoldfishPanel, { type GoldfishRow } from './GoldfishPanel'
import LibraryPeekModal, { type PeekEntry, type PeekPlacement } from './LibraryPeekModal'
import MultiplayerModal from './MultiplayerModal'
import DiceRollPrompt from './DiceRollPrompt'
import NumberInputPrompt from './NumberInputPrompt'
import { createPanKeys } from './panKeys'
import PingMarker from './PingMarker'
import PlaytestCard from './PlaytestCard'
import { ALL_SEATS, buildSpinSequence, completesRound, nextActiveSeat, pickRandomSeat, SEAT_COLOR_NAMES, SEAT_COLORS, SEAT_GRID, seatOrigin, tableSize } from './podLayout'
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

/** The piles with a right-click action menu (see zoneActions). */
type PileZone = 'library' | 'graveyard' | 'exile'
const DIE_SIZES = [4, 6, 8, 10, 12, 20, 100]
// Newest-first cap on the shared roll log so it doesn't grow unbounded over a long session.
const ROLL_LOG_LIMIT = 8
// How long a single roll stays visible before it self-clears.
// How long a "look here" ping stays visible before it self-clears — brief, since it's
// meant as a momentary attention-grabber, not a log (rolls, by contrast, persist until
// dismissed — see addRollEntry).
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
// How long after joining (or rejoining) a pod the host's replay of whose turn it is can still
// arrive — see the turn-announcement effect.
const JOIN_CATCH_UP_MS = 1500
// Small fixed set of one-click pod reactions — pure fun, not meant to be exhaustive.
const REACTION_EMOJIS = ['👍', '😂', '😱', '😡', '🎉', '🤔']

// Must match the --game-card-width sizing in playtest.css: used to clamp drops
// so a card can't be placed hanging off the battlefield edge.
const CARD_W_PX = 90
const CARD_H_PX = 126

// The battlefield is a fixed-size virtual surface that the viewport pans/zooms
// over, rather than a viewport-sized area — see playtest backlog item #5 in
// HANDOFF.md. Card x/y are canvas-space pixels, not percentages. Sized so cards
// (~90px) aren't lost in dead space; a 2×2 pod tiles this into a 2160×1440 table.
// Originally 1680×1120, cut ~20% to 1344×896 per user feedback ("the playing
// space is a little too big"), then another ~20% to this — an experiment in
// how a noticeably tighter board feels, not yet settled as final.
const CANVAS_W = 1080
const CANVAS_H = 720
// Low enough that the whole 2160×1440 pod table fits the viewport ("see everyone
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

// Belt-and-suspenders re-broadcast interval — see its useEffect's doc for why this exists
// alongside the change-driven broadcast above. Frequent enough that a missed update (e.g. a
// stale "eliminated" mirror after a reconnect) self-heals within a game-relevant timeframe,
// infrequent enough to stay well clear of being meaningful bandwidth.
const BOARD_HEARTBEAT_MS = 15_000

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

/** The click half of flipping a double-faced card (F while hovering is the keyboard half). Its
 *  own small button rather than a click on the card itself, because a click on the card already
 *  means something everywhere it appears: tap on the battlefield, play from hand. Rendered as a
 *  sibling of the card inside the card's wrapper — the card is itself a <button>, and buttons
 *  can't nest. */
function FlipFaceButton({ showingBack, onFlip }: { showingBack: boolean; onFlip: () => void }) {
  return (
    <button
      type="button"
      className="playtest-card__flip-button"
      title={showingBack ? 'Flip to front (F)' : 'Flip to back (F)'}
      aria-label={showingBack ? 'Flip to front face' : 'Flip to back face'}
      // Not a drag handle and not a click on the table: keep both from starting underneath it.
      draggable={false}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onFlip()
      }}
    >
      ↻
    </button>
  )
}

/** Fallback for the F9 debug snapshot when the clipboard refuses it: the text on screen, focused
 *  and fully selected, so Ctrl+C copies it with no mouse involved. */
function DebugSnapshotPanel({ text, onClose }: { text: string; onClose: () => void }) {
  useEscapeToClose(onClose)
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Debug snapshot" onClick={onClose}>
      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <h2>Debug snapshot</h2>
        <p className="search-status">
          Couldn't copy this to the clipboard automatically. It's selected below — press Ctrl+C (Cmd+C on a Mac) to copy it, then Esc to close.
        </p>
        <textarea
          readOnly
          rows={12}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
          value={text}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
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
  // The last few actions, for the F9 debug snapshot (see debugSnapshot.ts). Type and target
  // only — never the payload, which for some actions is the entire game state.
  const recentActionsRef = useRef<{ at: number; source: 'local' | 'remote'; type: string; instanceId?: string; toZone?: string }[]>([])
  const noteAction = useCallback((source: 'local' | 'remote', action: Parameters<typeof rawDispatch>[0]) => {
    const detail = action as { instanceId?: string; toZone?: string }
    recentActionsRef.current.push({ at: Date.now(), source, type: action.type, instanceId: detail.instanceId?.slice(0, 8), toZone: detail.toZone })
    if (recentActionsRef.current.length > 30) recentActionsRef.current.shift()
  }, [])
  const dispatch = useCallback((action: Parameters<typeof rawDispatch>[0]) => {
    noteAction('local', action)
    const current = stateRef.current
    if (undoStackRef.current[undoStackRef.current.length - 1] !== current) {
      undoStackRef.current.push(current)
      if (undoStackRef.current.length > UNDO_HISTORY_LIMIT) undoStackRef.current.shift()
    }
    redoStackRef.current = []
    rawDispatch(action)
  }, [noteAction])
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
  /**
   * For changes this player didn't make and can't take back: a card arriving from or leaving
   * for another player, and another player tapping, flipping or moving one of our cards.
   *
   * Those are facts about the shared table, so they are applied to every snapshot in the undo
   * and redo history as well as to the live state, and are never recorded as an undo step of
   * our own. Going through the ordinary `dispatch` did the opposite on both counts. Undoing
   * after giving a card away brought it back here while the recipient kept it — the same card
   * on two boards. Undoing an unrelated move after receiving one restored a snapshot from before
   * it arrived, deleting it from the game. And Ctrl+Z after an opponent tapped our card undid
   * their tap rather than our own last action.
   */
  const dispatchExternal = useCallback((action: Parameters<typeof rawDispatch>[0]) => {
    noteAction('remote', action)
    undoStackRef.current = undoStackRef.current.map((snapshot) => gameReducer(snapshot, action))
    redoStackRef.current = redoStackRef.current.map((snapshot) => gameReducer(snapshot, action))
    rawDispatch(action)
  }, [noteAction])
  /** Drops all undo/redo history — for when the game it described is gone (a different deck, or
   *  a saved game loaded over the top). */
  const clearUndoHistory = useCallback(() => {
    undoStackRef.current = []
    redoStackRef.current = []
  }, [])

  // Network identity is a fresh per-session id, NOT the profile id: two tabs on
  // the same origin share IndexedDB (same profile), so reusing the profile id
  // would collide when testing locally and in the boards map. The profile only
  // supplies the display name.
  const playerIdRef = useRef<string>(crypto.randomUUID())
  const playerId = playerIdRef.current
  const isOnOwnBattlefield = (instanceId: string) =>
    stateRef.current.cards.some((c) => c.instanceId === instanceId && c.zone === 'battlefield')

  // Recent dice/coin rolls, newest first — resolved to a display seat at render
  // time (see rollLogEntries below) since a network roll only carries a playerId.
  //
  // Entries deliberately do NOT expire on a timer any more: a result somebody needed could
  // vanish mid-conversation, and "roll it again" isn't the same roll. They stay until whoever
  // made the roll takes it back (see dismissRoll), like leaving dice on the table until the
  // group's seen them. ROLL_LOG_LIMIT still bounds the list, so a table that never dismisses
  // anything just keeps the most recent few rather than growing forever.
  const [rolls, setRolls] = useState<{ id: string; playerId: string; name: string; roll: RollResult }[]>([])
  // `id` is the ROLLER's id, shared by every client mirroring the roll, so a dismissal can name
  // the same entry everywhere (see RollMessage.id). Falls back to a local one only for a roll
  // from an older peer that didn't send one — that entry simply can't be cleared remotely.
  const addRollEntry = useCallback((rollerId: string, name: string, roll: RollResult, id?: string) => {
    const entryId = id ?? crypto.randomUUID()
    setRolls((prev) =>
      // Guard against a duplicate delivery re-adding the same roll (the host self-emits its own
      // broadcasts, and a resync could in principle replay one).
      prev.some((e) => e.id === entryId) ? prev : [{ id: entryId, playerId: rollerId, name, roll }, ...prev].slice(0, ROLL_LOG_LIMIT),
    )
  }, [])
  const removeRollEntry = useCallback((id: string) => {
    setRolls((prev) => prev.filter((entry) => entry.id !== id))
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
    podTurn: mpPodTurn,
    podFirstSeat: mpPodFirstSeat,
    radioStation: mpRadioStation,
    broadcast,
    broadcastRoll,
    broadcastRollDismiss,
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
    returnRemoteCard,
    reclaimRemoteCard,
  } = useMultiplayer(
    {
      playerId,
      name: playerName,
      deckFormat: deck.format ?? 'casual',
    },
    // A card handed to us by another player joins our battlefield under our control.
    (card) => dispatchExternal({ type: 'RECEIVE_GIVEN_CARD', card }),
    // Another player's die/coin result, relayed to us — just log it, nothing to broadcast back.
    (rollerId, name, roll, id) => addRollEntry(rollerId, name, roll, id),
    // Another player's ping, relayed to us — just show it, nothing to broadcast back.
    (pingerId, name, x, y) => addPing(pingerId, name, x, y),
    // Another player repositioned one of our own cards — reposition it locally.
    (card) => dispatchExternal({ type: 'RECEIVE_RELOCATED_CARD', instanceId: card.instanceId, x: card.x, y: card.y, atSeat: card.atSeat }),
    // Another player tapped/untapped one of our own cards sitting on their board (a card they
    // took via relocate) — apply it locally; our next STATE broadcast shows everyone.
    (req) => dispatchExternal({ type: 'SET_TAPPED', instanceId: req.instanceId, tapped: req.tapped }),
    // Another player flipped one of our own cards sitting on their board (a card they took via
    // relocate) — apply it locally; our next STATE broadcast shows everyone.
    (req) => dispatchExternal({ type: 'FLIP_CARD', instanceId: req.instanceId }),
    // Another player sent one of our own cards sitting on their board (a card they took via
    // relocate) to the graveyard — apply it locally; our next STATE broadcast shows everyone.
    // Only while it is still in play: the sender acted on a mirror of our board that can be a
    // moment out of date, and a card we have since bounced or tucked is no longer theirs to move.
    (req) => {
      if (isOnOwnBattlefield(req.instanceId)) dispatchExternal({ type: 'MOVE_CARD', instanceId: req.instanceId, toZone: 'graveyard' })
    },
    // Another player's card flash-highlight, relayed to us — just show it, nothing to broadcast back.
    (instanceId) => addHighlight(instanceId),
    // Another player's emoji reaction, relayed to us — just show it, nothing to broadcast back.
    (reactorId, _name, emoji) => addReaction(reactorId, emoji),
    // Another player sent one of our own cards sitting on their board (given, or just taken via
    // relocate) back to one of our own zones — apply it locally; our next STATE broadcast shows everyone.
    (req) => {
      if (!isOnOwnBattlefield(req.instanceId)) return
      dispatchExternal({ type: 'MOVE_CARD', instanceId: req.instanceId, toZone: req.toZone, libraryPosition: req.libraryPosition })
    },
    // Whoever made a roll took it back — drop it from our copy of the log too.
    (id) => removeRollEntry(id),
    // A card's original owner wants it back off our board. Hand it over the same way any give
    // works, so the transfer itself goes through one already-proven path (see ReclaimCardMessage).
    (req) => {
      const card = stateRef.current.cards.find((c) => c.instanceId === req.instanceId && c.zone === 'battlefield')
      // Only a card we're holding for someone else can be reclaimed, and `ownerSeat` is exactly
      // what records that (a card of our own never has one). No owner recorded means this isn't
      // theirs to ask for, so there's nothing to hand back.
      if (!card || card.ownerSeat === undefined) return
      const sent = giveCard(req.fromPlayerId, {
        instanceId: card.instanceId,
        scryfallId: card.scryfallId,
        // Sending it home with its original owner's seat: on their client that equals their own
        // seat, so it renders as an ordinary card of theirs again rather than one still ringed
        // as somebody else's.
        ownerSeat: card.ownerSeat,
        x: card.x ?? 0,
        y: card.y ?? 0,
        tapped: card.tapped,
        counters: card.counters,
        ptCounters: card.ptCounters,
        showBackFace: card.showBackFace,
        isToken: card.isToken,
        faceDown: card.faceDown,
        isCommander: card.isCommander,
        commanderTax: card.commanderTax,
      })
      // Keep it if it couldn't be sent (mid-reconnect) — its owner can simply ask again.
      if (sent) dispatchExternal({ type: 'REMOVE_CARD', instanceId: card.instanceId })
    },
  )
  const [mpModalOpen, setMpModalOpen] = useState(false)
  // Honors the deck-editor header's "Multiplayer" button (see multiplayerEntryBridge) — jumps
  // straight to this modal on mount instead of requiring "Playtest" and "Multiplayer" as two
  // separate clicks. Runs once per mount, which is exactly once per "entered Playtest" — never
  // re-fires on e.g. a later solo-autosave resume within the same still-mounted session.
  useEffect(() => {
    if (consumeAutoOpenMultiplayerRequest()) setMpModalOpen(true)
  }, [])
  // The persisted per-profile volume (Settings page) applies globally via useProfileSettings'
  // own effect — this is just a session-local quick-mute on top of it (the topbar 🔊 button)
  // that deliberately does NOT persist: muting for one distracting game shouldn't silently
  // change the permanent volume preference. Cleanup un-mutes on exit so leaving Playtest can't
  // leave sound.ts stuck muted for the search/deck-list screens.
  const { goldfishStatsDefault, handDrawSide } = useProfileSettings()
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
    // mpStatus is a dependency so that finishing a reconnect sends our board straight away. The
    // host forgets a dropped guest's board, and nothing else here changes across a rejoin, so
    // the returning player used to stay invisible — and skipped by Pass Turn — until their
    // next move or the next heartbeat.
  }, [state, mySeat, mpActive, mpStatus, broadcast, playerId, playerName, battlefieldSkin])

  // Also re-broadcast on a plain interval, regardless of whether our own state actually
  // changed. The wire protocol is meant to be "self-healing after a dropped packet" (every
  // STATE is a full snapshot — see protocol.ts's doc), but nothing was actually re-sending one
  // if a relayed message got silently dropped (see peerConnection's sendTo) — a peer could then
  // stay stuck on a stale mirror (e.g. showing someone as eliminated from an old life<=0
  // snapshot, wrongly, after they reconnected fine) until *their* own game state happened to
  // change again. This closes that gap without needing to know it happened.
  //
  // The latest state is read through a ref so it isn't an effect dependency: including it would
  // tear down and recreate the interval on every single game change, restarting the timer each
  // time — which is precisely backwards, since the case this exists to cover is a player whose
  // state ISN'T changing.
  const heartbeatStateRef = useRef(state)
  heartbeatStateRef.current = state
  useEffect(() => {
    if (!mpActive || mySeat === null) return
    const handle = window.setInterval(() => {
      broadcast(toPublicBoard(heartbeatStateRef.current, { playerId, name: playerName, seat: mySeat, battlefieldSkin }))
    }, BOARD_HEARTBEAT_MS)
    return () => window.clearInterval(handle)
  }, [mpActive, mySeat, broadcast, playerId, playerName, battlefieldSkin])

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
  // Dev-preview counterpart to the pod's shared turn number, same duality as mockActiveSeat.
  const [mockPodTurn, setMockPodTurn] = useState<number | null>(null)
  const [mockFirstSeat, setMockFirstSeat] = useState<Seat | null>(null)
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

  // Autosave this deck's own board — your own cards/life/etc., never anyone else's — regardless
  // of solo vs. pod: only the *room membership itself* (reconnect/host-migration) is still out of
  // scope (see multiplayer-vtt-spike memory), not your own board's continuity. So getting
  // disconnected from a pod (or just closing the app mid-game) and later rejoining the same room
  // resumes your side of the table exactly where you left it, the same way a plain solo relaunch
  // already did — you just have to type the room code again; nothing about the connection itself
  // is remembered. Mirrors the broadcast effect's debounce-on-every-settled-change shape above.
  //
  // `persistedStateRef` is the state as it last came from, or went to, storage. A state equal to
  // it has nothing to save — which keeps the freshly shuffled game Playtest opens with from
  // being written over a saved one before the resume below has had its say.
  const persistedStateRef = useRef(state)
  // Which version of which deck that save is stamped with. A save only resumes while its stamp
  // still matches the deck (see SoloGameSave.deckUpdatedAt), and the deck's stamp moves without
  // the board changing — marking a card in the tray, renaming the deck from Switch Deck, another
  // window saving it. The save has to be re-stamped then, or the game it holds is thrown away
  // on the next launch as "built from an older decklist".
  const persistedDeckStampRef = useRef({ deckId: deck.id, updatedAt: deck.updatedAt })
  const autosaveDeckRef = useRef(deck)
  autosaveDeckRef.current = deck
  const persistGame = useCallback((toSave: GameState) => {
    const current = autosaveDeckRef.current
    persistedStateRef.current = toSave
    persistedDeckStampRef.current = { deckId: current.id, updatedAt: current.updatedAt }
    void saveSoloGameSave(current.id, { state: toSave, deckUpdatedAt: current.updatedAt }).catch((err: unknown) =>
      console.error('[playtest] failed to autosave the game', err),
    )
  }, [])
  // Only a newer stamp on the SAME deck counts: after a deck switch the board on screen is still
  // the previous deck's until the effect further down deals the new one.
  const isSaveStampStale = (current: { id: string; updatedAt: string }) =>
    persistedDeckStampRef.current.deckId === current.id && persistedDeckStampRef.current.updatedAt !== current.updatedAt
  useEffect(() => {
    if (state === persistedStateRef.current && !isSaveStampStale({ id: deck.id, updatedAt: deck.updatedAt })) return
    const handle = window.setTimeout(() => persistGame(state), SOLO_AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [state, deck.id, deck.updatedAt, persistGame])
  // Leaving Playtest inside the debounce window used to cancel the pending save outright, so
  // the last action before Exit never reached storage. Write it on the way out instead.
  useEffect(() => {
    const flush = () => {
      if (stateRef.current !== persistedStateRef.current || isSaveStampStale(autosaveDeckRef.current)) persistGame(stateRef.current)
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [persistGame])

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
    persistedStateRef.current = state
    persistedDeckStampRef.current = { deckId: deck.id, updatedAt: deck.updatedAt }
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
  // A card parked on another player's quadrant (GameCard.atSeat) only means something while that
  // quadrant exists. Out of a pod — the session ended, or a pod game was resumed solo — it was
  // still drawn a whole quadrant off the playmat and skipped by Untap, since the untap step
  // leaves cards on other seats to whoever controls them. Bring those home; likewise any parked
  // on what has since become our own seat.
  const needsSeatNormalizing = state.cards.some((c) => c.atSeat !== undefined && (!inPod || c.atSeat === mySeatResolved))
  useEffect(() => {
    if (needsSeatNormalizing) dispatchExternal({ type: 'NORMALIZE_SEATS', ownSeat: inPod ? mySeatResolved : null })
  }, [needsSeatNormalizing, inPod, mySeatResolved, dispatchExternal])
  // Eliminated: 0 life or below (real Commander rules), OR a voluntary Scoop — either one is the
  // same "out" state everywhere it's checked (turn rotation, quadrant scrim, nameplate badge), per
  // [[mtg-deckbuilder-vtt-auto-skip-eliminated]] and [[mtg-deckbuilder-vtt-scoop]].
  const lifeBySeat = new Map<Seat, number>([[mySeatResolved, state.life], ...opponentBoards.map((b) => [b.seat, b.life] as const)])
  const scoopedBySeat = new Map<Seat, boolean>([
    [mySeatResolved, state.scooped],
    ...opponentBoards.map((b) => [b.seat, !!b.scooped] as const),
  ])
  // Occupancy is checked FIRST, and it's the whole reason this isn't just the life/scoop test:
  // lifeBySeat only has entries for seats we actually have a board for, so every other seat fell
  // through the `?? 0` fallback and read as "0 life" — i.e. eliminated. An empty seat therefore
  // rendered an "Eliminated" scrim over its quadrant and an eliminated-styled nameplate, while
  // the label right next to it still said "Open". The same fallback also mislabelled a player
  // whose board mirror was merely missing for a moment (dropped, or mid-reconnect) as dead
  // rather than absent — the exact shape of the desync that made a reconnecting player look
  // eliminated to some of the pod but not others.
  const isEliminated = (seat: Seat) =>
    lifeBySeat.has(seat) && ((lifeBySeat.get(seat) ?? 0) <= 0 || scoopedBySeat.get(seat) === true)
  // Every seat's name, keyed by seat — needed to label an opponent's incoming commander-damage
  // pills (see the SeatOverlay calls below): a source dealing damage to opponent B could be us
  // or any other opponent C, not just whoever's card we're currently rendering.
  const seatNameBySeat = new Map<Seat, string>([[mySeatResolved, playerName], ...opponentBoards.map((b) => [b.seat, b.name] as const)])
  const activeSeat: Seat | null = spinSeat ?? (mockBoards !== null ? mockActiveSeat : mpActiveSeat)
  const podTurn: number | null = mockBoards !== null ? mockPodTurn : mpPodTurn
  const podFirstSeat: Seat | null = mockBoards !== null ? mockFirstSeat : mpPodFirstSeat

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
  // When this client last became a live member of the pod. The host replays whose turn it is in
  // a separate message just after accepting us, so the first seat this effect sees after a join
  // or a reconnect is null and the replay then looks exactly like a real pass. Anything inside
  // this short window after going live is catching up, not a turn changing hands.
  const podLive = mockBoards !== null || mpStatus === 'connected'
  const podLiveSinceRef = useRef<number | null>(null)
  useEffect(() => {
    podLiveSinceRef.current = podLive ? Date.now() : null
  }, [podLive])
  useEffect(() => {
    if (!inPod) return
    const prev = prevSyncedActiveSeatRef.current
    prevSyncedActiveSeatRef.current = syncedActiveSeat
    const catchingUp =
      mockBoards === null && (podLiveSinceRef.current === null || Date.now() - podLiveSinceRef.current < JOIN_CATCH_UP_MS)
    if (prev === undefined || catchingUp || syncedActiveSeat === null || syncedActiveSeat === prev) return
    setTurnAnnouncement({ seat: syncedActiveSeat, key: crypto.randomUUID() })
    if (turnAnnounceTimeoutRef.current) window.clearTimeout(turnAnnounceTimeoutRef.current)
    turnAnnounceTimeoutRef.current = window.setTimeout(() => setTurnAnnouncement(null), TURN_ANNOUNCE_TTL_MS)
    // A distinct cue for "it's YOUR turn now" vs. just "the turn moved on" — the former is meant
    // to actually grab your attention if you've looked away, the latter is only ambient feedback.
    playCue(syncedActiveSeat === mySeatResolved ? 'your-turn' : 'turn-passed')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mockBoards only gates the catch-up check
  }, [inPod, syncedActiveSeat, mySeatResolved])
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
    // The shared counter ticks over once the rotation comes back round to whoever took the
    // first turn — a full round of the table, which is the only "turn number" that means the
    // same thing to everyone (GameState.turn counts just our own turns). With nobody active yet
    // this pass IS the start of the game: turn 1, and the seat it lands on went first.
    const startsGame = activeSeat === null
    const firstSeat = startsGame ? next : podFirstSeat
    const nextTurn = startsGame ? 1 : (podTurn ?? 1) + (completesRound(activeSeat, living, firstSeat) ? 1 : 0)
    if (mockBoards !== null) {
      setMockActiveSeat(next)
      setMockPodTurn(nextTurn)
      setMockFirstSeat(firstSeat)
    } else if (mpActive) {
      broadcastTurnPass(next, nextTurn, firstSeat ?? undefined)
    }
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
          // Picking who goes first starts a game: back to turn 1, measured from this seat. The
          // counter used to carry straight on from the previous game's number.
          if (mockBoards !== null) {
            setMockActiveSeat(seat)
            setMockPodTurn(1)
            setMockFirstSeat(seat)
          } else if (mpActive) broadcastTurnPass(seat, 1, seat)
          setSpinSeat(null)
        }
      }, cumulative)
      spinTimers.current.push(timer)
    })
  }

  const [viewerZone, setViewerZone] = useState<'graveyard' | 'exile' | 'library' | null>(null)
  // Read-only view of an opponent's public zone (graveyard/exile) in a pod.
  // Holds WHOSE zone is open, not a copy of their board: the viewer then follows that board as it
  // changes. A captured board never updated — and kept a revealed hand readable after its owner
  // had stopped sharing it.
  const [oppZoneView, setOppZoneView] = useState<{ playerId: string; zone: 'graveyard' | 'exile' | 'hand' } | null>(null)
  const oppZoneBoard = oppZoneView ? opponentBoards.find((b) => b.playerId === oppZoneView.playerId) : undefined
  const oppZoneGone = oppZoneView !== null && (!oppZoneBoard || (oppZoneView.zone === 'hand' && !oppZoneBoard.hand))
  useEffect(() => {
    if (oppZoneGone) setOppZoneView(null)
  }, [oppZoneGone])
  const [contextMenu, setContextMenu] = useState<{ instanceId: string; x: number; y: number } | null>(null)
  // Separate from `contextMenu` above (which looks its card up in `battlefield`) since this one
  // looks its card up in `hand` instead — see handCardActions.
  const [handContextMenu, setHandContextMenu] = useState<{ instanceId: string; x: number; y: number } | null>(null)
  // The Roll Die prompt; every count-asking zone action uses zoneCountAsk instead.
  const [countPrompt, setCountPrompt] = useState<{ mode: 'dice'; x: number; y: number } | null>(null)
  /** A zone pile's right-click menu (see zoneActions), open at the click. */
  const [zoneMenu, setZoneMenu] = useState<{ zone: PileZone; x: number; y: number } | null>(null)
  /** The "how many?" box an X action from a zone menu opens; `run` gets the number typed. */
  const [zoneCountAsk, setZoneCountAsk] = useState<{ label: string; x: number; y: number; run: (count: number) => void } | null>(null)
  /** Set while the graveyard viewer is open for Dredge N: sending a card to hand from it also
   *  mills the top N of the library (see moveFromViewer). */
  const [dredgeCount, setDredgeCount] = useState<number | null>(null)
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
  // A card that changes zone is re-rendered somewhere else, and the element the cursor was over
  // just disappears — no mouseleave fires for it. So "hovered" kept naming the card after it
  // had moved: play a card from hand, press Delete over empty table, and the card you had just
  // played went to the graveyard. The same goes for the selection, which is battlefield-only.
  const hoveredZoneRef = useRef<GameZone | null>(null)
  useEffect(() => {
    hoveredZoneRef.current = hoveredInstanceId
      ? (stateRef.current.cards.find((c) => c.instanceId === hoveredInstanceId)?.zone ?? null)
      : null
  }, [hoveredInstanceId])
  useEffect(() => {
    if (hoveredInstanceId) {
      const card = state.cards.find((c) => c.instanceId === hoveredInstanceId)
      if (card && hoveredZoneRef.current !== null && card.zone !== hoveredZoneRef.current) setHoveredInstanceId(null)
    }
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev
      const inPlay = new Set(state.cards.filter((c) => c.zone === 'battlefield').map((c) => c.instanceId))
      const kept = [...prev].filter((id) => inPlay.has(id))
      return kept.length === prev.size ? prev : new Set(kept)
    })
  }, [state.cards, hoveredInstanceId])
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
  // Last raw mouse position seen during an active drag-pan, NOT a snapshot of camera itself (see
  // handleCanvasMouseDown's onMove) — panning applies each move's incremental delta on top of
  // whatever the current camera happens to be via a functional setCamera update, rather than
  // recomputing from a fixed "camera as of mousedown" baseline. A fixed baseline used to mean any
  // OTHER camera change landing mid-drag (a center-on-seat, a hotkey, anything) got silently
  // stomped by the next mousemove snapping back to start-camera-plus-delta, discarding it.
  const panState = useRef<{ lastX: number; lastY: number } | null>(null)
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
      // Not undoable, and the history goes with it: every snapshot on the stack is a board of
      // the PREVIOUS deck. Left in place, Ctrl+Z after a switch put that deck's cards back on
      // the table under this one's name, and autosave then stored them as this deck's game.
      clearUndoHistory()
      rawDispatch({ type: 'START_GAME', cards: buildStartingCards(deck), startingLife: startingLifeFor(deck) })
      setSelectedIds(new Set())
      centerCamera()
    }
    // Resume this deck's autosaved board, if one exists and the decklist hasn't changed since it
    // was saved (see SoloGameSave.deckUpdatedAt) — replaces whatever fresh/switched-to state was
    // just set above. Whatever the save happened to be mid-pod or solo makes no difference here:
    // it's still just "this deck's board, last as you left it" — never gated on inPod because
    // this only ever runs at mount or right after a deck switch, before a pod (if any) is
    // rejoined by explicit choice (see the autosave effect above for what actually gets saved).
    const attempt = ++resumeAttemptRef.current
    getSoloGameSave(deck.id).then((saved) => {
      if (resumeAttemptRef.current !== attempt || !saved || saved.deckUpdatedAt !== deck.updatedAt) return
      // Loading the saved game is where this session starts, not a step to undo back past — one
      // Ctrl+Z used to swap the resumed game for the throwaway shuffle that was on screen for
      // an instant before it, and autosave then overwrote the save with that.
      clearUndoHistory()
      const resumed = gameReducer(stateRef.current, { type: 'RESTORE_STATE', state: saved.state })
      persistedStateRef.current = resumed
      persistedDeckStampRef.current = { deckId: deck.id, updatedAt: saved.deckUpdatedAt }
      rawDispatch({ type: 'RESTORE_STATE', state: resumed })
    })
    // deck.id is the trigger (see lastDeckIdRef); the rest of `deck` is read as of that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id, centerCamera, clearUndoHistory])

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
  // read it would be wasteful; setCamera is the only piece that actually needs to be state.
  useEffect(() => {
    const PAN_SPEED = 700 // px/sec at zoom 1; divided by zoom below so it feels the same zoomed in/out
    const heldKeys = createPanKeys()
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
      const dirs = heldKeys.directions()
      setCamera((prev) => {
        const distance = (PAN_SPEED / prev.zoom) * dt
        let dx = 0
        let dy = 0
        if (dirs.has('w')) dy += distance
        if (dirs.has('s')) dy -= distance
        if (dirs.has('a')) dx += distance
        if (dirs.has('d')) dx -= distance
        return dx === 0 && dy === 0 ? prev : { ...prev, x: prev.x + dx, y: prev.y + dy }
      })
    }
    rafId = requestAnimationFrame(tick)

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      // A fresh press, not an OS auto-repeat re-firing the same key: cancel any in-flight
      // animateCameraTo glide (center-on-seat, fit-all) the moment manual panning starts, same
      // as a mouse-drag pan already does — otherwise the two fight over camera state.
      if (heldKeys.press(event)) cancelCameraAnim()
    }
    function onKeyUp(event: KeyboardEvent) {
      heldKeys.release(event)
    }
    // Alt-tabbing away (or anything else that steals focus) mid-hold never fires keyup, which
    // would otherwise pan forever in one direction — the classic "stuck key" bug. A
    // modifier-held pointerdown is the same story from the other end: it catches an Alt+click
    // even in the case where the Alt keydown itself never reached us.
    function onBlur() {
      heldKeys.clear()
    }
    function onPointerDown(event: PointerEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) heldKeys.clear()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('visibilitychange', onBlur)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('visibilitychange', onBlur)
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
      for (const c of board.commanders ?? []) if (c.scryfallId !== FACE_DOWN_SCRYFALL_ID) ids.add(c.scryfallId)
      for (const c of board.hand ?? []) ids.add(c.scryfallId)
      // A revealed top-of-library card is one they've deliberately made public — without this
      // its chip would render as a nameless fallback initial, since nothing else would ever
      // fetch that id.
      if (board.topOfLibrary) ids.add(board.topOfLibrary.scryfallId)
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
  // Whether the hand fan is too wide for its row to show every card at once — see
  // .playtest__hand-cards.is-overflowing's doc for why this is a class toggle rather than a
  // permanently-scrollable row. Rechecked whenever the hand's own size changes (a card
  // played/drawn/discarded) and on window resize, since either can flip it either way.
  const handRowRef = useRef<HTMLDivElement>(null)
  const [handOverflowing, setHandOverflowing] = useState(false)
  useEffect(() => {
    const el = handRowRef.current
    if (!el) return
    function checkOverflow() {
      // +1px fuzz: subpixel layout rounding can make an exactly-fitting row compare as "1px over."
      setHandOverflowing(el!.scrollWidth > el!.clientWidth + 1)
    }
    checkOverflow()
    window.addEventListener('resize', checkOverflow)
    return () => window.removeEventListener('resize', checkOverflow)
  }, [hand.length])
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
  // Only our own: a commander we are holding for another player keeps its flag for the trip home
  // (see GameCard.isCommander) but its tax is theirs to track, not ours.
  const commanders = state.cards.filter((c) => isOwnCommander(c, mySeatResolved))
  /** Whether a card has a second face to turn to (transform, modal double-faced, flip…). */
  const isFlippable = (scryfallId: string) => {
    const snapshot = snapshotFor(scryfallId)
    return snapshot !== undefined && isFlippableSnapshot(snapshot)
  }

  function clampToCanvas(x: number, y: number): { x: number; y: number } {
    return {
      x: Math.min(Math.max(x, 0), CANVAS_W - CARD_W_PX),
      y: Math.min(Math.max(y, 0), CANVAS_H - CARD_H_PX),
    }
  }

  /** Staggered fill for cards played without an explicit drop point, with the
   *  row block centered horizontally on the canvas so early cards land near the
   *  middle of the view rather than off toward an edge. */
  /** `taken`: spots already handed out in this same batch (playing several cards at once), which
   *  the battlefield doesn't show yet because nothing has re-rendered between the dispatches. */
  function autoPosition(taken: { x: number; y: number }[] = []): { x: number; y: number } {
    const cols = 6
    const stepX = CARD_W_PX + 14
    const blockW = cols * stepX
    const slot = (n: number) =>
      clampToCanvas((CANVAS_W - blockW) / 2 + (n % cols) * stepX, CANVAS_H / 2 - 220 + Math.floor(n / cols) * (CARD_H_PX + 20))
    // The first slot nothing is sitting on, not slot number battlefield.length: once any card
    // had left play that count pointed at a slot still in use, and the new card landed exactly
    // on top of the one already there, hiding it completely.
    const inOwnQuadrant = battlefield.filter((c) => c.atSeat === undefined)
    const isFree = (p: { x: number; y: number }) =>
      !inOwnQuadrant.some((c) => Math.abs((c.x ?? 0) - p.x) < 12 && Math.abs((c.y ?? 0) - p.y) < 12) &&
      !taken.some((t) => Math.abs(t.x - p.x) < 12 && Math.abs(t.y - p.y) < 12)
    const slotCount = cols * 6
    for (let n = 0; n < slotCount; n++) {
      const candidate = slot(n)
      if (isFree(candidate)) return candidate
    }
    // Every slot is taken: step off the last one so the new card at least shows.
    const last = slot(battlefield.length % slotCount)
    const overflow = battlefield.length % 6
    return clampToCanvas(last.x + 18 + overflow * 6, last.y + 18 + overflow * 6)
  }

  function playToBattlefield(instanceId: string) {
    const { x, y } = autoPosition()
    dispatch({ type: 'MOVE_CARD', instanceId, toZone: 'battlefield', x, y })
    playCue('play-card')
  }

  /** Plays several hand cards at once, each to its own free spot, and drops the selection. */
  function playManyToBattlefield(instanceIds: string[]) {
    const taken: { x: number; y: number }[] = []
    for (const instanceId of instanceIds) {
      const spot = autoPosition(taken)
      taken.push(spot)
      dispatch({ type: 'MOVE_CARD', instanceId, toZone: 'battlefield', x: spot.x, y: spot.y })
    }
    setSelectedIds(new Set())
    playCue('play-card')
  }

  /** Shift+click on a card (battlefield or hand): add it to, or take it out of, the selection. */
  function toggleSelected(instanceId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(instanceId)) next.delete(instanceId)
      else next.add(instanceId)
      return next
    })
  }

  /** Clicking a hand card plays it. Shift+click selects it instead, and clicking any card of a
   *  multi-card hand selection plays the whole selection, the hand's version of clicking a
   *  selected battlefield card tapping the group. */
  function handleHandCardClick(instanceId: string, event: ReactMouseEvent) {
    if (event.shiftKey) {
      toggleSelected(instanceId)
      return
    }
    const selectedInHand = hand.filter((c) => selectedIds.has(c.instanceId)).map((c) => c.instanceId)
    if (selectedInHand.length > 1 && selectedIds.has(instanceId)) {
      playManyToBattlefield(selectedInHand)
      return
    }
    playToBattlefield(instanceId)
  }

  /** Like playToBattlefield, but hides the card's identity from opponents from the moment it
   *  lands (a morph-style play) instead of playing face up and turning it down after. */
  function playToBattlefieldFaceDown(instanceId: string) {
    const { x, y } = autoPosition()
    dispatch({ type: 'MOVE_CARD', instanceId, toZone: 'battlefield', x, y, faceDown: true })
    playCue('play-card')
  }

  function handleDraw() {
    dispatch({ type: 'DRAW', toSide: handDrawSide })
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
      toggleSelected(gameCard.instanceId)
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
    playCue('create-token')
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

  /** Opens a card's Scryfall page (which includes its rulings). The trimmed-down CardSnapshot
   *  this app caches deliberately drops set/collector_number (see storage/cardCache.ts), so this
   *  needs the fuller ScryfallCard — getCardById serves the in-memory search cache when possible,
   *  otherwise a single live lookup.
   *
   *  Two paths, because the safe thing to do differs by host:
   *
   *  - Electron: resolve the URL first, then hand it to the main process, which opens it in the
   *    user's REAL browser (see electron/windowSecurity.cjs). It must not be opened in an
   *    Electron window: this used to open a blank tab and navigate it, and `window.open('')` is
   *    `about:blank`, the one case where Chromium copies the parent's webPreferences — this
   *    app's preload and all its ipcRenderer bridges — into the child with no way to override
   *    it. Scryfall (and anywhere the user browsed on to from there, since nothing pinned that
   *    window's navigation) therefore ran with window.electronStorage in scope.
   *  - Plain browser (`npm run dev`): no preload to leak, so keep the original dance — open the
   *    blank tab synchronously, before the `await`, and navigate it once the lookup resolves.
   *    Opening it only after an awaited fetch gets silently popup-blocked in most browsers,
   *    since the async gap breaks the "this came from a real click" gesture chain they check
   *    for. `noopener` can't be used (it nulls the reference needed to navigate the tab later),
   *    so `tab.opener` is cleared manually — same reverse-tabnabbing protection after the fact.
   *
   *  Either way a failure (offline, deleted printing, etc.) is silent — a failed rulings lookup
   *  shouldn't interrupt the game it's attached to, same philosophy as the sound cues (see
   *  utils/sound.ts). */
  async function lookUpRulings(scryfallId: string) {
    const scryfallUrl = (card: { set?: string; collector_number?: string }) =>
      card.set && card.collector_number ? `https://scryfall.com/card/${card.set}/${card.collector_number}` : null

    const shell = window.electronShell
    if (shell) {
      try {
        const url = scryfallUrl(await getCardById(scryfallId))
        if (url) await shell.openExternal(url)
      } catch {
        // Nothing was opened yet, so there's nothing to clean up.
      }
      return
    }

    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const url = scryfallUrl(await getCardById(scryfallId))
      if (url && tab) {
        tab.location.href = url
      } else {
        tab?.close()
      }
    } catch {
      tab?.close()
    }
  }

  /**
   * The other half of the untap step's "permanents you CONTROL" rule (see gameReducer's
   * untapControlled for our own side of it): cards someone else owns that are sitting on OUR
   * quadrant untap with us, not with their owner. They live in the owner's state, so this asks
   * each owner to untap them — the same directed TAP_CARD route a click on one of those cards
   * already uses; the result comes back to the whole pod via their next STATE broadcast.
   */
  function untapForeignCardsOnMyBoard() {
    if (!inPod || !mpActive) return
    for (const board of opponentBoards) {
      for (const pc of board.battlefield) {
        if (pc.atSeat === mySeatResolved && pc.tapped) tapRemoteCard(board.playerId, pc.instanceId, false)
      }
    }
  }

  function handleUntapAll() {
    dispatch({ type: 'UNTAP_ALL' })
    untapForeignCardsOnMyBoard()
  }

  function handleNextTurn() {
    dispatch({ type: 'NEXT_TURN', toSide: handDrawSide })
    untapForeignCardsOnMyBoard()
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
        label: 'Add Keyword Counter',
        submenu: KEYWORD_COUNTERS.map((k) => ({
          label: k.label,
          onSelect: () => dispatch({ type: 'ADD_COUNTER_PILE', instanceId: gameCard.instanceId, color: k.id }),
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
    // Copy/paste a whole counter layout, for stamping the same setup onto several cards without
    // rebuilding it by hand each time (Ctrl+C / Ctrl+V over a card do the same). Each only
    // appears when it would actually do something: nothing to copy off a bare card, nothing to
    // paste before something's been copied.
    if ((gameCard.counters?.length ?? 0) > 0 || (gameCard.ptCounters?.length ?? 0) > 0) {
      actions.push({ label: 'Copy Counters', onSelect: () => copyCounters(gameCard) })
    }
    if (counterClipboard) {
      actions.push({ label: 'Paste Counters', onSelect: () => pasteCounters(gameCard.instanceId) })
    }
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
      // Bottoming is a genuinely distinct effect from putting a card on top (scry, Brainstorm,
      // "put it on the bottom of its owner's library"), and the reducer has always supported it —
      // only the menu never offered it.
      { zone: 'library', label: 'Move to Library (Bottom)', libraryPosition: 'bottom' },
    ]
    if (deck.format === 'commander') moveTargets.push({ zone: 'command', label: 'Move to Command' })
    for (const { zone, label, libraryPosition } of moveTargets) {
      actions.push({ label, onSelect: () => dispatch({ type: 'MOVE_CARD', instanceId: gameCard.instanceId, toZone: zone, libraryPosition }) })
    }
    // Always the card's real identity even if currently played face-down — this is only ever
    // shown for our own battlefield cards, whose faceDown state hides them from opponents, not
    // from us (see GameCard.faceDown doc).
    actions.push({ label: 'Look Up Rulings', onSelect: () => lookUpRulings(gameCard.scryfallId) })
    // Ownership transfer is now exclusively an explicit choice here — dropping a card onto
    // someone else's board just relocates it (see handleBattlefieldDrop), so giving it away for
    // real needs its own unambiguous action instead.
    // Only while actually connected: mid-reconnect the opponents' boards are still on screen but
    // there is no open channel to hand a card across.
    if (inPod && mpActive && mpStatus === 'connected' && opponentBoards.length > 0) {
      actions.push({
        label: 'Give Card',
        submenu: opponentBoards.map((board) => ({
          label: board.name || `Seat ${board.seat}`,
          onSelect: () => {
            const sent = giveCard(board.playerId, {
              instanceId: gameCard.instanceId,
              scryfallId: gameCard.scryfallId,
              // Preserve the true owner if this card was itself given to us.
              ownerSeat: gameCard.ownerSeat ?? mySeatResolved,
              x: gameCard.x ?? 0,
              y: gameCard.y ?? 0,
              tapped: gameCard.tapped,
              counters: gameCard.counters,
              ptCounters: gameCard.ptCounters,
              showBackFace: gameCard.showBackFace,
              isToken: gameCard.isToken,
              faceDown: gameCard.faceDown,
              isCommander: gameCard.isCommander,
              commanderTax: gameCard.commanderTax,
            })
            // The card only leaves our board once it has actually been sent. Removing it
            // regardless is how a give during a reconnect deleted the card outright.
            if (!sent) {
              notifyWarning("Couldn't hand that card over — the connection isn't ready. Try again in a moment.")
              return
            }
            dispatchExternal({ type: 'REMOVE_CARD', instanceId: gameCard.instanceId })
          },
        })),
      })
    }
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
    // Dredge: the card picked goes back to hand in place of a draw, and the top N are milled.
    if (dredgeCount !== null && viewerZone === 'graveyard' && toZone === 'hand') {
      dispatch({ type: 'MOVE_CARD', instanceId, toZone: 'hand' })
      moveTopCards('library', 'graveyard', dredgeCount)
      setDredgeCount(null)
      setViewerZone(null)
      return
    }
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
    setDredgeCount(null)
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

  /** The top `count` cards of a pile, top first: the front of the library, and the newest end of
   *  the graveyard and exile (the card shown on the pile). */
  function topCardsOf(zone: PileZone, count: number) {
    const cards = zoneCards(state, zone)
    return (zone === 'library' ? cards : [...cards].reverse()).slice(0, Math.max(0, count))
  }

  /** The one step behind Mill X, Exile top X, Return top X to hand and the rest: the top `count`
   *  cards of `from` go to `to`, top card first. Asking for more than the zone holds moves all of
   *  it. One undo step, like any other burst. */
  function moveTopCards(from: PileZone, to: GameZone, count: number, libraryPosition?: 'top' | 'bottom') {
    for (const card of topCardsOf(from, count)) {
      dispatch({ type: 'MOVE_CARD', instanceId: card.instanceId, toZone: to, libraryPosition })
    }
  }

  /** Shuffles every card in `from` into the library (graveyard or exile, e.g. Elixir of Immortality). */
  function shuffleZoneIntoLibrary(from: 'graveyard' | 'exile') {
    const ids = zoneCards(state, from).map((c) => c.instanceId)
    if (ids.length === 0) return
    for (const instanceId of ids) dispatch({ type: 'MOVE_CARD', instanceId, toZone: 'library', libraryPosition: 'bottom' })
    dispatch({ type: 'SHUFFLE_LIBRARY', shuffledOrder: shuffle([...library.map((c) => c.instanceId), ...ids]) })
    playCue('shuffle')
  }

  /** A zone's right-click menu. Named the way the game names them (mill, exile X, dredge...),
   *  though most are the same "move the top X somewhere" step underneath. X actions ask for the
   *  number first, in a box opened where the menu was. The library's own cards stay hidden until
   *  the player picks "Search library". */
  function zoneActions(zone: PileZone, x: number, y: number): ContextMenuAction[] {
    const ask = (label: string, run: (count: number) => void) => () => setZoneCountAsk({ label, x, y, run })
    if (zone === 'library') {
      return [
        { label: 'Draw X…', onSelect: ask('Draw how many?', (n) => { dispatch({ type: 'DRAW', count: n, toSide: handDrawSide }); playCue('draw') }) },
        { label: 'Scry X…', onSelect: ask('Scry how many?', (n) => startScryOrSurveil('scry', n)) },
        { label: 'Surveil X…', onSelect: ask('Surveil how many?', (n) => startScryOrSurveil('surveil', n)) },
        { label: 'Mill X…', onSelect: ask('Mill how many?', (n) => moveTopCards('library', 'graveyard', n)) },
        { label: 'Exile top X…', onSelect: ask('Exile how many?', (n) => moveTopCards('library', 'exile', n)) },
        { label: 'Look at top X…', onSelect: ask('Look at how many?', (n) => startRevealTop(n)) },
        { label: 'Put top X on the bottom…', onSelect: ask('Bottom how many?', (n) => moveTopCards('library', 'library', n, 'bottom')) },
        { label: 'View bottom X…', onSelect: ask('View how many?', (n) => openBottomViewer(n)) },
        { label: 'Cascade…', onSelect: ask('Mana value', (n) => startCascade(n)) },
        {
          label: state.revealTopOfLibrary ? 'Stop looking at top card' : 'Look at top card',
          onSelect: () => dispatch({ type: 'TOGGLE_REVEAL_TOP' }),
        },
        {
          label: state.revealTopToPod ? 'Hide top card from table' : 'Reveal top card to table',
          onSelect: () => dispatch({ type: 'TOGGLE_REVEAL_TOP_TO_POD' }),
        },
        {
          label: 'Shuffle',
          onSelect: () => {
            dispatch({ type: 'SHUFFLE_LIBRARY', shuffledOrder: shuffle(library.map((c) => c.instanceId)) })
            playCue('shuffle')
          },
        },
        { label: 'Search library (show cards)', onSelect: () => setViewerZone('library') },
      ]
    }
    if (zone === 'graveyard') {
      return [
        { label: 'View graveyard', onSelect: () => setViewerZone('graveyard') },
        { label: 'Exile top X…', onSelect: ask('Exile how many?', (n) => moveTopCards('graveyard', 'exile', n)) },
        { label: 'Exile graveyard', onSelect: () => moveTopCards('graveyard', 'exile', graveyard.length) },
        { label: 'Return top X to hand…', onSelect: ask('Return how many?', (n) => moveTopCards('graveyard', 'hand', n)) },
        {
          label: 'Dredge X…',
          onSelect: ask('Dredge how many?', (n) => {
            setDredgeCount(n)
            setViewerZone('graveyard')
          }),
        },
        { label: 'Shuffle graveyard into library', onSelect: () => shuffleZoneIntoLibrary('graveyard') },
      ]
    }
    return [
      { label: 'View exile', onSelect: () => setViewerZone('exile') },
      { label: 'Return top X to hand…', onSelect: ask('Return how many?', (n) => moveTopCards('exile', 'hand', n)) },
      { label: 'Put top X into graveyard…', onSelect: ask('How many?', (n) => moveTopCards('exile', 'graveyard', n)) },
      { label: 'Shuffle exile into library', onSelect: () => shuffleZoneIntoLibrary('exile') },
    ]
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

  /** Rolls `count` N-sided dice as ONE result, logs it locally, and shares it with the pod (if
   *  connected). A single die keeps the original shape exactly (no `values`), so the common case
   *  reads the same as it always has — see RollResult. */
  function rollDie(sides: number, count = 1) {
    const rolled = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides))
    const total = rolled.reduce((sum, n) => sum + n, 0)
    const roll: RollResult = { kind: 'die', sides, value: total, ...(count > 1 ? { values: rolled } : {}) }
    publishRoll(roll)
    setCountPrompt(null)
  }

  /** Flips a coin, logs it locally, and shares it with the pod (if connected). */
  function flipCoin() {
    publishRoll({ kind: 'coin', value: Math.random() < 0.5 ? 'heads' : 'tails' })
  }

  /** Logs a roll locally and shares it, minting the shared id both sides key dismissal off. */
  function publishRoll(roll: RollResult) {
    const id = crypto.randomUUID()
    addRollEntry(playerId, playerName, roll, id)
    if (mpActive) broadcastRoll(roll, id)
  }

  /** Takes back one of our own rolls — clears it here and, in a pod, for everyone else too. */
  function dismissRoll(id: string) {
    removeRollEntry(id)
    if (mpActive) broadcastRollDismiss(id)
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

    // Same three cases, in the same order, as handleBattlefieldDrop: another player's card lands
    // on whichever quadrant it is dropped in (occupied or not); our own battlefield or hand card
    // lands on a live opponent's quadrant if dropped there; anything else stays on ours.
    let origin = myOrigin
    if (inPod && drag.fromPlayerId) {
      origin = seatOrigin(seatAtSurfacePoint(surfaceX, surfaceY), CANVAS_W, CANVAS_H)
    } else if (inPod && mpActive && (drag.fromZone === 'battlefield' || drag.fromZone === 'hand')) {
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
      // Dragging a card WE own off its current holder's board and back onto our OWN quadrant is
      // asking for it back, not repositioning it. A plain relocate here moved the card to our
      // side while the holder kept ownership — so it sat on our board un-tappable, un-draggable,
      // and (since its ownerSeat then matched the quadrant it was drawn in) without even the
      // owner ring that would have hinted why. See ReclaimCardMessage.
      const heldCard = opponentBoards.find((b) => b.playerId === data.fromPlayerId)?.battlefield.find((c) => c.instanceId === data.instanceId)
      const isOursHeldElsewhere = heldCard?.ownerSeat !== undefined && heldCard.ownerSeat === mySeatResolved
      if (mpActive && isOursHeldElsewhere && targetSeat === mySeatResolved) {
        reclaimRemoteCard(data.fromPlayerId, data.instanceId)
        return
      }
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

    // Dropped a battlefield *or hand* card into a live opponent's quadrant → it's still ours,
    // just visually placed there ("move any card anywhere," symmetric with how an opponent's
    // card dragged onto OUR board above stays theirs). Ownership only ever changes through the
    // explicit "Give Card" context-menu action now — a drop, even onto someone else's board,
    // never hands a card away by itself; that used to surprise people who just wanted to
    // reposition their own card for table-talk/organizational reasons.
    if (inPod && mpActive && (data.fromZone === 'battlefield' || data.fromZone === 'hand')) {
      const targetSeat = seatAtSurfacePoint(surfaceX, surfaceY)
      const targetBoard = targetSeat !== mySeatResolved ? opponentBoards.find((b) => b.seat === targetSeat) : undefined
      const sourceCards = data.fromZone === 'battlefield' ? battlefield : hand
      const card = targetBoard ? sourceCards.find((c) => c.instanceId === data.instanceId) : undefined
      if (targetBoard && card) {
        const targetOrigin = seatOrigin(targetSeat, CANVAS_W, CANVAS_H)
        const local = clampToCanvas(surfaceX - targetOrigin.x, surfaceY - targetOrigin.y)
        // Normalize back to undefined if somehow dropped on our own seat (shouldn't happen here
        // since targetBoard is only set for a seat that isn't ours, but keeps the convention
        // consistent with RECEIVE_RELOCATED_CARD/the opponent-card relocate path above).
        const atSeat = targetSeat === mySeatResolved ? undefined : targetSeat
        const burstPoint = mirror(surfaceX + CARD_W_PX / 2, surfaceY + CARD_H_PX / 2)
        particlesRef.current?.burst(burstPoint.x, burstPoint.y)
        if (data.fromZone === 'battlefield') {
          dispatch({ type: 'RECEIVE_RELOCATED_CARD', instanceId: card.instanceId, x: local.x, y: local.y, atSeat })
          for (const g of data.groupOffsets ?? []) {
            const member = battlefield.find((c) => c.instanceId === g.instanceId)
            if (!member) continue
            const memberLocal = clampToCanvas(surfaceX - targetOrigin.x + g.dx, surfaceY - targetOrigin.y + g.dy)
            dispatch({ type: 'RECEIVE_RELOCATED_CARD', instanceId: member.instanceId, x: memberLocal.x, y: memberLocal.y, atSeat })
          }
        } else {
          // Playing straight from hand onto someone else's quadrant — same "still ours" rule.
          dispatch({ type: 'MOVE_CARD', instanceId: card.instanceId, toZone: 'battlefield', x: local.x, y: local.y, atSeat })
          for (const g of data.groupOffsets ?? []) {
            if (!hand.some((c) => c.instanceId === g.instanceId)) continue
            const memberLocal = clampToCanvas(surfaceX - targetOrigin.x + g.dx, surfaceY - targetOrigin.y + g.dy)
            dispatch({ type: 'MOVE_CARD', instanceId: g.instanceId, toZone: 'battlefield', x: memberLocal.x, y: memberLocal.y, atSeat })
          }
          if (data.groupOffsets?.length) setSelectedIds(new Set())
          playCue('play-card')
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
      // A multi-card hand selection lands as a row, keeping the layout the preview showed.
      for (const g of data.groupOffsets ?? []) {
        const member = clampToCanvas(surfaceX - myOrigin.x + g.dx, surfaceY - myOrigin.y + g.dy)
        dispatch({ type: 'MOVE_CARD', instanceId: g.instanceId, toZone: 'battlefield', x: member.x, y: member.y })
      }
      if (data.groupOffsets?.length) setSelectedIds(new Set())
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
      // The hand floats over the table in screen space, so its cards are tested against the
      // box's screen rectangle rather than the table-space one.
      const startClient = { x: event.clientX, y: event.clientY }

      function onMove(moveEvent: globalThis.MouseEvent) {
        const point = surfacePointAt(moveEvent.clientX, moveEvent.clientY)
        if (point) setMarquee((prev) => (prev ? { ...prev, x2: point.x, y2: point.y } : prev))
      }
      function onUp(upEvent: globalThis.MouseEvent) {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const box = {
          left: Math.min(startClient.x, upEvent.clientX),
          right: Math.max(startClient.x, upEvent.clientX),
          top: Math.min(startClient.y, upEvent.clientY),
          bottom: Math.max(startClient.y, upEvent.clientY),
        }
        const handHits = [...document.querySelectorAll<HTMLElement>('.playtest__hand-card[data-instance-id]')]
          .filter((el) => {
            const r = el.getBoundingClientRect()
            return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top
          })
          .map((el) => el.dataset.instanceId!)
        if (handHits.length > 0) setSelectedIds((prevSel) => new Set([...prevSel, ...handHits]))
        const end = surfacePointAt(upEvent.clientX, upEvent.clientY)
        setMarquee((prev) => {
          if (!prev) return null
          const point = end ?? { x: prev.x2, y: prev.y2 }
          const left = Math.min(prev.x1, point.x)
          const right = Math.max(prev.x1, point.x)
          const top = Math.min(prev.y1, point.y)
          const bottom = Math.max(prev.y1, point.y)
          // Live cards (not the list captured at mouse-down), each tested where it is drawn: a
          // card parked on another quadrant sits at THAT seat's origin. Testing everything
          // against our own origin selected far-away parked cards the box never touched.
          const hitIds = zoneCards(stateRef.current, 'battlefield')
            .filter((c) => {
              const origin = inPod && c.atSeat !== undefined ? seatOrigin(c.atSeat, CANVAS_W, CANVAS_H) : myOrigin
              const cx = (c.x ?? 0) + origin.x
              const cy = (c.y ?? 0) + origin.y
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

    panState.current = { lastX: event.clientX, lastY: event.clientY }

    function onMove(moveEvent: globalThis.MouseEvent) {
      const start = panState.current
      if (!start) return
      const dx = moveEvent.clientX - start.lastX
      const dy = moveEvent.clientY - start.lastY
      start.lastX = moveEvent.clientX
      start.lastY = moveEvent.clientY
      // Functional update (not the `camera` closed over above) so this always builds on the
      // latest camera, never a stale snapshot from whenever the drag started — see panState's doc.
      setCamera((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
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
      // A card that's actually someone else's (given away, or just sitting on our board via the
      // free-for-all "move any card anywhere" relocate) isn't in our own state at all — a local
      // MOVE_CARD here would silently no-op. Route to whichever directed request its target zone
      // already has: DELETE_CARD for the graveyard (existing), or the more general RETURN_CARD for
      // everything else this drops onto (library/exile/command — battlefield has its own
      // relocateCard, never routed through here).
      if (data.fromPlayerId && mpActive) {
        if (toZone === 'graveyard') deleteRemoteCard(data.fromPlayerId, data.instanceId)
        else if (toZone === 'hand' || toZone === 'library' || toZone === 'exile' || toZone === 'command') {
          // libraryPosition rides along so bottoming works for someone else's card too, not just
          // our own — see ReturnCardMessage.libraryPosition. Ignored by the owner for any other zone.
          returnRemoteCard(data.fromPlayerId, data.instanceId, toZone, libraryPosition)
        }
        return
      }
      // The whole selection goes, not just the card that was grabbed.
      const ids = draggedIds(data)
      for (const instanceId of ids) dispatch({ type: 'MOVE_CARD', instanceId, toZone, libraryPosition })
      if (ids.length > 1) setSelectedIds(new Set())
    }
  }

  /** The grabbed card plus every selected card riding along with it (see groupOffsets). */
  function draggedIds(data: DraggedGameCard): string[] {
    return [data.instanceId, ...(data.groupOffsets ?? []).map((g) => g.instanceId)]
  }

  /** Right-clicking ANOTHER player's battlefield card — a one-item menu offering to make your
   *  own token copy of it. Separate from `contextMenu` (which looks its card up in our own
   *  `battlefield`) because this one only ever knows the card by scryfallId: it isn't ours, and
   *  the copy it makes is a brand-new token of our own rather than anything tied to the original. */
  const [copyCardMenu, setCopyCardMenu] = useState<{ scryfallId: string; x: number; y: number } | null>(null)

  /** Makes a token copy of any card on the table — yours or anyone else's — on YOUR board.
   *  Purely local: it's a new token in our own state, so our next STATE broadcast shows it to
   *  the pod like any other card we played, and the original is untouched. */
  function copyCardAsToken(scryfallId: string) {
    const { x, y } = autoPosition()
    dispatch({ type: 'ADD_TOKEN', scryfallId, x, y })
    playCue('create-token')
    setCopyCardMenu(null)
  }

  /** Copied counter layout, waiting to be stamped onto another card. Session-only and
   *  deliberately not part of GameState: it's a scratch buffer for the person playing, not
   *  something the board should remember, broadcast, or restore from an autosave. */
  const [counterClipboard, setCounterClipboard] = useState<{ counters: CounterPile[]; ptCounters: PtCounterPile[] } | null>(null)

  function copyCounters(card: (typeof battlefield)[number]) {
    const counters = card.counters ?? []
    const ptCounters = card.ptCounters ?? []
    if (counters.length === 0 && ptCounters.length === 0) return
    setCounterClipboard({ counters, ptCounters })
  }

  function pasteCounters(instanceId: string) {
    if (!counterClipboard) return
    dispatch({ type: 'PASTE_COUNTER_PILES', instanceId, counters: counterClipboard.counters, ptCounters: counterClipboard.ptCounters })
  }

  // Ctrl/Cmd+C and +V over a card, mirroring the two context-menu entries. Its own effect rather
  // than folded into the undo/redo one above, which is declared earlier than the battlefield and
  // clipboard it would need to read. Both only fire while actually pointing at one of your own
  // battlefield cards, so the shortcuts stay out of the browser's way everywhere else — and
  // Playtest sets user-select: none, so there's no text selection here to steal either.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (!(event.ctrlKey || event.metaKey) || !hoveredInstanceId) return
      const key = event.key.toLowerCase()
      if (key === 'c') {
        const card = battlefield.find((c) => c.instanceId === hoveredInstanceId)
        if (!card || ((card.counters?.length ?? 0) === 0 && (card.ptCounters?.length ?? 0) === 0)) return
        event.preventDefault()
        setCounterClipboard({ counters: card.counters ?? [], ptCounters: card.ptCounters ?? [] })
      } else if (key === 'v' && counterClipboard) {
        if (!battlefield.some((c) => c.instanceId === hoveredInstanceId)) return
        event.preventDefault()
        dispatch({
          type: 'PASTE_COUNTER_PILES',
          instanceId: hoveredInstanceId,
          counters: counterClipboard.counters,
          ptCounters: counterClipboard.ptCounters,
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hoveredInstanceId, battlefield, counterClipboard, dispatch])

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
      // These mocks bypass toPublicBoard entirely, so `commanders` (real commander identity,
      // fixed regardless of zone — see PublicBoard's doc) doesn't get derived automatically the
      // way a live board's does; stand in with the same cards as `command` since every mock
      // commander here happens to already be sitting in the command zone.
      commanders: command,
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
  // F9: copy a debug snapshot of the table to the clipboard (see debugSnapshot.ts for why this
  // exists). Read through a ref so the key handler is installed once and always sees the current
  // render's values, and listened for in the capture phase with no focus or modal checks — it
  // has to work in exactly the situations where the rest of the UI isn't behaving.
  const [debugSnapshotText, setDebugSnapshotText] = useState<string | null>(null)
  const debugStateRef = useRef<() => Record<string, unknown>>(() => ({}))
  debugStateRef.current = () => {
    const now = Date.now()
    return {
      appVersion: __APP_VERSION__,
      connection: {
        status: mpStatus,
        statusDetail: mpStatusDetail,
        role: mpRole,
        mpActive,
        inPod,
        mockPod: mockBoards !== null,
        mySeat,
        mySeatResolved,
        viewRotated,
        activeSeat,
        podTurn,
        opponents: opponentBoards.map((b) => ({
          player: b.playerId.slice(0, 8),
          seat: b.seat,
          battlefield: b.battlefield.length,
          parkedOnMySeat: b.battlefield.filter((c) => c.atSeat === mySeatResolved).length,
          heldForMe: b.battlefield.filter((c) => c.ownerSeat === mySeatResolved).length,
        })),
      },
      game: {
        zones: Object.fromEntries((['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'] as const).map((z) => [z, zoneCards(state, z).length])),
        battlefield: battlefield.map((c) => ({
          id: c.instanceId.slice(0, 8),
          tapped: c.tapped,
          atSeat: c.atSeat,
          ownerSeat: c.ownerSeat,
          faceDown: c.faceDown,
          isToken: c.isToken,
          x: Math.round(c.x ?? 0),
          y: Math.round(c.y ?? 0),
        })),
        handIds: hand.map((c) => c.instanceId.slice(0, 8)),
        // Any id here more than once means a card exists twice on this client.
        duplicateInstanceIds: state.cards.map((c) => c.instanceId).filter((id, i, all) => all.indexOf(id) !== i).map((id) => id.slice(0, 8)),
        undoDepth: undoStackRef.current.length,
        redoDepth: redoStackRef.current.length,
      },
      ui: {
        camera,
        dragInProgress: getCurrentDragData(),
        dragPreviewShown: dragPreview !== null,
        panInProgress: panState.current !== null,
        marqueeInProgress: marquee !== null,
        spinInProgress: spinSeat !== null,
        hoveredInstanceId: hoveredInstanceId?.slice(0, 8) ?? null,
        selectedCount: selectedIds.size,
        open: {
          multiplayerModal: mpModalOpen,
          zoneViewer: viewerZone,
          opponentZoneViewer: oppZoneView?.zone ?? null,
          cardMenu: contextMenu !== null,
          handCardMenu: handContextMenu !== null,
          copyCardMenu: copyCardMenu !== null,
          countPrompt: countPrompt?.mode ?? null,
          libraryPeek: peek !== null,
          tokenPicker: tokenPickerOpen,
          bottomViewer: bottomViewerCount !== null,
          confirmScoop: confirmScoopOpen,
          anyDismissableLayer: isDismissableLayerOpen(),
        },
      },
      recentActions: recentActionsRef.current.map((a) => ({ ...a, msAgo: now - a.at, at: undefined })),
    }
  }
  useEffect(() => {
    const stopRecording = startInputRecording()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F9') return
      event.preventDefault()
      const snapshot = { ...debugStateRef.current(), page: buildDomSnapshot() }
      void copySnapshot(snapshot).then((copied) => {
        if (copied) {
          notifyInfo('Debug snapshot copied to the clipboard.')
          return
        }
        // The clipboard can refuse (the window isn't focused, or the page is in an odd state —
        // which is exactly when this key gets pressed). Put the text on screen instead, already
        // selected, so Ctrl+C alone finishes the job without needing the mouse.
        setDebugSnapshotText(JSON.stringify(snapshot, null, 2))
      })
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      stopRecording()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.key !== 'f' && event.key !== 'F') return
      if (hoveredInstanceId) {
        // A double-faced card in hand turns over too — to read the other side, or to choose
        // which side of a modal card to play. Nothing else in hand reacts to F (face-down is a
        // battlefield state; "play face down" is on the hand card's right-click menu).
        const handCard = hand.find((c) => c.instanceId === hoveredInstanceId)
        if (handCard) {
          const handSnapshot = snapshotFor(handCard.scryfallId)
          if (handSnapshot && isFlippableSnapshot(handSnapshot)) {
            event.preventDefault()
            dispatch({ type: 'FLIP_CARD', instanceId: hoveredInstanceId })
          }
          return
        }
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
  }, [hoveredInstanceId, battlefield, hand, libraryHovered, library, dispatch, snapshotFor, inPod, opponentBoards, mySeatResolved, flipRemoteCard])

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

  // Only what isn't about a zone's cards: everything that works on the library, graveyard or
  // exile is on that pile's right-click menu instead (see zoneActions).
  const trayActions: TrayAction[] = [
    { key: 'tokens', label: 'Create Token', icon: '⭐', onClick: () => setTokenPickerOpen(true) },
    { key: 'dice', label: 'Roll Die', icon: '🎲', onClick: (event) => setCountPrompt({ mode: 'dice', x: event.clientX, y: event.clientY }) },
    { key: 'coin', label: 'Flip Coin', icon: '🪙', onClick: () => flipCoin() },
    {
      key: 'reveal-hand',
      label: state.revealHand ? 'Hide Hand' : 'Reveal Hand',
      icon: state.revealHand ? '🤜' : '🖐️',
      onClick: () => dispatch({ type: 'TOGGLE_REVEAL_HAND' }),
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
    playerId: entry.playerId,
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
        {/* Two different numbers, so both are labelled rather than one bare "Turn N": your own
            turn count (what NEXT_TURN advances, meaningful solo) and — in a pod — the table's
            shared round, which is the one everybody agrees on. See TurnPassMessage.turn. */}
        {!inPod && <span className="playtest__turn">Turn {state.turn}</span>}
        {inPod && podTurn !== null && (
          <span className="playtest__turn playtest__turn--table" title="The table's shared turn — advances when play comes back around to the first seat">
            Table Turn {podTurn}
          </span>
        )}
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
          <button type="button" onClick={handleNextTurn}>
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
        {/* Hidden (not just disabled) while connected to a pod — switching would currently drop
            the connection (see handleToggleWindowMode's doc), and a control that's always visible
            but usually unclickable read as broken rather than situational. */}
        {!inPod && (
          <button
            type="button"
            onClick={handleToggleWindowMode}
            title={
              playtestWindowMode === 'window'
                ? 'Playtest opens in its own window — good for multiple monitors. Click to pop this game inline into this window instead.'
                : 'Playtest opens inline in this window — good for a single monitor. Click to pop this game out into its own window instead.'
            }
          >
            {playtestWindowMode === 'window' ? '🪟 Own Window' : '🖥️ Inline'}
          </button>
        )}
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
            {/* Seat quadrant frames (own seat highlighted), plus each seat's name centered just
                outside its own quadrant — an at-a-glance "whose section is whose, and whose turn
                is it" read directly on the table, instead of needing to cross-reference the
                fixed player-panel sidebar. Both non-interactive backdrop. */}
            {inPod &&
              ALL_SEATS.map((seat) => {
                const seatOrig = seatOrigin(seat, CANVAS_W, CANVAS_H)
                const o = mirror(seatOrig.x, seatOrig.y, CANVAS_W, CANVAS_H)
                // Whichever half of the SCREEN this quadrant renders in — mirror() above already
                // flips a top-row viewer's own 180° rotation, so checking the post-mirror `o.y`
                // (not the seat's canonical SEAT_GRID row) is what keeps the label outside the
                // table's actual visible edge for every viewer, not just an unrotated one.
                const onScreenTopHalf = o.y === 0
                const badgeClass = `${seat === activeSeat ? 'is-active-turn' : ''} ${isEliminated(seat) ? 'is-eliminated' : ''}`
                // Counter-scales the label against the surface's own `scale(camera.zoom)` (see
                // that transform a bit below) so it reads as a roughly constant on-screen size
                // instead of shrinking into illegibility right when zooming out to see the whole
                // table is exactly when you'd want it most. Floored at 1 (never shrinks below its
                // authored size zoomed in) and capped at 3 (never balloons past that zoomed way
                // out, past ZOOM_MIN) — transform-origin below is chosen to exactly match the
                // translate() anchor point (the corner touching the table edge) so this scaling
                // can't drift that point regardless of the factor.
                const labelScale = Math.min(3, Math.max(1, 1 / camera.zoom))
                const handCount = seat === mySeatResolved ? hand.length : (opponentBoards.find((b) => b.seat === seat)?.handCount ?? 0)
                return (
                  <Fragment key={`frame-${seat}`}>
                    <div
                      className={`playtest__quadrant ${seat === mySeatResolved ? 'is-self' : ''} ${badgeClass}`}
                      style={{ left: o.x, top: o.y, width: CANVAS_W, height: CANVAS_H, '--seat-color': SEAT_COLORS[seat] } as CSSProperties}
                    />
                    {/* One anchor+scale wrapper per seat holding both the name label and the
                        hand-size fan (see HandCardFan) below it, so the two never need to agree
                        on a pixel gap between two independently-positioned elements — plain flex
                        stacking inside one already handles that. Growth direction (translate/
                        transform-origin) is identical to the label's own before this wrapper
                        existed; DOM order [label, fan] then reads as "fan below the name" for a
                        bottom-row seat (grows downward, away from the table) and "fan just above
                        the table, name further out" for a top-row one (grows upward) — either
                        way the fan ends up the closer-to-the-table of the two, never over it. */}
                    <div
                      className="playtest__seat-label-stack"
                      style={
                        {
                          left: o.x + CANVAS_W / 2,
                          top: onScreenTopHalf ? o.y : o.y + CANVAS_H,
                          transform: `translate(-50%, ${onScreenTopHalf ? '-100%' : '0'}) scale(${labelScale})`,
                          transformOrigin: onScreenTopHalf ? '50% 100%' : '50% 0%',
                        } as CSSProperties
                      }
                    >
                      <div className={`playtest__seat-label ${badgeClass}`} style={{ '--seat-color': SEAT_COLORS[seat] } as CSSProperties}>
                        {seatNameBySeat.get(seat) ?? 'Open'}
                      </div>
                      <HandCardFan count={handCount} />
                    </div>
                  </Fragment>
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
                    // Empty (not omitted): without SOME title here, hovering a card with a
                    // stationary cursor falls through to .playtest__battlefield-surface's own
                    // "Alt+click to ping/right-click to create a token" tooltip — a native
                    // browser title-attribute lookup walks up to the nearest ancestor that HAS
                    // one, and misleadingly implies those empty-canvas gestures apply here too.
                    title=""
                    style={{
                      left: pos.x,
                      top: pos.y,
                      ...(foreign ? { '--owner-color': SEAT_COLORS[trueOwnerSeat] } : {}),
                    } as CSSProperties}
                    onMouseEnter={() => setHoveredInstanceId(pc.instanceId)}
                    onMouseLeave={() => setHoveredInstanceId((cur) => (cur === pc.instanceId ? null : cur))}
                    // Copying a card is something you do to your OWN board — it makes a token of
                    // yours and never touches theirs — so unlike tap/flip/move it needs no
                    // permission from the card's owner and no wire message. A face-down card is
                    // skipped: its real identity was never sent to us (see FACE_DOWN_SCRYFALL_ID),
                    // so there's nothing here that could be copied.
                    onContextMenu={
                      pc.faceDown
                        ? undefined
                        : (event) => {
                            event.preventDefault()
                            setCopyCardMenu({ scryfallId: pc.scryfallId, x: event.clientX, y: event.clientY })
                          }
                    }
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
                    {/* Only for a card sitting on OUR quadrant — the same cards F can flip, and
                        for the same reason: it is ours to handle while it is here. The flip
                        itself happens on its owner's client. */}
                    {!pc.faceDown && pc.atSeat !== undefined && pc.atSeat === mySeatResolved && mpActive && isFlippable(pc.scryfallId) && (
                      <FlipFaceButton showingBack={!!pc.showBackFace} onFlip={() => flipRemoteCard(board.playerId, pc.instanceId)} />
                    )}
                    <CounterPileStack
                      items={(pc.counters ?? []).map((p) => ({ id: p.id, color: p.color, text: counterPileLabel(p), name: counterPileName(p.color) }))}
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
              const cardOrigin = inPod && gameCard.atSeat !== undefined ? seatOrigin(gameCard.atSeat, CANVAS_W, CANVAS_H) : myOrigin
              const pos = mirror((gameCard.x ?? 0) + cardOrigin.x, (gameCard.y ?? 0) + cardOrigin.y, CARD_W_PX, CARD_H_PX)
              return (
              <div
                key={gameCard.instanceId}
                className={`playtest__battlefield-card ${foreign ? 'is-foreign' : ''} ${highlightedIds.has(gameCard.instanceId) ? 'is-highlighted' : ''} ${counterDropTargetId === gameCard.instanceId ? 'is-counter-drop-target' : ''}`}
                // See the opponent-card loop's matching title="" a bit above — same fix, same
                // reason: without it, this card's own tooltip is the battlefield surface's
                // "Alt+click to ping/right-click to create a token" hint, which doesn't apply here.
                title=""
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
                {isFlippable(gameCard.scryfallId) && (
                  <FlipFaceButton showingBack={!!gameCard.showBackFace} onFlip={() => dispatch({ type: 'FLIP_CARD', instanceId: gameCard.instanceId })} />
                )}
                <CounterPileStack
                  items={(gameCard.counters ?? []).map((p) => ({ id: p.id, color: p.color, text: counterPileLabel(p), name: counterPileName(p.color) }))}
                  side="left"
                  sourceInstanceId={gameCard.instanceId}
                  onAdjust={(pileId, delta) => {
                    // A keyword marker (Flying, Hexproof…) is there or it isn't: taking the last
                    // one off removes the chip, where it used to read "FLY×0" and then "FLY×-1".
                    const pile = gameCard.counters?.find((p) => p.id === pileId)
                    if (pile && isKeywordCounter(pile.color) && pile.value + delta <= 0) {
                      dispatch({ type: 'REMOVE_COUNTER_PILE', instanceId: gameCard.instanceId, pileId })
                      return
                    }
                    dispatch({ type: 'ADJUST_COUNTER_PILE', instanceId: gameCard.instanceId, pileId, delta })
                  }}
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
              isActiveTurn={inPod && activeSeat === mySeatResolved}
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
              commanders={commanders.map((c) => ({
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
                  isActiveTurn={activeSeat === board.seat}
                  commanderSources={Object.entries(board.commanderDamage).map(([seatKey, damage]) => {
                    const srcSeat = Number(seatKey) as Seat
                    return { seat: srcSeat, name: seatNameBySeat.get(srcSeat) ?? `Seat ${srcSeat + 1}`, damage: damage ?? 0 }
                  })}
                  commanders={(board.commanders ?? []).map((c) => ({
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
                  revealedTopCard={
                    board.topOfLibrary
                      ? {
                          scryfallId: board.topOfLibrary.scryfallId,
                          name: snapshotFor(board.topOfLibrary.scryfallId)?.name ?? board.topOfLibrary.scryfallId,
                          snapshot: snapshotFor(board.topOfLibrary.scryfallId),
                        }
                      : undefined
                  }
                  floatingMana={board.floatingMana}
                  isSelf={false}
                  onFocus={() => centerOnSeat(board.seat)}
                  onViewZone={(zone) => setOppZoneView({ playerId: board.playerId, zone })}
                />
              ))}
          </div>
          {!inPod && goldfishOn && <GoldfishPanel turn={state.turn} rows={goldfishRows} />}
          <RollLog entries={rollLogEntries} onDismiss={dismissRoll} selfPlayerId={playerId} />
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
            <button type="button" className="playtest__quickbar-btn" onClick={handleUntapAll}>
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
            onContextMenu={(event) => setZoneMenu({ zone: 'library', x: event.clientX, y: event.clientY })}
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
              // Either effect shows it to US: the private "look at" one by definition, and the
              // public "revealed" one because a card everyone else can see is hardly hidden from
              // its own controller.
              (state.revealTopOfLibrary || state.revealTopToPod ? (
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
            onContextMenu={(event) => setZoneMenu({ zone: 'graveyard', x: event.clientX, y: event.clientY })}
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
          <ZonePile
            label="Exile"
            count={exile.length}
            onClick={() => setViewerZone('exile')}
            onContextMenu={(event) => setZoneMenu({ zone: 'exile', x: event.clientX, y: event.clientY })}
            onDropCard={dropToZone('exile')}
          >
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
          // A card that's actually someone else's (given away, or just sitting on our board via
          // the free-for-all "move any card anywhere" relocate) isn't in our own state at all —
          // a local MOVE_CARD here would silently no-op. Ask its real owner's client to send it
          // to *their* hand instead (see ReturnCardMessage) — the one drop target this used to
          // have no directed request for at all (unlike battlefield repositioning/RELOCATE_CARD
          // or the graveyard/DELETE_CARD, which already worked this way).
          if (data.fromPlayerId) {
            if (mpActive) returnRemoteCard(data.fromPlayerId, data.instanceId, 'hand')
            return
          }
          // Every selected card riding along with the grabbed one comes too.
          const moving = new Set(draggedIds(data))
          if (data.fromZone !== 'hand') {
            for (const instanceId of moving) dispatch({ type: 'MOVE_CARD', instanceId, toZone: 'hand' })
            if (moving.size > 1) setSelectedIds(new Set())
            return
          }
          // Reordering within the hand itself (distinct from playing a card in from elsewhere,
          // handled above) — insertion index comes from where the cursor sits relative to the
          // OTHER hand cards' midpoints (the dragged cards' own elements are excluded from that
          // comparison so their rects, mid-drag, can't skew where they land). A multi-card
          // selection moves as one block, in hand order.
          const block = hand.filter((c) => moving.has(c.instanceId))
          if (block.length === 0) return
          const otherEls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.playtest__hand-card')).filter(
            (el) => !moving.has(el.dataset.instanceId ?? ''),
          )
          let insertIndex = otherEls.length
          for (let i = 0; i < otherEls.length; i++) {
            const rect = otherEls[i].getBoundingClientRect()
            if (event.clientX < rect.left + rect.width / 2) {
              insertIndex = i
              break
            }
          }
          const withoutDragged = hand.filter((c) => !moving.has(c.instanceId))
          const reordered = [...withoutDragged.slice(0, insertIndex), ...block, ...withoutDragged.slice(insertIndex)]
          dispatch({ type: 'REORDER_HAND', orderedInstanceIds: reordered.map((c) => c.instanceId) })
        }}
      >
        <span className="playtest__hand-label">Hand ({hand.length})</span>
        <div ref={handRowRef} className={`playtest__hand-cards ${handOverflowing ? 'is-overflowing' : ''}`}>
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
            // Dragging one card of a multi-card hand selection brings the rest along, laid out
            // in a row in hand order around the grabbed card (see handleBattlefieldDrop).
            const isSelected = selectedIds.has(gameCard.instanceId)
            const selectedInHand = isSelected ? hand.filter((c) => selectedIds.has(c.instanceId)) : []
            const anchorIndex = selectedInHand.findIndex((c) => c.instanceId === gameCard.instanceId)
            const handGroupOffsets =
              selectedInHand.length > 1
                ? selectedInHand
                    .map((c, k) => ({ instanceId: c.instanceId, dx: (k - anchorIndex) * (CARD_W_PX + 10), dy: 0 }))
                    .filter((g) => g.instanceId !== gameCard.instanceId)
                : undefined
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
                  onClick={(event) => handleHandCardClick(gameCard.instanceId, event)}
                  onContextMenu={(event) => setHandContextMenu({ instanceId: gameCard.instanceId, x: event.clientX, y: event.clientY })}
                  foil={foilFor(gameCard.scryfallId)}
                  selected={isSelected}
                  groupOffsets={handGroupOffsets}
                />
                {isFlippable(gameCard.scryfallId) && (
                  <FlipFaceButton showingBack={!!gameCard.showBackFace} onFlip={() => dispatch({ type: 'FLIP_CARD', instanceId: gameCard.instanceId })} />
                )}
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
          zone={viewerZone}
          note={
            viewerZone === 'library'
              ? 'Searching your library means shuffling afterward — hover the library pile and press R.'
              : dredgeCount !== null && viewerZone === 'graveyard'
                ? `Dredge ${dredgeCount}: press Hand on the card you're dredging. The top ${dredgeCount} of your library are milled when you do.`
                : undefined
          }
          searchable={viewerZone === 'library'}
        />
      )}

      {zoneMenu && (
        <CardContextMenu x={zoneMenu.x} y={zoneMenu.y} actions={zoneActions(zoneMenu.zone, zoneMenu.x, zoneMenu.y)} onClose={() => setZoneMenu(null)} />
      )}

      {zoneCountAsk && (
        <NumberInputPrompt
          x={zoneCountAsk.x}
          y={zoneCountAsk.y}
          label={zoneCountAsk.label}
          onSubmit={zoneCountAsk.run}
          onClose={() => setZoneCountAsk(null)}
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

      {oppZoneView && oppZoneBoard && !oppZoneGone && (
        <ZoneViewerModal
          label={`${oppZoneBoard.name} — ${oppZoneView.zone === 'graveyard' ? 'Graveyard' : oppZoneView.zone === 'exile' ? 'Exile' : 'Hand'}`}
          // Graveyard/exile read as a stack (most-recently-added on top); a revealed hand has no
          // such ordering to preserve, so it's shown as-is instead of reversed.
          entries={(
            oppZoneView.zone === 'graveyard'
              ? (oppZoneBoard.graveyard ?? []).slice().reverse()
              : oppZoneView.zone === 'exile'
                ? (oppZoneBoard.exile ?? []).slice().reverse()
                : (oppZoneBoard.hand ?? [])
          ).map((pc) => ({
            gameCard: { instanceId: pc.instanceId, scryfallId: pc.scryfallId, zone: oppZoneView.zone, tapped: false, showBackFace: pc.showBackFace },
            snapshot: snapshotFor(pc.scryfallId),
          }))}
          onClose={() => setOppZoneView(null)}
          readOnly
        />
      )}

      {debugSnapshotText !== null && <DebugSnapshotPanel text={debugSnapshotText} onClose={() => setDebugSnapshotText(null)} />}

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

      {copyCardMenu && (
        <CardContextMenu
          x={copyCardMenu.x}
          y={copyCardMenu.y}
          actions={[{ label: 'Copy as Token', onSelect: () => copyCardAsToken(copyCardMenu.scryfallId) }]}
          onClose={() => setCopyCardMenu(null)}
        />
      )}

      {countPrompt && (
        <DiceRollPrompt
          x={countPrompt.x}
          y={countPrompt.y}
          sizes={DIE_SIZES}
          // d20 if the deck's dice are the usual ones, else whatever's listed first — the
          // single most-reached-for die, so the common roll stays one click plus Roll.
          defaultSides={DIE_SIZES.includes(20) ? 20 : DIE_SIZES[0]}
          onRoll={(sides, count) => rollDie(sides, count)}
          onClose={() => setCountPrompt(null)}
        />
      )}

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
            playCue('create-token')
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
