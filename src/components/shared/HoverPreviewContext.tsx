import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { TaggableCard } from '../../api/scryfallTypes'
import { useProfiles } from '../../state/ProfileContext'
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
  /** Records which DOM element the current hover actually came from, purely so the
   *  disconnection-watching MutationObserver below knows what to check — not meant for consumers,
   *  see useHoverPreview. Pass null when clearing hover. */
  setHoverElement: (el: Element | null) => void
  /** Multiplier on the preview's base size — a per-session zoom preference (Alt+scroll while
   *  hovering any card), not per-hover: it persists across cards until changed again. */
  previewScale: number
}

const HoverPreviewContext = createContext<HoverPreviewContextValue | null>(null)

export function HoverPreviewProvider({ children }: { children: ReactNode }) {
  const { activeProfile } = useProfiles()
  // 'alt' gates the popup behind holding Alt (chosen so the same held-key gesture that already
  // resizes the preview via Alt+scroll also reveals it — see the settings page and the wheel
  // effect below). 'always' (default) is the app's original always-on-hover behavior.
  const gated = activeProfile?.settings?.hoverPreviewMode === 'alt'
  const gatedRef = useRef(gated)
  gatedRef.current = gated

  const [hover, setHoverState] = useState<HoverState>(null)
  const [previewScale, setPreviewScale] = useState(1)
  // Wheel listener below is added once (on window, not re-subscribed on every mousemove-driven
  // hover update), so it reads the *current* hover through a ref rather than a stale closure.
  const hoverRef = useRef<HoverState>(null)
  // The element the current hover came from — see the MutationObserver below and setHoverElement.
  const hoverElRef = useRef<Element | null>(null)
  // Last hover state actually *attempted* (via setHover below), regardless of whether the alt-gate
  // let it through — so pressing Alt while already hovering something can reveal it immediately,
  // without waiting for the next mousemove to re-attempt it.
  const pendingRef = useRef<HoverState>(null)
  const altHeldRef = useRef(false)

  const setHover = useCallback((state: HoverState) => {
    pendingRef.current = state
    if (gatedRef.current && state !== null && !altHeldRef.current) {
      // Gated and Alt isn't held: never actually reveal it, but keep tracking what's under the
      // cursor (pendingRef) so a later Alt-press can reveal it without another mouse event.
      if (hoverRef.current !== null) {
        hoverRef.current = null
        setHoverState(null)
      }
      return
    }
    hoverRef.current = state
    setHoverState(state)
  }, [])

  // Alt-gated mode only: reveal the currently-hovered card (if any) the instant Alt goes down,
  // and hide it the instant Alt comes back up — rather than waiting for the next mousemove to
  // pass through the gate in setHover above.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Alt' || altHeldRef.current) return
      altHeldRef.current = true
      if (gatedRef.current && pendingRef.current && hoverElRef.current?.isConnected) {
        hoverRef.current = pendingRef.current
        setHoverState(pendingRef.current)
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== 'Alt') return
      altHeldRef.current = false
      if (gatedRef.current) {
        hoverRef.current = null
        setHoverState(null)
      }
    }
    // A held Alt whose keyup gets swallowed by the OS (classic case: Alt-tabbing away) would
    // otherwise leave the preview stuck visible forever in gated mode.
    function onWindowBlur() {
      altHeldRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [])

  const setHoverElement = useCallback((el: Element | null) => {
    hoverElRef.current = el
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

  // The same "no mouseleave fires" problem as the dragstart case above, but for a different
  // trigger: clicking a card to delete or play it removes that exact DOM node — out from under a
  // cursor that never actually moved — as a direct result of the click. The browser has nothing
  // to fire a mouseleave over, since as far as it's concerned the pointer never left the element;
  // the element just isn't there anymore. Rather than patching every individual click handler that
  // can remove a hovered card (deck row "Remove", playing a hand card, moving a battlefield card
  // to a zone, etc. — an easy list to grow and easy to miss one of), watch broadly: whenever
  // anything in the document changes, check whether the element the current hover came from is
  // still actually attached, and clear the preview if not.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (hoverElRef.current && !hoverElRef.current.isConnected) setHover(null)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
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

  return (
    <HoverPreviewContext.Provider value={{ hover, setHover, setHoverElement, previewScale }}>
      {children}
    </HoverPreviewContext.Provider>
  )
}

export function useHoverPreviewContext(): HoverPreviewContextValue {
  const ctx = useContext(HoverPreviewContext)
  if (!ctx) throw new Error('useHoverPreviewContext must be used within a HoverPreviewProvider')
  return ctx
}
