import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type JumpTarget = { scryfallId: string; token: number }

type JumpToCardContextValue = {
  jumpTarget: JumpTarget | null
  jumpToCard: (scryfallId: string) => void
  clearJumpTarget: () => void
}

const JumpToCardContext = createContext<JumpToCardContextValue | null>(null)

export function JumpToCardProvider({ children }: { children: ReactNode }) {
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null)

  // token increments on every call so clicking the same issue twice in a row still
  // re-triggers the scroll/highlight effect in DeckPanel (a plain scryfallId string
  // wouldn't change and so wouldn't re-fire a dependent useEffect).
  const jumpToCard = useCallback((scryfallId: string) => {
    setJumpTarget((prev) => ({ scryfallId, token: (prev?.token ?? 0) + 1 }))
  }, [])

  const clearJumpTarget = useCallback(() => setJumpTarget(null), [])

  return (
    <JumpToCardContext.Provider value={{ jumpTarget, jumpToCard, clearJumpTarget }}>
      {children}
    </JumpToCardContext.Provider>
  )
}

export function useJumpToCardContext(): JumpToCardContextValue {
  const ctx = useContext(JumpToCardContext)
  if (!ctx) throw new Error('useJumpToCardContext must be used within a JumpToCardProvider')
  return ctx
}
