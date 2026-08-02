import { useEffect, useRef, type CSSProperties } from 'react'

// Card is 90×126 (CARD_W_PX/CARD_H_PX in PlaytestView) — the frame anchors below are relative to
// a card's own center, so one template is built once and reused for every card via ctx.translate,
// rather than recomputed per card or per frame.
const CARD_HALF_W = 45
const CARD_HALF_H = 63
const FRAME_OFFSET = 6
const FRAME_POINT_SPACING = 12
const WIGGLE_AMPLITUDE = 3
const OUTER_LINE_WIDTH = 9
const INNER_LINE_WIDTH = 3.5

const EMBER_SPAWN_MS_PER_CARD = 260
const EMBER_LIFE_MS = 1300
const MAX_EMBERS = 200

type Point = { x: number; y: number; tapped?: boolean }

interface FrameAnchor {
  base: Point
  normal: Point
  phase: number
}

/** Fixed ring of points just outside a card's rectangle perimeter, in card-local coordinates —
 *  every card is the same size, so this template is built once at module load and reused for all
 *  of them (translated into place at draw time), not recomputed per card. */
function buildFrameAnchors(): FrameAnchor[] {
  const anchors: FrameAnchor[] = []
  let phaseSeed = 0
  function addEdge(x0: number, y0: number, x1: number, y1: number, normal: Point) {
    const len = Math.hypot(x1 - x0, y1 - y0)
    const steps = Math.max(1, Math.round(len / FRAME_POINT_SPACING))
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      // Golden-ratio increment gives each point an irrational phase offset from its neighbors,
      // so the wiggle never falls into a mechanical, evenly-spaced ripple.
      phaseSeed += 0.6180339887
      anchors.push({ base: { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }, normal, phase: phaseSeed % 1 })
    }
  }
  const hw = CARD_HALF_W + FRAME_OFFSET
  const hh = CARD_HALF_H + FRAME_OFFSET
  addEdge(-hw, -hh, hw, -hh, { x: 0, y: -1 }) // top
  addEdge(hw, -hh, hw, hh, { x: 1, y: 0 }) // right
  addEdge(hw, hh, -hw, hh, { x: 0, y: 1 }) // bottom
  addEdge(-hw, hh, -hw, -hh, { x: -1, y: 0 }) // left
  return anchors
}

const FRAME_ANCHORS = buildFrameAnchors()

interface Ember {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
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

/** A sleek animated fire frame around every card — a wavy ribbon border gradient from bright
 *  orange (top) to deep red (bottom), plus bright red embers bursting outward from the card's
 *  own center. Unlike the rest of this skin family, the frame is drawn in fixed fire colors
 *  rather than the theme's --accent-rgb, since the point is to read as fire regardless of theme.
 *  Purely per-card (no background mesh, no cursor tracking), so cost scales with permanents in
 *  play. The frame anchor ring is a fixed template (buildFrameAnchors) reused for every card via
 *  translation, so only the embers carry real per-frame state. */
export default function BattlefieldEmberAura({ width, height, glowPoints, style }: Props) {
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

    function drawFrame(p: Point, now: number, pointPhase: number) {
      // Tapped cards rotate 90° via CSS (.playtest-card.is-tapped, playtest.css) — the frame is a
      // Canvas2D shape with no DOM link to the card, so it has to rotate itself around the same
      // center to stay aligned with the now-landscape card art.
      ctx!.save()
      if (p.tapped) {
        ctx!.translate(p.x, p.y)
        ctx!.rotate(Math.PI / 2)
        ctx!.translate(-p.x, -p.y)
      }

      const path = new Path2D()
      let started = false
      for (const a of FRAME_ANCHORS) {
        const wiggle = WIGGLE_AMPLITUDE * Math.sin(now / 900 + a.phase * Math.PI * 2 + pointPhase * Math.PI * 2)
        const x = p.x + a.base.x + a.normal.x * wiggle
        const y = p.y + a.base.y + a.normal.y * wiggle
        if (!started) {
          path.moveTo(x, y)
          started = true
        } else {
          path.lineTo(x, y)
        }
      }
      path.closePath()

      const topY = p.y - CARD_HALF_H - FRAME_OFFSET
      const bottomY = p.y + CARD_HALF_H + FRAME_OFFSET

      ctx!.lineJoin = 'round'

      const outerGrad = ctx!.createLinearGradient(p.x, topY, p.x, bottomY)
      outerGrad.addColorStop(0, 'rgba(255, 150, 40, 0.55)')
      outerGrad.addColorStop(1, 'rgba(120, 20, 10, 0.55)')
      ctx!.lineWidth = OUTER_LINE_WIDTH
      ctx!.strokeStyle = outerGrad
      ctx!.stroke(path)

      const innerGrad = ctx!.createLinearGradient(p.x, topY, p.x, bottomY)
      innerGrad.addColorStop(0, 'rgba(255, 215, 120, 0.85)')
      innerGrad.addColorStop(1, 'rgba(255, 110, 40, 0.7)')
      ctx!.lineWidth = INNER_LINE_WIDTH
      ctx!.strokeStyle = innerGrad
      ctx!.stroke(path)

      ctx!.restore()
    }

    const embers: Ember[] = []
    let emberSpawnAcc: number[] = []
    let frame = 0
    let lastTime = performance.now()

    function tick(now: number) {
      const dt = Math.min(48, now - lastTime)
      lastTime = now
      const { width: w, height: h } = sizeRef.current
      ctx!.clearRect(0, 0, w, h)

      const points = glowPointsRef.current
      if (emberSpawnAcc.length !== points.length) {
        emberSpawnAcc = points.map(() => Math.random() * EMBER_SPAWN_MS_PER_CARD)
      }

      for (let i = 0; i < points.length; i++) {
        const p = points[i]
        const pointPhase = (p.x * 0.013 + p.y * 0.017) % 1
        drawFrame(p, now, pointPhase)

        emberSpawnAcc[i] += dt
        if (emberSpawnAcc[i] >= EMBER_SPAWN_MS_PER_CARD && embers.length < MAX_EMBERS) {
          emberSpawnAcc[i] -= EMBER_SPAWN_MS_PER_CARD
          // Radial burst from the card's own center, not a pure upward drift — this canvas
          // paints behind the card's DOM element, so an ember needs real outward speed to clear
          // the card's footprint (CARD_HALF_W/H) and become visible before it fades.
          const angle = Math.random() * Math.PI * 2
          const speed = 0.9 + Math.random() * 0.9
          embers.push({
            x: p.x + (Math.random() - 0.5) * 10,
            y: p.y + (Math.random() - 0.5) * 10,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.3,
            life: 0,
            maxLife: EMBER_LIFE_MS * (0.75 + Math.random() * 0.5),
            size: 1.8 + Math.random() * 1.8,
          })
        }
      }

      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i]
        e.life += dt
        if (e.life >= e.maxLife) {
          embers.splice(i, 1)
          continue
        }
        const step = dt / 16
        const t = e.life / e.maxLife
        e.x += e.vx * step
        e.y += e.vy * step
        // Drag on the initial burst, plus a light constant buoyancy so embers settle into a
        // slow rise rather than accelerating forever.
        e.vx *= 0.99
        e.vy = e.vy * 0.99 - 0.0015 * dt

        const alpha = (t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 1) * 0.9
        const radius = e.size * (1 + t * 1.4)
        const grad = ctx!.createRadialGradient(e.x, e.y, 0, e.x, e.y, radius)
        grad.addColorStop(0, `rgba(255, 70, 45, ${alpha})`)
        grad.addColorStop(0.55, `rgba(220, 30, 20, ${alpha * 0.6})`)
        grad.addColorStop(1, 'rgba(220, 30, 20, 0)')
        ctx!.fillStyle = grad
        ctx!.beginPath()
        ctx!.arc(e.x, e.y, radius, 0, Math.PI * 2)
        ctx!.fill()
      }

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas className="playtest__skin-canvas" ref={canvasRef} style={style} />
}
