import type { CounterColor, CounterPile, GivenCard, PtCounterPile, Seat } from '../net/protocol'
import type { ManaColorKey } from '../utils/colors'
import { zeroManaPool } from '../utils/colors'
import type { Deck } from './types'

export type GameZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command'

/** Which side of the hand fan a freshly-drawn card lands on — a persisted per-profile preference
 *  (see useProfileSettings' handDrawSide), threaded through at dispatch time rather than snapshot
 *  into GameState, so changing it takes effect on the very next draw instead of only the next new
 *  game. Left (the original, default behavior) prepends; right appends — see drawCards. */
export type HandDrawSide = 'left' | 'right'

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
  /** The PRIVATE half of Magic's two different top-of-library effects: "you may look at the top
   *  card of your library any time" (Vizier of the Menagerie, Realmwalker…). Shows the card to
   *  YOU only — purely a local display preference, never shared, same as hand/library contents
   *  always have been. Its public counterpart is `revealTopToPod` below; the two are independent
   *  because the effects granting them are independent, and a card can grant either one.
   *
   *  Kept under this name (rather than renamed to something like `lookAtTopOfLibrary`) on
   *  purpose: it's persisted in autosaves (see storage/soloGameStorage.ts), so repurposing the
   *  name would make an existing save's private peek come back as a public reveal. */
  revealTopOfLibrary: boolean
  /** The PUBLIC half: "play with the top card of your library revealed" (Future Sight, Oracle of
   *  Mul Daya, Bolas's Citadel…), where the card is open information for the whole table. When
   *  true, the top card rides along in this client's PublicBoard broadcast (see toPublicBoard)
   *  so every other seat can see it, exactly like `revealHand` does for the hand. Defaults off
   *  and resets on START_GAME. Implies you can see it too, naturally. */
  revealTopToPod: boolean
  /** Deliberate exception to the hand's usual privacy: when true, the whole hand's card identities
   *  are included in this client's PublicBoard broadcast (see toPublicBoard) instead of just
   *  handCount. Teaching/"okay look what I've got" moment, not a permanent state — defaults off
   *  and resets on START_GAME like revealTopOfLibrary. */
  revealHand: boolean
  /** Voluntarily conceded ("Scoop") — combines with life<=0 into the same "eliminated" concept
   *  everywhere it's checked (see PlaytestView's isEliminated); never reset except a fresh
   *  START_GAME. There's no "unscoop" — Ctrl+Z (see gameReducer's RESTORE_STATE) covers a misclick. */
  scooped: boolean
  /** Mana currently "floating" — generated but not yet spent, tracked per color so a big mana
   *  turn (ritual + rocks + dorks, easily double digits) doesn't have to be kept in your head.
   *  Real Magic empties this between turns (mana doesn't carry over), so NEXT_TURN resets it to
   *  all zero same as START_GAME; CLEAR_FLOATING_MANA (a manual "spent it all" button) does the
   *  same thing mid-turn without waiting for the turn to pass. */
  floatingMana: Record<ManaColorKey, number>
}

export type GameAction =
  | {
      type: 'START_GAME'
      cards: Pick<GameCard, 'instanceId' | 'scryfallId' | 'zone' | 'isCommander' | 'commanderTax'>[]
      startingLife: number
    }
  | { type: 'DRAW'; count?: number; toSide?: HandDrawSide }
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
   *  playing a card from hand face down) instead of just carrying over whatever it was before.
   *  `atSeat`, if given, lands the card directly in another player's quadrant (e.g. playing a
   *  hand card by dropping it onto someone else's board) while it's still ours — same "move any
   *  card anywhere, ownership unaffected" convention as RECEIVE_RELOCATED_CARD's `atSeat`. */
  | {
      type: 'MOVE_CARD'
      instanceId: string
      toZone: GameZone
      x?: number
      y?: number
      libraryPosition?: 'top' | 'bottom'
      faceDown?: boolean
      atSeat?: Seat
    }
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
  /** Moves a whole generic counter pile from one battlefield card to another (drag the chip onto
   *  the target — see CounterPileStack). Merges into a same-color pile already there, matching
   *  ADD_COUNTER_PILE's own "a card can carry multiple differently-colored piles" model rather
   *  than ever stacking two same-color piles side by side. */
  | { type: 'MOVE_COUNTER_PILE'; fromInstanceId: string; pileId: string; toInstanceId: string }
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
  /** Power/toughness counterpart to MOVE_COUNTER_PILE — merges into a same-color pt pile already
   *  on the target by summing power and toughness separately, consistent with
   *  ADJUST_PT_COUNTER_PILE treating them as independent stats. */
  | { type: 'MOVE_PT_COUNTER_PILE'; fromInstanceId: string; pileId: string; toInstanceId: string }
  /** Stamps a copied set of piles onto a card — the paste half of copy/paste counters, for
   *  replicating a counter layout across several cards without rebuilding it by hand each time.
   *  Adds to whatever's already there rather than replacing it, merging into same-color piles
   *  exactly like MOVE_COUNTER_PILE/MOVE_PT_COUNTER_PILE do, so pasting can't silently wipe
   *  counters the target already had. Pasted piles get fresh ids: the source card keeps its own,
   *  and two cards never end up sharing a pile id. */
  | { type: 'PASTE_COUNTER_PILES'; instanceId: string; counters: CounterPile[]; ptCounters: PtCounterPile[] }
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
  | { type: 'NEXT_TURN'; toSide?: HandDrawSide }
  /** Removes a card entirely — used by the giver once a card is handed to another player. */
  | { type: 'REMOVE_CARD'; instanceId: string }
  /** Adds a card handed over by another player onto our battlefield (we're now its controller). */
  | { type: 'RECEIVE_GIVEN_CARD'; card: GivenCard }
  /** Another player repositioned one of our own cards on the shared table — reposition it
   *  locally, same as SET_POSITION but triggered remotely instead of by our own drag. `atSeat`
   *  is the quadrant it was dropped into (undefined = back to our own natural seat). */
  | { type: 'RECEIVE_RELOCATED_CARD'; instanceId: string; x: number; y: number; atSeat?: Seat }
  | { type: 'TOGGLE_REVEAL_TOP' }
  /** Public counterpart to TOGGLE_REVEAL_TOP — see GameState.revealTopToPod. */
  | { type: 'TOGGLE_REVEAL_TOP_TO_POD' }
  | { type: 'TOGGLE_REVEAL_HAND' }
  /** Single-level undo: replaces the whole state wholesale with a snapshot taken just before the
   *  last dispatched action (see PlaytestView's dispatch wrapper) — a misclick fix, not a semantic
   *  game action, so it bypasses every other case here entirely. */
  | { type: 'RESTORE_STATE'; state: GameState }
  /** Voluntary concede ("Scoop") — see GameState.scooped. */
  | { type: 'SCOOP' }
  /** Adjust one color's floating mana by `delta` — left-click +1/right-click -1 on a mana pip
   *  (see ManaPool.tsx). Clamped at 0, same as ADJUST_POISON: floating mana can't go negative. */
  | { type: 'ADJUST_FLOATING_MANA'; color: ManaColorKey; delta: number }
  /** Zeroes every color at once — the manual "I've spent it all" button, for when clicking each
   *  color down individually would be tedious. See GameState.floatingMana for the automatic
   *  every-color-empties-on-NEXT_TURN behavior this complements. */
  | { type: 'CLEAR_FLOATING_MANA' }

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

function drawCards(cards: GameCard[], count: number, toSide: HandDrawSide = 'left'): GameCard[] {
  // Library order is array order, so "the top N" are simply the first N
  // library-zone cards encountered. Pulled out and re-inserted at one end (rather than left in
  // place, which used to strand a newly drawn card wherever its original deck-list position
  // happened to fall relative to the rest of the hand) so a draw always lands in the same hand
  // slot every time — array order is render order for the hand fan (see PlaytestView's
  // `hand.map`). Which end is `toSide` — see HandDrawSide's doc.
  let remaining = count
  const drawn: GameCard[] = []
  const rest: GameCard[] = []
  for (const c of cards) {
    if (c.zone === 'library' && remaining > 0) {
      remaining--
      drawn.push({ ...c, zone: 'hand' as GameZone, tapped: false })
    } else {
      rest.push(c)
    }
  }
  return toSide === 'right' ? [...rest, ...drawn] : [...drawn, ...rest]
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

/**
 * Untaps the battlefield permanents this player actually CONTROLS — the untap step's real rule
 * in Magic is "permanents you control", not "permanents you own", and those come apart here.
 *
 * A card of ours with `atSeat` set is sitting on someone else's battlefield (see GameCard.atSeat;
 * it's normalized back to undefined the moment the card returns to our own quadrant, so a set
 * value always means "not on our seat"). Whoever's board it's on controls it, so it untaps on
 * THEIR untap step, not ours — previously our own untap swept it up from across the table while
 * their untap couldn't touch it at all, since it lives in our state rather than theirs. The
 * controller's side of that is handled over the wire (see PlaytestView's untapAll/Next Turn,
 * which send a directed TAP_CARD to the owner for each foreign card on their quadrant).
 */
function untapControlled(cards: GameCard[]): GameCard[] {
  return cards.map((c) => (c.zone === 'battlefield' && c.tapped && c.atSeat === undefined ? { ...c, tapped: false } : c))
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
        revealTopToPod: false,
        revealHand: false,
        scooped: false,
        floatingMana: zeroManaPool(),
      }
    }

    case 'DRAW':
      return { ...state, cards: drawCards(state.cards, action.count ?? 1, action.toSide) }

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
        atSeat: action.toZone === 'battlefield' ? action.atSeat : undefined,
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
      // Clearing atSeat is what brings a card HOME. This action means "I dropped this on my own
      // quadrant" — its only dispatcher is the drop handler's own-quadrant fallback, which
      // computes x/y against our own seat origin. Preserving atSeat through the spread meant
      // dragging a card you'd previously parked on someone else's board back onto your own just
      // moved it around THEIR quadrant instead (new coordinates, still drawn at their origin),
      // so it looked like your card refused to come back. A move that really is meant to land at
      // another seat goes through RECEIVE_RELOCATED_CARD, which takes atSeat explicitly.
      return { ...state, cards: [...rest, { ...card, x: action.x, y: action.y, atSeat: undefined }] }
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

    case 'MOVE_COUNTER_PILE': {
      if (action.fromInstanceId === action.toInstanceId) return state
      const fromCard = state.cards.find((c) => c.instanceId === action.fromInstanceId)
      const toCard = state.cards.find((c) => c.instanceId === action.toInstanceId)
      if (!fromCard || fromCard.zone !== 'battlefield' || !toCard || toCard.zone !== 'battlefield') return state
      const pile = (fromCard.counters ?? []).find((p) => p.id === action.pileId)
      if (!pile) return state
      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.instanceId === action.fromInstanceId) {
            const remaining = (c.counters ?? []).filter((p) => p.id !== action.pileId)
            return { ...c, counters: remaining.length > 0 ? remaining : undefined }
          }
          if (c.instanceId === action.toInstanceId) {
            const existing = (c.counters ?? []).find((p) => p.color === pile.color)
            const counters = existing
              ? (c.counters ?? []).map((p) => (p.id === existing.id ? { ...p, value: p.value + pile.value } : p))
              : [...(c.counters ?? []), pile]
            return { ...c, counters }
          }
          return c
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

    case 'MOVE_PT_COUNTER_PILE': {
      if (action.fromInstanceId === action.toInstanceId) return state
      const fromCard = state.cards.find((c) => c.instanceId === action.fromInstanceId)
      const toCard = state.cards.find((c) => c.instanceId === action.toInstanceId)
      if (!fromCard || fromCard.zone !== 'battlefield' || !toCard || toCard.zone !== 'battlefield') return state
      const pile = (fromCard.ptCounters ?? []).find((p) => p.id === action.pileId)
      if (!pile) return state
      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.instanceId === action.fromInstanceId) {
            const remaining = (c.ptCounters ?? []).filter((p) => p.id !== action.pileId)
            return { ...c, ptCounters: remaining.length > 0 ? remaining : undefined }
          }
          if (c.instanceId === action.toInstanceId) {
            const existing = (c.ptCounters ?? []).find((p) => p.color === pile.color)
            const ptCounters = existing
              ? (c.ptCounters ?? []).map((p) =>
                  p.id === existing.id ? { ...p, power: p.power + pile.power, toughness: p.toughness + pile.toughness } : p,
                )
              : [...(c.ptCounters ?? []), pile]
            return { ...c, ptCounters }
          }
          return c
        }),
      }
    }

    case 'PASTE_COUNTER_PILES': {
      const card = state.cards.find((c) => c.instanceId === action.instanceId)
      if (!card || card.zone !== 'battlefield') return state
      if (action.counters.length === 0 && action.ptCounters.length === 0) return state

      // Same "merge into a same-color pile, otherwise append" rule the MOVE_*_COUNTER_PILE cases
      // above use, so a pasted pile behaves like one dragged across rather than inventing a
      // second, competing pile of a color the card already carries.
      let counters = [...(card.counters ?? [])]
      for (const pile of action.counters) {
        const existing = counters.find((p) => p.color === pile.color)
        counters = existing
          ? counters.map((p) => (p.id === existing.id ? { ...p, value: p.value + pile.value } : p))
          : [...counters, { ...pile, id: crypto.randomUUID() }]
      }

      let ptCounters = [...(card.ptCounters ?? [])]
      for (const pile of action.ptCounters) {
        const existing = ptCounters.find((p) => p.color === pile.color)
        ptCounters = existing
          ? ptCounters.map((p) =>
              p.id === existing.id ? { ...p, power: p.power + pile.power, toughness: p.toughness + pile.toughness } : p,
            )
          : [...ptCounters, { ...pile, id: crypto.randomUUID() }]
      }

      return {
        ...state,
        cards: state.cards.map((c) =>
          c.instanceId === action.instanceId
            ? {
                ...c,
                // Kept absent rather than an empty array when there's nothing, matching the
                // convention the other counter cases hold to (see GameCard.counters).
                counters: counters.length > 0 ? counters : undefined,
                ptCounters: ptCounters.length > 0 ? ptCounters : undefined,
              }
            : c,
        ),
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
      return { ...state, cards: untapControlled(state.cards) }

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
        cards: drawCards(untapControlled(state.cards), 1, action.toSide),
        // Real Magic: mana doesn't carry over between turns.
        floatingMana: zeroManaPool(),
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

    case 'TOGGLE_REVEAL_TOP_TO_POD':
      return { ...state, revealTopToPod: !state.revealTopToPod }

    case 'TOGGLE_REVEAL_HAND':
      return { ...state, revealHand: !state.revealHand }

    case 'RESTORE_STATE':
      // `action.state` isn't always this session's own live state — it's also how a solo
      // autosave (see soloGameStorage.ts) re-enters the reducer, and that snapshot can be older
      // than a since-added GameState field. floatingMana is the first field here whose absence
      // actually crashes (a plain `undefined` boolean like scooped/revealHand fails open, but
      // ManaPool indexes straight into this one), so patch it in rather than trusting every
      // persisted save to already have it. Falls back to returning `action.state` completely
      // unchanged (same reference) whenever it already has the field — every same-session
      // caller (undo, a fresh autosave) does — so this stays a true no-op there.
      return action.state.floatingMana ? action.state : { ...action.state, floatingMana: zeroManaPool() }

    case 'SCOOP':
      return { ...state, scooped: true }

    case 'ADJUST_FLOATING_MANA':
      return {
        ...state,
        floatingMana: { ...state.floatingMana, [action.color]: Math.max(0, state.floatingMana[action.color] + action.delta) },
      }

    case 'CLEAR_FLOATING_MANA':
      return { ...state, floatingMana: zeroManaPool() }

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
