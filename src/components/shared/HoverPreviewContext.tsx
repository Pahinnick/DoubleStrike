import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { TaggableCard } from '../../api/scryfallTypes'
import type { FoilKind } from '../../state/types'
import type { CounterPile, PtCounterPile } from '../playtest/counterFormat'

/** Only battlefield cards (playtest) carry live counters — every other hover source omits this. */
export type HoverCounters = { generic?: CounterPile[]; pt?: PtCounterPile[] }

type HoverState = {
  card: TaggableCard
  point: { x: number; y: number }
  face: 'front' | 'back'
  counters?: HoverCounters
  /** Set only when the source card has a foil shader — the enlarged preview then renders a
   *  FoilShine of its own, positioned by `foilPoint` (the same cursor ratio driving the small
   *  card's own shine, forwarded rather than recomputed since the preview has pointer-events:none). */
  foil?: FoilKind
  foilPoint?: { x: number; y: number }
} | null

export const PREVIEW_SCALE_MIN = 0.6
export const PREVIEW_SCALE_MAX = 2.5
const PREVIEW_SCALE_STEP = 0.1

type HoverPreviewContextValue = {
  hover: HoverState
  setHover: (state: HoverState) => void
  /** Multiplier on the preview's base size — a per-session zoom preference (Alt+scroll while
   *  hovering any card), not per-hover: it persists across cards until changed again. */
  previewScale: number
}

const HoverPreviewContext = createContext<HoverPreviewContextValue | null>(null)

export function HoverPreviewProvider({ children }: { children: ReactNode }) {
  const [hover, setHoverState] = useState<HoverState>(null)
  const [previewScale, setPreviewScale] = useState(1)
  // Wheel listener below is added once (on window, not re-subscribed on every mousemove-driven
  // hover update), so it reads the *current* hover through a ref rather than a stale closure.
  const hoverRef = useRef<HoverState>(null)

  const setHover = useCallback((state: HoverState) => {
    hoverRef.current = state
    setHoverState(state)
  }, [])

  // HTML5 drag-and-drop suppresses normal mouse events for the duration of a
  // drag, so a draggable's own onMouseLeave never fires once a drag starts —
  // the last-hovered preview would otherwise stay pinned until drop. A single
  // capture-phase listener here clears it for every draggable in the app.
  useEffect(() => {
    function clearOnDragStart() {
      setHover(null)
    }
    document.addEventListener('dragstart', clearOnDragStart, true)
    return () => document.removeEventListener('dragstart', clearOnDragStart, true)
  }, [setHover])

  // Alt+scroll while hovering any card resizes the shared preview popup, for readability.
  // Only intercepts the wheel event (preventDefault) when a card is actually being hovered
  // and Alt is held — a plain scroll (no Alt) or a scroll with nothing hovered passes through
  // untouched, so this never fights a scrollable list/grid's normal scrolling.
  useEffect(() => {
    function onWheel(event: WheelEvent) {
      if (!hoverRef.current || !event.altKey) return
      event.preventDefault()
      const direction = event.deltaY < 0 ? 1 : -1
      setPreviewScale((prev) => {
        const next = prev + direction * PREVIEW_SCALE_STEP
        return Math.min(PREVIEW_SCALE_MAX, Math.max(PREVIEW_SCALE_MIN, Math.round(next * 100) / 100))
      })
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  return <HoverPreviewContext.Provider value={{ hover, setHover, previewScale }}>{children}</HoverPreviewContext.Provider>
}

export function useHoverPreviewContext(): HoverPreviewContextValue {
  const ctx = useContext(HoverPreviewContext)
  if (!ctx) throw new Error('useHoverPreviewContext must be used within a HoverPreviewProvider')
  return ctx
}
