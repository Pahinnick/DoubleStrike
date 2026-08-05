import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTutorialContext } from './TutorialContext'
import './tutorial.css'

const TOOLTIP_WIDTH = 320
// Only used to pick a side and clamp within the viewport — the real height is dynamic (varies
// with body text length), so this is deliberately generous rather than exact.
const TOOLTIP_HEIGHT_ESTIMATE = 200
const GAP = 14

/** Picks whichever side of the target has the most room (below/above/right/left, in that
 *  preference order when tied) and clamps the result to the viewport either way — needed because
 *  a couple of targets (the collapsed Search/Stats tabs) are full-height edge sidebars, so a
 *  naive "below the rect" placement pushes the tooltip off-screen entirely for those. */
function tooltipPosition(rect: DOMRect): CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const spaceBelow = vh - rect.bottom
  const spaceAbove = rect.top
  const spaceRight = vw - rect.right
  const spaceLeft = rect.left
  const clampX = (x: number) => Math.min(Math.max(x, GAP), vw - TOOLTIP_WIDTH - GAP)
  const clampY = (y: number) => Math.min(Math.max(y, GAP), vh - TOOLTIP_HEIGHT_ESTIMATE - GAP)

  if (spaceBelow >= TOOLTIP_HEIGHT_ESTIMATE || (spaceBelow >= spaceAbove && spaceBelow >= spaceRight && spaceBelow >= spaceLeft)) {
    return { left: clampX(rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2), top: clampY(rect.bottom + GAP) }
  }
  if (spaceAbove >= TOOLTIP_HEIGHT_ESTIMATE || (spaceAbove >= spaceRight && spaceAbove >= spaceLeft)) {
    return { left: clampX(rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2), top: clampY(rect.top - TOOLTIP_HEIGHT_ESTIMATE - GAP) }
  }
  if (spaceRight >= spaceLeft) {
    return { left: clampX(rect.right + GAP), top: clampY(rect.top + rect.height / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2) }
  }
  return { left: clampX(rect.left - TOOLTIP_WIDTH - GAP), top: clampY(rect.top + rect.height / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2) }
}

/** Renders once, above whichever view (deck editor or Playtest) is currently mounted — see
 *  App.tsx. Finds its target by data-tutorial-id, queried live rather than via ref, since the
 *  target lives in whichever of those two entirely separate component trees is active and can
 *  unmount/remount out from under a step (navigating there is the tour's own job, see
 *  tutorialSteps.ts). Polls via rAF instead of a MutationObserver/ResizeObserver so it
 *  transparently rides out that remount, in-tray open/close animations, and camera moves alike. */
function TutorialOverlay() {
  const { currentStep, stepIndex, totalSteps, next, back, skip } = useTutorialContext()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    setRect(null)
    if (!currentStep) return
    let cancelled = false
    function tick() {
      if (cancelled || !currentStep) return
      const el = document.querySelector(`[data-tutorial-id="${currentStep.target}"]`)
      const found = el ? el.getBoundingClientRect() : null
      setRect((prev) => {
        if (!found) return prev
        if (prev && prev.x === found.x && prev.y === found.y && prev.width === found.width && prev.height === found.height) return prev
        return found
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [currentStep])

  useEffect(() => {
    if (!currentStep) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') skip()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentStep, skip])

  if (!currentStep) return null

  const isLast = stepIndex === totalSteps - 1
  const tooltipStyle: CSSProperties = rect ? tooltipPosition(rect) : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }

  return (
    <div className="tutorial-overlay">
      {rect && (
        <div
          className="tutorial-overlay__spotlight"
          style={{ left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16 }}
        />
      )}
      <div className="tutorial-overlay__tooltip" style={tooltipStyle} role="dialog" aria-label={currentStep.title}>
        <div className="tutorial-overlay__progress">
          Step {stepIndex + 1} of {totalSteps}
        </div>
        <h3>{currentStep.title}</h3>
        <p>{currentStep.body}</p>
        <div className="tutorial-overlay__actions">
          <button type="button" className="tutorial-overlay__skip" onClick={skip}>
            Skip tour
          </button>
          <div className="tutorial-overlay__nav">
            {stepIndex > 0 && (
              <button type="button" onClick={back}>
                Back
              </button>
            )}
            <button type="button" onClick={next}>
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TutorialOverlay
