import { useCallback, useEffect, useState } from 'react'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A panel's user-resized width in px, persisted to localStorage (one value per `key`, shared
 *  across sessions the same way useCardSize persists its own preference — not per-profile, since
 *  this is a layout preference tied to the device/window, not the deck data). `adjustBy` takes a
 *  signed delta rather than an absolute width so callers (drag handlers, keyboard steps) never
 *  need to read the current value back out first — see PanelResizer's own delta-per-event
 *  contract, which this is designed to plug straight into. */
export function usePanelWidth(key: string, defaultWidth: number, min: number, max: number): [number, (deltaPx: number) => void] {
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(key))
    return stored > 0 && Number.isFinite(stored) ? clamp(stored, min, max) : defaultWidth
  })

  useEffect(() => {
    localStorage.setItem(key, String(width))
  }, [key, width])

  const adjustBy = useCallback(
    (deltaPx: number) => {
      setWidth((prev) => clamp(prev + deltaPx, min, max))
    },
    [min, max],
  )

  return [width, adjustBy]
}
