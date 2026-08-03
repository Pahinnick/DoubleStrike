import type { CounterColor, CounterPile, GivenCard, PtCounterPile, Seat } from '../net/protocol'
import type { Deck } from './types'

export type GameZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command'

export type GameCard = {
  instanceId: string
  scryfallId: string
  zone: GameZone
  tapped: boolean
  /** Battlefield position in canvas-space pixels (top-left of the card). */
  x?: number
  y?: number
  /** Real Magic tokens cease to exist once they leave the battlefield — see MOVE_CARD. */
  isToken?: boolean
  /** Independent generic counter piles (loyalty, charge, poison, etc.), each its own color and
   *  signed running total — a card can carry several different-colored piles at once, only
   *  meaningful on the battlefield. Never an empty array — absent instead once the last pile is removed. */
  counters?: CounterPile[]
  /** Independent power/toughness counter piles (e.g. a +1/+1 stack and a separate -1/-1 stack) —
   *  power and toughness move together within a pile, only meaningful on the battlefield. Never
   *  an empty array — absent instead once the last pile is removed. */
  ptCounters?: PtCounterPile[]
  /** True once flipped to its back face (transform/MDFC/flip cards only) — only meaningful on the battlefield. */
  showBackFace?: boolean
  /** Set when this card was given by another player: the owning player's seat (shown as an owner-color ring). */
  ownerSeat?: Seat
  /** Played (or turned) face down — its identity is hidden from every other player until
   *  flipped back up (SET_FACE_DOWN), only meaningful on the battlefield. Unlike showBackFace
   *  (a double-faced card's own printed back), this hides the card entirely behind a generic
   *  back — see toPublicCard, which masks scryfallId on the wire while this is true. */
  faceDown?: boolean
  /** Set once at game start (see buildStartingCards) for cards that began in the command zone —
   *  persists across zone changes (unlike counters/showBackFace/faceDown, which are battlefield-
   *  only and reset on leaving it) since a card's commander identity never changes mid-game. */
  isCommander?: boolean
  /** Commander tax paid so far — +2 per previous cast from the command zone, in real Magic.
   *  Only meaningful when isCommander is true. Tracked regardless of the card's current zone
   *  (command or battlefield) and never reset except by a fresh START_GAME. */
  commanderTax?: number
  /** Quadrant this card currently renders in, when another player has dragged it onto a
   *  DIFFERENT seat's battlefield than its owner's own (see RECEIVE_RELOCATED_CARD) — the
   *  "move any card anywhere" feature, distinct from ownerSeat (who owns/controls it). x/y
   *  stay relative to this seat's origin, not the owner's, when set. Undefined means the
   *  card's own natural seat (mySeatResolved for our own cards), the common case. */
  atSeat?: Seat
}

export type GameState = {
  /**
   * Array order is the within-zone ordering: the first library card in the
   * array is the top of the library; battlefield cards later in the array
   * render on top of earlier ones.
   */
  cards: GameCard[]
  life: number
  /**
   * Commander damage this player has taken, keyed by the *source* — the seat of the
   * opponent whose commander dealt it (real Commander rules: 21 from any single
   * commander is lethal, so it must be tracked per source, not as one total). Solo
   * play uses the single synthetic key `SOLO_CMDR_SOURCE`.
   */
  commanderDamage: Record<number, number>
  poison: number
  turn: number
  mulligans: number
  startingLife: number
  /** Persistent "play with the top card of your library revealed" toggle — purely a local display
   *  preference (never shared: hand/library contents stay private, same as always). */
  revealTopOfLibrary: boolean
  /** Deliberate exception to the hand's usual privacy: when true, the whole hand's card identities
   *  are included in this client's PublicBoard broadcast (see toPublicBoard) instead of just
   *  handCount. Teaching/"okay look what I've got" moment, not a permanent state — defaults off
   *  and resets on START_GAME like revealTopOfLibrary. */
  revealHand: boolean
  /** Voluntarily conceded ("Scoop") — combines with life<=0 into the same "eliminated" concept
   *  everywhere it's checked (see PlaytestView's isEliminated); never reset except a fresh
   *  START_GAME. There's no "unscoop" — Ctrl+Z (see gameReducer's RESTORE_STATE) covers a misclick. */
  scooped: boolean
}

export type GameAction =
  | {
      type: 'START_GAME'
      cards: Pick<GameCard, 'instanceId' | 'scryfallId' | 'zone' | 'isCommander' | 'commanderTax'>[]
      startingLife: number
    }
  | { type: 'DRAW'; count?: number }
  /** Caller shuffles hand+library together and passes the new library order (a permutation of those instanceIds). */
  | { type: 'MULLIGAN'; shuffledOrder: string[] }
  /** Reshuffles just the library — used after searching it (a tutor effect), since real Magic requires
   *  shuffling afterward. Caller passes a shuffled permutation of the current library instanceIds. */
  | { type: 'SHUFFLE_LIBRARY'; shuffledOrder: string[] }
  /** Reorders the hand — "Sort by cost" and manual drag-to-reorder within the hand fan both just
   *  compute a full new hand order and dispatch this, same shape as SHUFFLE_LIBRARY above. Caller
   *  passes every current hand instanceId in the desired new order. */
  | { type: 'REORDER_HAND'; orderedInstanceIds: string[] }
  /** `faceDown`, if given, sets the card's face-down status as it lands on the battlefield (e.g.
   *  playing a card from hand face down) instead of just carrying over whatever it was before. */
  | { type: 'MOVE_CARD'; instanceId: string; toZone: GameZone; x?: number; y?: number; libraryPosition?: 'top' | 'bottom'; faceDown?: boolean }
  | { type: 'SET_POSITION'; instanceId: string; x: number; y: number }
  /** Clones a battlefield card's scryfallId/art as a token, also on the battlefield. */
  | { type: 'CREATE_TOKEN'; sourceInstanceId: string; x: number; y: number }
  /** Adds a fresh token onto the battlefield from a Scryfall id (a token the deck can make,
   *  not a clone of a card already in play). Caller must ensure the snapshot is cached. */
  | { type: 'ADD_TOKEN'; scryfallId: string; x: number; y: number }
  /** Creates a new generic counter pile of the given color, starting at 1. */
  | { type: 'ADD_COUNTER_PILE'; instanceId: string; color: CounterColor }
  | { type: 'ADJUST_COUNTER_PILE'; instanceId: string; pileId: string; delta: number }
  | { type: 'REMOVE_COUNTER_PILE'; instanceId: string; pileId: string }
  /** Creates a new power/toughness counter pile of the given color, starting at +1/+1 — nudge
   *  power and toughness independently afterward via ADJUST_PT_COUNTER_PILE to represent an
   *  asymmetric bonus (e.g. an Equipment's +1/+0). */
  | { type: 'ADD_PT_COUNTER_PILE'; instanceId: string; color: CounterColor }
  /** Power and toughness move independently — e.g. {powerDelta: 0, toughnessDelta: -1} turns a
   *  +1/+1 pile into +1/+0, representing an asymmetric bonus a symmetric +1/+1-style counter
   *  can't (Equipment, "gets +2/+0" effects, etc). Real symmetric +1/+1 counters just pass the
   *  same value for both. */
  | { type: 'ADJUST_PT_COUNTER_PILE'; instanceId: string; pileId: string; powerDelta: number; toughnessDelta: number }
  | { type: 'REMOVE_PT_COUNTER_PILE'; instanceId: string; pileId: string }
  | { type: 'FLIP_CARD'; instanceId: string }
  | { type: 'SET_FACE_DOWN'; instanceId: string; faceDown: boolean }
  | { type: 'SET_TAPPED'; instanceId: string; tapped: boolean }
  | { type: 'UNTAP_ALL' }
  | { type: 'ADJUST_LIFE'; delta: number }
  /** `fromSeat` is the source seat whose commander dealt the damage (or SOLO_CMDR_SOURCE in solo). */
  | { type: 'ADJUST_COMMANDER_DAMAGE'; fromSeat: number; delta: number }
  | { type: 'ADJUST_POISON'; delta: number }
  /** Commander tax paid so far for one commander — clamped at 0, tracked regardless of the
   *  card's current zone (unlike the counter piles above, which are battlefield-only). */
  | { type: 'ADJUST_COMMANDER_TAX'; instanceId: string; delta: number }
  | { type: 'NEXT_TURN' }
  /** Removes a card entirely — used by the giver once a card is handed to another player. */
  | { type: 'REMOVE_CARD'; instanceId: string }
  /** Adds a card handed over by another player onto our battlefield (we're now its controller). */
  | { type: 'RECEIVE_GIVEN_CARD'; card: GivenCard }
  /** Another player repositioned one of our own cards on the shared table — reposition it
   *  locally, same as SET_POSITION but triggered remotely instead of by our own drag. `atSeat`
   *  is the quadrant it was dropped into (undefined = back to our own natural seat). */
  | { type: 'RECEIVE_RELOCATED_CARD'; instanceId: string; x: number; y: number; atSeat?: Seat }
  | { type: 'TOGGLE_REVEAL_TOP' }
  | { type: 'TOGGLE_REVEAL_HAND' }
  /** Single-level undo: replaces the whole state wholesale with a snapshot taken just before the
   *  last dispatched action (see PlaytestView's dispatch wrapper) — a misclick fix, not a semantic
   *  game action, so it bypasses every other case here entirely. */
  | { type: 'RESTORE_STATE'; state: GameState }
  /** Voluntary concede ("Scoop") — see GameState.scooped. */
  | { type: 'SCOOP' }

export const OPENING_HAND_SIZE = 7

/** Commander-damage source key used in solo play, where there are no opposing seats. */
export const SOLO_CMDR_SOURCE = -1

/** Highest commander damage taken from any single source — the value the 21-is-lethal rule cares about. */
export function maxCommanderDamage(commanderDamage: Record<number, number>): number {
  return Math.max(0, ...Object.values(commanderDamage))
}

export function zoneCards(state: GameState, zone: GameZone): GameCard[] {
  return state.cards.filter((c) => c.zone === zone)
}

function drawCards(cards: GameCard[], count: number): GameCard[] {
  // Library order is array order, so "the top N" are simply the first N
  // library-zone cards encountered.
  let remaining = count
  return cards.map((c) => {
    if (c.zone !== 'library' || remaining <= 0) return c
    remaining--
    return { ...c, zone: 'hand' as GameZone, tapped: false }
  })
}

function nonTokenCount(cards: GameCard[]): number {
  return cards.filter((c) => !c.isToken).length
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  const next = gameReducerInner(state, action)
  // Dev-only invariant: tokens can come and go freely, but every *non-token*
  // card is one of the deck's real copies, so their count must be conserved
  // by every action except START_GAME and the give/receive handoffs (which
  // legitimately move a card between players' states). If this fires, something
  // is duplicating or dropping a real card (see HANDOFF.md playtest backlog #1 —
  // suspected double-dispatch in a drag/drop onDrop handler).
  const conserves =
    action.type !== 'START_GAME' &&
    action.type !== 'REMOVE_CARD' &&
    action.type !== 'RECEIVE_GIVEN_CARD' &&
    action.type !== 'RESTORE_STATE'
  if (import.meta.env?.DEV && conserves && nonTokenCount(next.cards) !== nonTokenCount(state.cards)) {
    console.error(
      `[gameReducer] non-token card count drifted from ${nonTokenCount(state.cards)} to ${nonTokenCount(next.cards)} after action`,
      action,
    )
  }
  return next
}

function gameReducerInner(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME': {
      const cards: GameCard[] = action.cards.map((c) => ({ ...c, tapped: false }))
      return {
        cards: drawCards(cards, OPENING_HAND_SIZE),
        life: action.startingLife,
        commanderDamage: {},
        poison: 0,
        turn: 1,
        mulligans: 0,
        startingLife: action.startingLife,
        revealTopOfLibrary: false,
        revealHand: false,
        scooped: false,
      }
    }

    case 'DRAW':
      return { ...state, cards: drawCards(state.cards, action.count ?? 1) }

    case 'MULLIGAN': {
      // London mulligan: always draw back up to a full opening hand — the shrinking is the
      // player's own responsibility (they put `mulligans` cards on the bottom once they decide
      // to keep), not something this reducer enforces automatically.
      const orderIndex = new Map(action.shuffledOrder.map((id, index) => [id, index]))
      const shuffled = state.cards.filter((c) => orderIndex.has(c.instanceId))
      const rest = state.cards.filter((c) => !orderIndex.has(c.instanceId))
      shuffled.sort((a, b) => orderIndex.get(a.instanceId)! - orderIndex.get(b.instanceId)!)
      const cards = [...shuffled.map((c) => ({ ...c, zone: 'library' as GameZone, tapped: false })), ...rest]
      return { ...state, mulligans: state.mulligans + 1, cards: drawCards(cards, OPENING_HAND_SIZE) }
    }

    case 'SHUFFLE_LIBRARY': {
      const orderIndex = new Map(action.shuffledOrder.map((id, index) => [id, index]))
      const shuffled = state.cards.filter((c) => orderIndex.has(c.instanceId))
      const rest = state.cards.filter((c) => !orderIndex.has(c.instanceId))
      shuffled.sort((a, b) => orderIndex.get(a.instanceId)! - orderIndex.get(b.instanceId)!)
      return { ...state, cards: [...shuffled, ...rest] }
    }

    case 'REORDER_HAND': {
      const orderIndex = new Map(action.orderedInstanceIds.map((id, index) => [id, index]))
      const reordered = state.cards.filter((c) => orderIndex.has(c.instanceId))
      const rest = state.cards.filter((c) => !orderIndex.has(c.instanceId))
      reordered.sort((a, b) => orderIndex.get(a.instanceId)! - orderIndex.get(b.instanceId)!)
      return { ...state, cards: [...reordered, ...rest] }
    }

    case 'MOVE_CARD': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card) return state
      // Tokens are only real while on the battlefield.
      if (card.isToken && action.toZone !== 'battlefield') {
        return { ...state, cards: state.cards.filter((c) => c.instanceId !== action.instanceId) }
      }
      const moved: GameCard = {
        ...card,
        zone: action.toZone,
        // Tap state, position, counters, flipped face, and face-down status only mean
        // something on the battlefield — a permanent that changes zones is a new object in
        // Magic and loses them.
        tapped: action.toZone === 'battlefield' ? card.tapped : false,
        x: action.toZone === 'battlefield' ? action.x : undefined,
        y: action.toZone === 'battlefield' ? action.y : undefined,
        counters: action.toZone === 'battlefield' ? card.counters : undefined,
        ptCounters: action.toZone === 'battlefield' ? card.ptCounters : undefined,
        showBackFace: action.toZone === 'battlefield' ? card.showBackFace : undefined,
        // A card leaving the battlefield is revealed, same as real Magic (a face-down
        // permanent that dies/bounces turns face up).
        faceDown: action.toZone === 'battlefield' ? (action.faceDown ?? card.faceDown) : undefined,
      }
      const rest = state.cards.filter((c) => c.instanceId !== action.instanceId)
      // "Top of library" = before every other card; everything else appends,
      // which doubles as bring-to-front for battlefield drops.
      const cards = action.toZone === 'library' && action.libraryPosition !== 'bottom' ? [moved, ...rest] : [...rest, moved]
      return { ...state, cards }
    }

    case 'SET_POSITION': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      // Re-append so the dragged card renders above overlapping neighbors.
      const rest = state.cards.filter((c) => c.instanceId !== action.instanceId)
      return { ...state, cards: [...rest, { ...card, x: action.x, y: action.y }] }
    }

    case 'CREATE_TOKEN': {
      const source = state.cards.find((c) => c.instanceId === action.sourceInstanceId)
      if (!source || source.zone !== 'battlefield') return state
      const token: GameCard = {
        instanceId: crypto.randomUUID(),
        scryfallId: source.scryfallId,
        zone: 'battlefield',
        tapped: false,
        x: action.x,
        y: action.y,
        isToken: true,
        showBackFace: source.showBackFace,
      }
      return { ...state, cards: [...state.cards, token] }
    }

    case 'ADD_TOKEN': {
      const token: GameCard = {
        instanceId: crypto.randomUUID(),
        scryfallId: action.scryfallId,
        zone: 'battlefield',
        tapped: false,
        x: action.x,
        y: action.y,
        isToken: true,
      }
      return { ...state, cards: [...state.cards, token] }
    }

    case 'ADD_COUNTER_PILE': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      const pile: CounterPile = { id: crypto.randomUUID(), color: action.color, value: 1 }
      return {
        ...state,
        cards: state.cards.map((c) => (c.instanceId === action.instanceId ? { ...c, counters: [...(c.counters ?? []), pile] } : c)),
      }
    }

    case 'ADJUST_COUNTER_PILE': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.instanceId === action.instanceId
            ? { ...c, counters: (c.counters ?? []).map((p) => (p.id === action.pileId ? { ...p, value: p.value + action.delta } : p)) }
            : c,
        ),
      }
    }

    case 'REMOVE_COUNTER_PILE': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.instanceId !== action.instanceId) return c
          const remaining = (c.counters ?? []).filter((p) => p.id !== action.pileId)
          return { ...c, counters: remaining.length > 0 ? remaining : undefined }
        }),
      }
    }

    case 'ADD_PT_COUNTER_PILE': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      const pile: PtCounterPile = { id: crypto.randomUUID(), color: action.color, power: 1, toughness: 1 }
      return {
        ...state,
        cards: state.cards.map((c) => (c.instanceId === action.instanceId ? { ...c, ptCounters: [...(c.ptCounters ?? []), pile] } : c)),
      }
    }

    case 'ADJUST_PT_COUNTER_PILE': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.instanceId === action.instanceId
            ? {
                ...c,
                ptCounters: (c.ptCounters ?? []).map((p) =>
                  p.id === action.pileId
                    ? { ...p, power: p.power + action.powerDelta, toughness: p.toughness + action.toughnessDelta }
                    : p,
                ),
              }
            : c,
        ),
      }
    }

    case 'REMOVE_PT_COUNTER_PILE': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.instanceId !== action.instanceId) return c
          const remaining = (c.ptCounters ?? []).filter((p) => p.id !== action.pileId)
          return { ...c, ptCounters: remaining.length > 0 ? remaining : undefined }
        }),
      }
    }

    case 'FLIP_CARD': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      return {
        ...state,
        cards: state.cards.map((c) => (c.instanceId === action.instanceId ? { ...c, showBackFace: !c.showBackFace } : c)),
      }
    }

    case 'SET_FACE_DOWN': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      return {
        ...state,
        cards: state.cards.map((c) => (c.instanceId === action.instanceId ? { ...c, faceDown: action.faceDown } : c)),
      }
    }

    case 'SET_TAPPED':
      return {
        ...state,
        cards: state.cards.map((c) => (c.instanceId === action.instanceId ? { ...c, tapped: action.tapped } : c)),
      }

    case 'UNTAP_ALL':
      return {
        ...state,
        cards: state.cards.map((c) => (c.zone === 'battlefield' && c.tapped ? { ...c, tapped: false } : c)),
      }

    case 'ADJUST_LIFE':
      return { ...state, life: state.life + action.delta }

    case 'ADJUST_COMMANDER_DAMAGE': {
      const current = state.commanderDamage[action.fromSeat] ?? 0
      return {
        ...state,
        commanderDamage: { ...state.commanderDamage, [action.fromSeat]: Math.max(0, current + action.delta) },
      }
    }

    case 'ADJUST_POISON':
      return { ...state, poison: Math.max(0, state.poison + action.delta) }

    case 'ADJUST_COMMANDER_TAX':
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.instanceId === action.instanceId ? { ...c, commanderTax: Math.max(0, (c.commanderTax ?? 0) + action.delta) } : c,
        ),
      }

    case 'NEXT_TURN':
      return {
        ...state,
        turn: state.turn + 1,
        cards: drawCards(
          state.cards.map((c) => (c.zone === 'battlefield' && c.tapped ? { ...c, tapped: false } : c)),
          1,
        ),
      }

    case 'REMOVE_CARD':
      return { ...state, cards: state.cards.filter((c) => c.instanceId !== action.instanceId) }

    case 'RECEIVE_GIVEN_CARD': {
      const { card } = action
      // Guard against a duplicate delivery re-adding the same instance.
      if (state.cards.some((c) => c.instanceId === card.instanceId)) return state
      const received: GameCard = {
        instanceId: card.instanceId,
        scryfallId: card.scryfallId,
        zone: 'battlefield',
        tapped: card.tapped,
        x: card.x,
        y: card.y,
        counters: card.counters,
        ptCounters: card.ptCounters,
        showBackFace: card.showBackFace,
        isToken: card.isToken,
        ownerSeat: card.ownerSeat,
        faceDown: card.faceDown,
      }
      return { ...state, cards: [...state.cards, received] }
    }

    case 'RECEIVE_RELOCATED_CARD': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      // Re-append so the relocated card renders above overlapping neighbors, same as SET_POSITION.
      const rest = state.cards.filter((c) => c.instanceId !== action.instanceId)
      return { ...state, cards: [...rest, { ...card, x: action.x, y: action.y, atSeat: action.atSeat }] }
    }

    case 'TOGGLE_REVEAL_TOP':
      return { ...state, revealTopOfLibrary: !state.revealTopOfLibrary }

    case 'TOGGLE_REVEAL_HAND':
      return { ...state, revealHand: !state.revealHand }

    case 'RESTORE_STATE':
      return action.state

    case 'SCOOP':
      return { ...state, scooped: true }

    default:
      return state
  }
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * Expands the deck's mainboard into per-copy card instances: commander(s) into
 * the command zone, everything else shuffled into the library. Imported token reference cards
 * are excluded — they're reference material, not real cards to draw, and only ever enter play
 * through the "Create Token" action (see collectDeckTokens/TokenPickerModal).
 */
export function buildStartingCards(
  deck: Deck,
  random: () => number = Math.random,
): Pick<GameCard, 'instanceId' | 'scryfallId' | 'zone' | 'isCommander' | 'commanderTax'>[] {
  const commanders: Pick<GameCard, 'instanceId' | 'scryfallId' | 'zone' | 'isCommander' | 'commanderTax'>[] = []
  const library: Pick<GameCard, 'instanceId' | 'scryfallId' | 'zone'>[] = []
  for (const deckCard of deck.cards) {
    if (deckCard.board !== 'mainboard' || deckCard.isToken) continue
    for (let i = 0; i < deckCard.quantity; i++) {
      if (deckCard.isCommander) {
        commanders.push({
          instanceId: crypto.randomUUID(),
          scryfallId: deckCard.scryfallId,
          zone: 'command',
          isCommander: true,
          commanderTax: 0,
        })
      } else {
        library.push({ instanceId: crypto.randomUUID(), scryfallId: deckCard.scryfallId, zone: 'library' })
      }
    }
  }
  return [...commanders, ...shuffle(library, random)]
}

export function startingLifeFor(deck: Deck): number {
  return deck.format === 'commander' ? 40 : 20
}
