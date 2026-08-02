import { useEffect, useRef, type CSSProperties } from 'react'

// Card is 90×126 (CARD_W_PX/CARD_H_PX in PlaytestView) — both radii sit outside the card's own
// half-width (45) and half-height (63), so the halo reads as surrounding the card rather than
// being mostly hidden behind it (same convention as Runic Circle's OUTER_RADIUS/INNER_RADIUS).
const OUTER_R = 84
const INNER_R = 52
const PETAL_COUNT = 10
// Angular width of each petal's base, as a fraction of the full slot it occupies — leaves a gap
// between neighboring petals so they read as separate faceted shards, not a solid ring.
const PETAL_WIDTH = 0.62
const RING_SPIN_MS = 90000
const HIGHLIGHT_SWEEP_MS = 5200

type Point = { x: number; y: number }

type Props = {
  /** Table-space size to fill — same `surface.width`/`surface.height` used to size
   *  .playtest__battlefield-surface (see BattlefieldParticles for why table-space, not viewport). */
  width: number
  height: number
  /** Table-space centers of every card currently on the table (mine + any pod opponents) — one
   *  shard halo is drawn per point, no proximity/mesh math needed at all. */
  glowPoints: Point[]
  /** Overrides the canvas's default `top:0; left:0` (see playtest.css) — used in a pod to
   *  position one instance per seat's quadrant (see PlaytestView's per-seat skin layers). */
  style?: CSSProperties
}

/** A ring of faceted triangle "petals" around every card, catching a slow sweeping highlight as
 *  it travels around — a compact, per-card descendant of the original whole-table triangle mesh.
 *
 *  Redesigned from scratch (2026-07-17) — the original version tessellated the *entire table*
 *  into a triangular lattice that glowed near cards, which meant a large canvas had to be
 *  redrawn every frame regardless of how few cards were actually on the table; several rounds of
 *  optimization (cached geometry, batched draw calls, throttled redraw) cut the cost a lot but
 *  never fully fixed it, because the fundamental shape — one giant mesh spanning the whole
 *  surface — doesn't scale down with a small board the way a per-card effect does. This version
 *  is purely per-card (no background mesh at all, same family as Ley Lines/Runic Circle/Ember
 *  Aura), so cost scales with permanents in play, not table size, and needed none of that
 *  optimization machinery in the first place. */
export default function BattlefieldTriangleGrid({ width, height, glowPoints, style }: Props) {
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

    function drawHalo(p: Point, now: number, accentRgb: string) {
      const ringAngle = (now / RING_SPIN_MS) * Math.PI * 2
      // A single bright point sweeps around the ring; each petal's brightness falls off with its
      // angular distance from it, so the halo reads as "catching the light" rather than a static
      // glow — cheap (one cosine per petal), no per-petal state to track between frames.
      const sweepAngle = (now / HIGHLIGHT_SWEEP_MS) * Math.PI * 2 + p.x * 0.01 + p.y * 0.013

      ctx!.save()
      ctx!.translate(p.x, p.y)
      ctx!.rotate(ringAngle)

      for (let i = 0; i < PETAL_COUNT; i++) {
        const a = (i / PETAL_COUNT) * Math.PI * 2
        const halfWidth = (Math.PI / PETAL_COUNT) * PETAL_WIDTH
        const baseLeft = { x: Math.cos(a - halfWidth) * INNER_R, y: Math.sin(a - halfWidth) * INNER_R }
        const baseRight = { x: Math.cos(a + halfWidth) * INNER_R, y: Math.sin(a + halfWidth) * INNER_R }
        const tip = { x: Math.cos(a) * OUTER_R, y: Math.sin(a) * OUTER_R }

        const angularDist = Math.min(Math.abs(a - sweepAngle) % (Math.PI * 2), (Math.PI * 2) - (Math.abs(a - sweepAngle) % (Math.PI * 2)))
        const highlight = Math.max(0, 1 - angularDist / (Math.PI / 3))
        const alpha = 0.14 + highlight * 0.55

        ctx!.beginPath()
        ctx!.moveTo(baseLeft.x, baseLeft.y)
        ctx!.lineTo(tip.x, tip.y)
        ctx!.lineTo(baseRight.x, baseRight.y)
        ctx!.closePath()
        ctx!.fillStyle = `rgba(${accentRgb}, ${alpha * 0.35})`
        ctx!.fill()
        ctx!.strokeStyle = `rgba(${accentRgb}, ${alpha})`
        ctx!.lineWidth = 1 + highlight * 1.2
        ctx!.stroke()
      }

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
      for (const p of points) drawHalo(p, now, accentRgb)

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas className="playtest__skin-canvas" ref={canvasRef} style={style} />
}
