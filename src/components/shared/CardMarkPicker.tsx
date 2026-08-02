import { useEffect, useRef } from 'react'

/** Free-form flagging palette — deliberately distinct from Magic's WUBRG mana colors (this marks
 *  arbitrary player notes like "already drawn" or "combo piece", not color identity). */
export const CARD_MARK_COLORS = ['#e5484d', '#f5a623', '#f2d347', '#3fb950', '#4a90e2', '#9b59b6']

type Props = {
  onPick: (color: string) => void
  onClose: () => void
}

/** Tiny color-swatch popover, positioned by its parent (see CardMarkChip's own position:relative
 *  wrapper) — same dismiss-on-outside-interaction/Escape pattern as CardContextMenu, just picking
 *  one of a fixed small palette instead of a list of text actions. */
function CardMarkPicker({ onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function dismissIfOutside(event: Event) {
      if (ref.current?.contains(event.target as Node)) return
      onClose()
    }
    // Skip the dismiss listeners for the event that opened this popover (a click/contextmenu
    // fired this same tick would otherwise close it immediately) — same trick as CardContextMenu.
    const id = requestAnimationFrame(() => {
      window.addEventListener('pointerdown', dismissIfOutside)
      window.addEventListener('contextmenu', dismissIfOutside)
    })
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('pointerdown', dismissIfOutside)
      window.removeEventListener('contextmenu', dismissIfOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div ref={ref} className="card-mark-picker" role="menu">
      {CARD_MARK_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="card-mark-picker__swatch"
          style={{ backgroundColor: color }}
          onClick={() => onPick(color)}
          aria-label={`Mark with ${color}`}
        />
      ))}
    </div>
  )
}

export default CardMarkPicker
