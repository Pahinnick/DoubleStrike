import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

type CommanderRecommendationsContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
}

const CommanderRecommendationsContext = createContext<CommanderRecommendationsContextValue | null>(null)

/** Shared open/closed state for the EDHREC recommendations modal, so more than one place can raise
 *  it — the Recommended button in the search pane, and a right-click on the deck list's Commanders
 *  header. Mirrors SimilarCardsContext / CategoryRecommendationsContext, except there's nothing to
 *  key on: the modal reads the deck's commanders itself (see hooks/useCommanderNames.ts). */
export function CommanderRecommendationsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const value = useMemo(() => ({ open, setOpen }), [open])
  return <CommanderRecommendationsContext.Provider value={value}>{children}</CommanderRecommendationsContext.Provider>
}

export function useCommanderRecommendationsContext(): CommanderRecommendationsContextValue {
  const context = useContext(CommanderRecommendationsContext)
  if (!context) throw new Error('useCommanderRecommendationsContext must be used within CommanderRecommendationsProvider')
  return context
}
