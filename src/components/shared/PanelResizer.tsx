import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

const KEYBOARD_STEP_PX = 24

type Props = {
  /** Called with a signed horizontal delta in px — positive means the pointer/keypress moved
   *  right. Fired continuously during a drag (once per pointer move, not once per drag) and once
   *  per arrow-key press, so the caller never needs to track a "drag start" width itself; it can
   *  just add the delta onto whatever width it already has (see usePanelWidth's adjustBy). */
  onAdjust: (deltaPx: number) => void
  /** Screen-reader label for this specific divider, e.g. "Resize search panel". */
  label: string
  /** Hides and disables the handle without unmounting it — used when the panel on one side of
   *  it is collapsed to its icon strip, where there's nothing meaningful left to resize. */
  disabled?: boolean
  /** Bracket an active pointer drag (not fired for a keyboard step) — the caller uses this to
   *  suspend its collapse/expand grid-template-columns transition for the duration, so a
   *  transition meant for the occasional collapse toggle doesn't fight a drag delivering a new
   *  width on every pointer move (each one would restart a fresh 150ms easing toward it,
   *  reading as laggy rubber-banding instead of tracking the cursor directly). */
  onDragStart?: () => void
  onDragEnd?: () => void
}

/** A thin vertical drag handle between two of the deck-editor's side-by-side panels (search,
 *  deck list, stats). Pointer-capture based rather than window-level listeners: once captured,
 *  this element keeps receiving move/up events even when the cursor races ahead of a fast drag
 *  or leaves the handle's own (narrow) hit area, so no separate mount/cleanup effect is needed. */
function PanelResizer({ onAdjust, label, disabled, onDragStart, onDragEnd }: Props) {
  const draggingRef = useRef(false)
  const lastXRef = useRef(0)

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return
    event.preventDefault()
    draggingRef.current = true
    lastXRef.current = event.clientX
    // Capture can throw (e.g. no active pointer with this id) in edge cases outside our control —
    // dragging still works fine without it (just via ordinary bubbling), it only loses the "keep
    // tracking even if the cursor outruns the handle's narrow hit area" guarantee, so don't let a
    // failure here skip onDragStart or abort the rest of the drag.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // ignored — see above
    }
    onDragStart?.()
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    const dx = event.clientX - lastXRef.current
    lastXRef.current = event.clientX
    if (dx !== 0) onAdjust(dx)
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    draggingRef.current = false
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignored — see handlePointerDown's matching try/catch
    }
    onDragEnd?.()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onAdjust(-KEYBOARD_STEP_PX)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onAdjust(KEYBOARD_STEP_PX)
    }
  }

  return (
    <div
      className="app-panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    >
      <span className="app-panel-resizer__grip" aria-hidden="true" />
    </div>
  )
}

export default PanelResizer
