import { useEffect, useRef, type CSSProperties } from 'react'

// Each node links to its 2 nearest neighbors — enough for a readable constellation without a
// tangle of crossing lines once more than a handful of cards are on the table.
const NEIGHBORS_PER_NODE = 2
const NODE_RADIUS = 5
const PULSE_MS = 1400
const LINE_ALPHA = 0.35

type Point = { x: number; y: number }

interface Edge {
  a: Point
  b: Point
  /** Quadratic-bezier control point, bowed off the direct a→b line. Straight lines between card
   *  centers run mostly *underneath* both cards (cards render on top of this canvas — see
   *  PlaytestView's DOM-order stacking), so with cards placed close together almost none of a
   *  straight link would ever be visible. Bowing the curve out into the gap between cards fixes
   *  that regardless of how tightly packed the board is. */
  control: Point
  /** 0..1 offset into the shared PULSE_MS cycle so pulses don't all travel in lockstep. */
  phase: number
}

/** Point at parameter t (0..1) along the quadratic bezier a→control→b. */
function bezierPoint(a: Point, control: Point, b: Point, t: number): Point {
  const mt = 1 - t
  return {
    x: mt * mt * a.x + 2 * mt * t * control.x + t * t * b.x,
    y: mt * mt * a.y + 2 * mt * t * control.y + t * t * b.y,
  }
}

type Props = {
  /** Table-space size to fill — same `surface.width`/`surface.height` used to size
   *  .playtest__battlefield-surface (see BattlefieldParticles for why table-space, not viewport). */
  width: number
  height: number
  /** Table-space centers of every card currently on the table (mine + any pod opponents). */
  glowPoints: Point[]
  /** Overrides the canvas's default `top:0; left:0` (see playtest.css) — used in a pod to
   *  position one instance per seat's quadrant (see PlaytestView's per-seat skin layers). */
  style?: CSSProperties
}

function pointsKey(points: Point[]): string {
  let key = ''
  for (const p of points) key += p.x.toFixed(1) + ',' + p.y.toFixed(1) + '|'
  return key
}

/** Nearest-2-neighbor graph over the given points, deduped to undirected edges. O(n²) — fine at
 *  battlefield scale (a few dozen permanents at most), and only recomputed when card positions
 *  actually change (see the cache in the draw effect), not every frame. */
function buildEdges(points: Point[]): Edge[] {
  if (points.length < 2) return []
  const seen = new Set<string>()
  const edges: Edge[] = []
  for (let i = 0; i < points.length; i++) {
    const nearest = points
      .map((p, j) => ({ j, d: j === i ? Infinity : Math.hypot(p.x - points[i].x, p.y - points[i].y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, NEIGHBORS_PER_NODE)
    for (const { j } of nearest) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (seen.has(key)) continue
      seen.add(key)
      const a = points[i]
      const b = points[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      // Perpendicular unit vector, bowed out by up to 60px (or less for a very short link) —
      // alternates side per edge (by index parity) so a cluster of links doesn't all arc the
      // same way.
      const nx = -dy / len
      const ny = dx / len
      const bow = Math.min(60, Math.max(24, len * 0.35)) * (edges.length % 2 === 0 ? 1 : -1)
      const mx = (a.x + b.x) / 2 + nx * bow
      const my = (a.y + b.y) / 2 + ny * bow
      edges.push({ a, b, control: { x: mx, y: my }, phase: (i * 0.37 + j * 0.53) % 1 })
    }
  }
  return edges
}

/** A glowing constellation connecting every card on the table to its nearest neighbors, with a
 *  small pulse of light traveling each link and a soft node glow at each card. Unlike the
 *  Triangle Glow skins there's no background mesh at all — an empty battlefield renders nothing,
 *  so the cost is strictly proportional to how many cards are actually in play (a few dozen at
 *  most), not to table size. Purely reactive (cards only, no cursor — see the Triangle Glow
 *  skins' history for why cursor tracking was removed from this whole family). */
export default function BattlefieldLeyLines({ width, height, glowPoints, style }: Props) {
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

    // The edge graph only needs rebuilding when a card actually moves — see the Triangle Glow
    // skins' "cache the zones of influence" fix for the same pattern and why it matters.
    let cachedKey: string | null = null
    let cachedEdges: Edge[] = []
    function edges(): Edge[] {
      const points = glowPointsRef.current
      const key = pointsKey(points)
      if (key === cachedKey) return cachedEdges
      cachedKey = key
      cachedEdges = buildEdges(points)
      return cachedEdges
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
      const list = edges()

      // Links — one batched stroke for all of them, each a curve bowed away from the direct
      // line so it reads in the gaps between cards instead of hiding underneath them.
      if (list.length > 0) {
        ctx!.lineWidth = 1.2
        ctx!.strokeStyle = `rgba(${accentRgb}, ${LINE_ALPHA})`
        ctx!.beginPath()
        for (const e of list) {
          ctx!.moveTo(e.a.x, e.a.y)
          ctx!.quadraticCurveTo(e.control.x, e.control.y, e.b.x, e.b.y)
        }
        ctx!.stroke()
      }

      // A small bright pulse traveling each link's curve.
      for (const e of list) {
        const t = (now / PULSE_MS + e.phase) % 1
        const { x: px, y: py } = bezierPoint(e.a, e.control, e.b, t)
        const grad = ctx!.createRadialGradient(px, py, 0, px, py, 9)
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)')
        grad.addColorStop(0.35, `rgba(${accentRgb}, 0.6)`)
        grad.addColorStop(1, `rgba(${accentRgb}, 0)`)
        ctx!.fillStyle = grad
        ctx!.beginPath()
        ctx!.arc(px, py, 9, 0, Math.PI * 2)
        ctx!.fill()
      }

      // A softly breathing node glow at each card.
      for (const p of points) {
        const breathe = 0.75 + 0.25 * Math.sin(now / 900 + p.x * 0.01 + p.y * 0.01)
        const r = NODE_RADIUS * breathe * 3
        const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.85)')
        grad.addColorStop(0.4, `rgba(${accentRgb}, 0.5)`)
        grad.addColorStop(1, `rgba(${accentRgb}, 0)`)
        ctx!.fillStyle = grad
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx!.fill()
      }

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas className="playtest__skin-canvas" ref={canvasRef} style={style} />
}
