import { useEffect } from 'react'

const RADIUS = 140
const SELECTOR = 'button'

/** Makes every button in the app glow brighter the closer the cursor gets to it (not just on
 *  hover — a real distance-based falloff), by writing a --glow (0..1) custom property that
 *  index.css's `:root[data-theme='vaporwave'] button` rule turns into box-shadow/brightness.
 *  One rAF-throttled listener drives every button, so the cost stays flat regardless of how
 *  many are on screen at once. Only active for the Vaporwave theme — `enabled` should be
 *  `theme === 'vaporwave'`. */
export function useProximityGlow(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let frame = 0

    function update(x: number, y: number) {
      const buttons = document.querySelectorAll<HTMLElement>(SELECTOR)
      buttons.forEach((el) => {
        const rect = el.getBoundingClientRect()
        const nearestX = Math.max(rect.left, Math.min(x, rect.right))
        const nearestY = Math.max(rect.top, Math.min(y, rect.bottom))
        const dist = Math.hypot(x - nearestX, y - nearestY)
        const glow = Math.max(0, 1 - dist / RADIUS)
        el.style.setProperty('--glow', glow.toFixed(3))
      })
    }

    function onMove(event: MouseEvent) {
      if (frame) return
      const { clientX, clientY } = event
      frame = requestAnimationFrame(() => {
        frame = 0
        update(clientX, clientY)
      })
    }

    function onLeave() {
      document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => el.style.setProperty('--glow', '0'))
    }

    window.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      if (frame) cancelAnimationFrame(frame)
      onLeave()
    }
  }, [enabled])
}
