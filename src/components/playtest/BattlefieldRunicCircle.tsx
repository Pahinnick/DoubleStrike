import { useEffect, useRef, type CSSProperties } from 'react'

// Card is 90×126 (CARD_W_PX/CARD_H_PX in PlaytestView) — both radii sit outside the card's own
// half-width (45) and half-height (63), so the ring reads as surrounding the card rather than
// being mostly hidden behind it.
const OUTER_RADIUS = 78
const INNER_RADIUS = 56
const TICK_COUNT = 8
const OUTER_SPIN_MS = 42000
const INNER_SPIN_MS = 27000

type Point = { x: number; y: number }

type Props = {
  /** Table-space size to fill — same `surface.width`/`surface.height` used to size
   *  .playtest__battlefield-surface (see BattlefieldParticles for why table-space, not viewport). */
  width: number
  height: number
  /** Table-space centers of every card currently on the table (mine + any pod opponents) — one
   *  circle is drawn per point, no proximity/glow math needed at all. */
  glowPoints: Point[]
  /** Overrides the canvas's default `top:0; left:0` (see playtest.css) — used in a pod to
   *  position one instance per seat's quadrant (see PlaytestView's per-seat skin layers). */
  style?: CSSProperties
}

/** A slowly-rotating summoning circle under every card — an outer ring with 8 rune-like ticks
 *  spinning one way, a dashed inner ring spinning the other, and a soft breathing glow. Purely
 *  per-card (no background mesh, no cursor tracking — see the Triangle Glow skins' history for
 *  why the latter was dropped from this whole family), so cost scales with cards in play, not
 *  table size. The only per-frame work is a fixed handful of arcs/lines per card — no caching
 *  needed since there's no proximity computation to cache in the first place. */
export default function BattlefieldRunicCircle({ width, height, glowPoints, style }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }
  const glowPointsRef = useRef(glowPoints)
  glowPointsRef.current = glowPoints

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, width * dpr)
    canvas.height = Math.max(1, height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [width, height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    function drawCircle(p: Point, now: number, accentRgb: string) {
      const outerAngle = (now / OUTER_SPIN_MS) * Math.PI * 2
      const innerAngle = -(now / INNER_SPIN_MS) * Math.PI * 2
      const pulse = 0.75 + 0.25 * Math.sin(now / 1600 + p.x * 0.01)

      // Soft glow first, so the ring strokes drawn after it stay crisp on top.
      const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, OUTER_RADIUS)
      grad.addColorStop(0, `rgba(${accentRgb}, ${0.12 * pulse})`)
      grad.addColorStop(1, `rgba(${accentRgb}, 0)`)
      ctx!.fillStyle = grad
      ctx!.beginPath()
      ctx!.arc(p.x, p.y, OUTER_RADIUS, 0, Math.PI * 2)
      ctx!.fill()

      // Outer ring.
      ctx!.strokeStyle = `rgba(${accentRgb}, ${0.5 * pulse})`
      ctx!.lineWidth = 1.4
      ctx!.beginPath()
      ctx!.arc(p.x, p.y, OUTER_RADIUS, 0, Math.PI * 2)
      ctx!.stroke()

      // Rune ticks around the outer ring, rotating.
      ctx!.save()
      ctx!.translate(p.x, p.y)
      ctx!.rotate(outerAngle)
      ctx!.strokeStyle = `rgba(${accentRgb}, ${0.7 * pulse})`
      ctx!.lineWidth = 2
      ctx!.beginPath()
      for (let i = 0; i < TICK_COUNT; i++) {
        const a = (i / TICK_COUNT) * Math.PI * 2
        ctx!.moveTo(Math.cos(a) * (OUTER_RADIUS - 6), Math.sin(a) * (OUTER_RADIUS - 6))
        ctx!.lineTo(Math.cos(a) * (OUTER_RADIUS + 6), Math.sin(a) * (OUTER_RADIUS + 6))
      }
      ctx!.stroke()
      ctx!.restore()

      // Dashed inner ring, spinning the opposite way.
      ctx!.save()
      ctx!.translate(p.x, p.y)
      ctx!.rotate(innerAngle)
      ctx!.strokeStyle = `rgba(${accentRgb}, ${0.55 * pulse})`
      ctx!.lineWidth = 1.2
      ctx!.setLineDash([10, 8])
      ctx!.beginPath()
      ctx!.arc(0, 0, INNER_RADIUS, 0, Math.PI * 2)
      ctx!.stroke()
      ctx!.restore()
    }

    let frame = 0

    function tick(now: number) {
      const { width: w, height: h } = sizeRef.current
      ctx!.clearRect(0, 0, w, h)

      const points = glowPointsRef.current
      if (points.length === 0) {
        frame = requestAnimationFrame(tick)
        return
      }

      const accentRgb = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '255, 255, 255'
      for (const p of points) drawCircle(p, now, accentRgb)

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas className="playtest__skin-canvas" ref={canvasRef} style={style} />
}
