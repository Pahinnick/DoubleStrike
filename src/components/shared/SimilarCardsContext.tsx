import { createContext, useContext, useState, type ReactNode } from 'react'
import type { TaggableCard } from '../../api/scryfallTypes'

type SimilarCardsContextValue = {
  openCard: TaggableCard | null
  setOpenCard: (card: TaggableCard | null) => void
}

const SimilarCardsContext = createContext<SimilarCardsContextValue | null>(null)

export function SimilarCardsProvider({ children }: { children: ReactNode }) {
  const [openCard, setOpenCard] = useState<TaggableCard | null>(null)
  return <SimilarCardsContext.Provider value={{ openCard, setOpenCard }}>{children}</SimilarCardsContext.Provider>
}

export function useSimilarCardsContext(): SimilarCardsContextValue {
  const ctx = useContext(SimilarCardsContext)
  if (!ctx) throw new Error('useSimilarCardsContext must be used within a SimilarCardsProvider')
  return ctx
}
