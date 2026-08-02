import { useEffect, useRef, type CSSProperties } from 'react'

// Card is 90×126 (CARD_W_PX/CARD_H_PX in PlaytestView) — the border sits just outside the card's
// own half-width/half-height, same convention as this skin family's other per-card outlines
// (Runic Circle's rings, Ember Aura's frame).
const CARD_HALF_W = 45
const CARD_HALF_H = 63
const BORDER_OFFSET = 5
const CORNER_RADIUS = 10
const PULSE_MS = 2600

type Point = { x: number; y: number; tapped?: boolean }

type Props = {
  /** Table-space size to fill — same `surface.width`/`surface.height` used to size
   *  .playtest__battlefield-surface (see BattlefieldParticles for why table-space, not viewport). */
  width: number
  height: number
  /** Table-space centers (and tapped state) of every card currently on the table (mine + any pod
   *  opponents) — one glowing border is drawn per point, no proximity/mesh math needed at all. */
  glowPoints: Point[]
  /** Overrides the canvas's default `top:0; left:0` (see playtest.css) — used in a pod to
   *  position one instance per seat's quadrant (see PlaytestView's per-seat skin layers). */
  style?: CSSProperties
}

/** A simple glowing neon-style outline around every card, breathing gently and brightening when
 *  the card taps. Replaces the "Triangle Glow (Split)" skin (2026-07-17) — user: "Lets just
 *  remove the triangle glow playmat or change it into something different. A simple neon border
 *  glow would be cool." Purely per-card (same family as Ley Lines/Runic Circle/Ember Aura/the
 *  remaining Triangle Glow skin), so cost scales with permanents in play, not table size.
 *
 *  The glow itself is `ctx.shadowBlur`/`shadowColor` around a bright core stroke — the simplest
 *  way to get an authentic-looking neon-tube blur out of Canvas2D without hand-rolling multiple
 *  falloff passes. Rotates with a tapped card via the same translate/rotate/translate technique
 *  used to fix Ember Aura's frame not rotating with tapped cards earlier this session, so the
 *  border stays aligned to the card's actual (landscape, once tapped) shape. */
export default function BattlefieldNeonGlow({ width, height, glowPoints, style }: Props) {
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

    function roundedRectPath(hw: number, hh: number, r: number) {
      ctx!.beginPath()
      ctx!.moveTo(-hw + r, -hh)
      ctx!.lineTo(hw - r, -hh)
      ctx!.arcTo(hw, -hh, hw, -hh + r, r)
      ctx!.lineTo(hw, hh - r)
      ctx!.arcTo(hw, hh, hw - r, hh, r)
      ctx!.lineTo(-hw + r, hh)
      ctx!.arcTo(-hw, hh, -hw, hh - r, r)
      ctx!.lineTo(-hw, -hh + r)
      ctx!.arcTo(-hw, -hh, -hw + r, -hh, r)
      ctx!.closePath()
    }

    function drawBorder(p: Point, now: number, accentRgb: string) {
      const pulse = 0.75 + 0.25 * Math.sin(now / PULSE_MS + p.x * 0.01 + p.y * 0.013)
      const boost = p.tapped ? 1.4 : 1
      const hw = CARD_HALF_W + BORDER_OFFSET
      const hh = CARD_HALF_H + BORDER_OFFSET

      ctx!.save()
      ctx!.translate(p.x, p.y)
      if (p.tapped) ctx!.rotate(Math.PI / 2)

      roundedRectPath(hw, hh, CORNER_RADIUS)

      // Soft outer glow — shadowBlur around a wide, low-alpha stroke is the simplest way to fake
      // a neon-tube bloom in Canvas2D.
      ctx!.shadowColor = `rgba(${accentRgb}, ${0.9 * pulse * boost})`
      ctx!.shadowBlur = 14 * boost
      ctx!.strokeStyle = `rgba(${accentRgb}, ${0.5 * pulse * boost})`
      ctx!.lineWidth = 3
      ctx!.stroke()

      // Bright crisp core line on top, no shadow, so the border reads as a lit tube rather than
      // just a blur.
      ctx!.shadowBlur = 0
      ctx!.strokeStyle = `rgba(${accentRgb}, ${Math.min(1, 0.8 * pulse * boost)})`
      ctx!.lineWidth = 1.2
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
      for (const p of points) drawBorder(p, now, accentRgb)

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas className="playtest__skin-canvas" ref={canvasRef} style={style} />
}
