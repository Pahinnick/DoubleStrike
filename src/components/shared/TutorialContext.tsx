import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { TUTORIAL_STEPS, type TutorialStep } from './tutorialSteps'

const TUTORIAL_SEEN_KEY = 'mtgdb:tutorialSeen'

type TutorialContextValue = {
  currentStep: TutorialStep | null
  stepIndex: number
  totalSteps: number
  start: () => void
  next: () => void
  back: () => void
  skip: () => void
}

const TutorialContext = createContext<TutorialContextValue | null>(null)

export function hasSeenTutorial(): boolean {
  return localStorage.getItem(TUTORIAL_SEEN_KEY) === 'true'
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [stepIndex, setStepIndex] = useState<number | null>(null)

  const start = useCallback(() => setStepIndex(0), [])

  // Reaching the end and bailing out early both count as "seen" — a skipped tour
  // shouldn't keep re-auto-starting on every launch, same as finishing it.
  const finish = useCallback(() => {
    localStorage.setItem(TUTORIAL_SEEN_KEY, 'true')
    setStepIndex(null)
  }, [])

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i === null) return i
      if (i + 1 >= TUTORIAL_STEPS.length) {
        localStorage.setItem(TUTORIAL_SEEN_KEY, 'true')
        return null
      }
      return i + 1
    })
  }, [])

  const back = useCallback(() => setStepIndex((i) => (i !== null && i > 0 ? i - 1 : i)), [])

  const value = useMemo<TutorialContextValue>(
    () => ({
      currentStep: stepIndex !== null ? TUTORIAL_STEPS[stepIndex] : null,
      stepIndex: stepIndex ?? 0,
      totalSteps: TUTORIAL_STEPS.length,
      start,
      next,
      back,
      skip: finish,
    }),
    [stepIndex, start, next, back, finish],
  )

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>
}

export function useTutorialContext(): TutorialContextValue {
  const ctx = useContext(TutorialContext)
  if (!ctx) throw new Error('useTutorialContext must be used within a TutorialProvider')
  return ctx
}
