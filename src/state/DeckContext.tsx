import { createContext, useContext, type Dispatch } from 'react'
import type { ScryfallCard } from '../api/scryfallTypes'
import type { DeckAction } from './deckReducer'
import type { Board, Deck } from './types'

export type DeckContextValue = {
  deck: Deck
  dispatch: Dispatch<DeckAction>
  addCard: (card: ScryfallCard, board?: Board, category?: string) => void
  setCardPrinting: (card: ScryfallCard, fromScryfallId: string, board: Board) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export const DeckContext = createContext<DeckContextValue | null>(null)

export function useDeck(): DeckContextValue {
  const ctx = useContext(DeckContext)
  if (!ctx) throw new Error('useDeck must be used within a DeckWorkspaceProvider')
  return ctx
}
