import { deckReducer, type DeckAction } from './deckReducer'
import type { Deck } from './types'

/**
 * Undo/redo wrapper around deckReducer. `present` is the live deck; `past`/`future` are
 * full deck snapshots (decks are small — a list of card refs — so snapshotting the whole
 * thing is simpler and cheaper than diffing, and sidesteps any per-action inverse logic).
 */
export type DeckHistoryState = {
  past: Deck[]
  present: Deck
  future: Deck[]
}

export type DeckHistoryAction = DeckAction | { type: 'UNDO' } | { type: 'REDO' }

// Caps memory over a long editing session. 50 discrete edits back is well beyond what anyone
// reaches for with Ctrl+Z in practice.
const HISTORY_LIMIT = 50

export function initDeckHistory(deck: Deck): DeckHistoryState {
  return { past: [], present: deck, future: [] }
}

export function deckHistoryReducer(state: DeckHistoryState, action: DeckHistoryAction): DeckHistoryState {
  switch (action.type) {
    case 'UNDO': {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      }
    }

    case 'REDO': {
      if (state.future.length === 0) return state
      const next = state.future[0]
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      }
    }

    case 'LOAD_DECK':
      // Loading/switching/creating/importing a deck starts a fresh history — undo must never
      // cross a deck boundary and resurrect a different deck.
      return initDeckHistory(deckReducer(state.present, action))

    default: {
      const present = deckReducer(state.present, action)
      // deckReducer returns the same reference for no-op actions (e.g. adding a duplicate
      // category). Don't record a history entry — an undo that changes nothing is confusing.
      if (present === state.present) return state
      const past = [...state.past, state.present]
      if (past.length > HISTORY_LIMIT) past.shift()
      // Any new edit invalidates the redo stack (standard undo semantics).
      return { past, present, future: [] }
    }
  }
}
