import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export interface BattlefieldParticlesHandle {
  /** Spawns a puff of `count` particles at a table-space point (the same coordinate system
   *  as GameCard.x/y — see surfacePointAt in PlaytestView.tsx for client-to-table conversion). */
  burst(x: number, y: number, count?: number): void
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
}

const MAX_PARTICLES = 260

type Props = {
  /** Table-space size to fill — pass the same `surface.width`/`surface.height` used to size
   *  `.playtest__battlefield-surface`, since this canvas is a child of that transformed
   *  element (not the fixed viewport), so a burst stays pinned to the table point it was
   *  spawned at rather than sliding on screen if the camera pans/zooms afterward. */
  width: number
  height: number
}

/** A soft "smoke" particle puff, triggered on demand via `burst` (clicking the battlefield or
 *  a card, dropping a card) rather than continuously following the cursor — see
 *  handleCanvasMouseDown/handleBattlefieldCardClick/handleBattlefieldDrop in PlaytestView.tsx.
 *  Pure canvas 2D — no fluid sim — kept cheap by capping particle count. Tinted with the
 *  current theme's --accent-rgb, so it reads as pink/cyan smoke in Vaporwave and a faint wisp
 *  in the calmer themes. Active in every theme (not Vaporwave-only). */
const BattlefieldParticles = forwardRef<BattlefieldParticlesHandle, Props>(function BattlefieldParticles(
  { width, height },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }

  function spawn(x: number, y: number, count: number, speedScale: number, upwardBias: number) {
    const particles = particlesRef.current
    for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = (0.3 + Math.random() * 0.9) * speedScale
      particles.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - upwardBias,
        life: 0,
        // Short and punchy — a quick puff of dust, not lingering smoke.
        maxLife: 150 + Math.random() * 120,
        size: 5 + Math.random() * 9,
      })
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      burst(x, y, count = 14) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        spawn(x, y, count, 1.4, 0.25)
      },
    }),
    [],
  )

  // Canvas backing store tracks the table-space size directly (not a ResizeObserver on a
  // screen container) — it only changes when entering/leaving a pod resizes the table itself.
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

    let frame = 0
    let lastTime = performance.now()

    function tick(now: number) {
      const dt = Math.min(48, now - lastTime)
      lastTime = now
      ctx!.clearRect(0, 0, sizeRef.current.width, sizeRef.current.height)

      const accentRgb = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '255, 255, 255'
      const particles = particlesRef.current
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life += dt
        if (p.life >= p.maxLife) {
          particles.splice(i, 1)
          continue
        }
        const step = dt / 16
        p.x += p.vx * step
        p.y += p.vy * step
        p.vy -= 0.0016 * dt
        p.vx *= 0.99
        const t = p.life / p.maxLife
        const alpha = (1 - t) * 0.3
        const radius = p.size * (1 + t * 1.6)
        const gradient = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
        gradient.addColorStop(0, `rgba(${accentRgb}, ${alpha})`)
        gradient.addColorStop(1, `rgba(${accentRgb}, 0)`)
        ctx!.fillStyle = gradient
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, radius, 0, Math.PI * 2)
        ctx!.fill()
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      particlesRef.current = []
    }
  }, [])

  return <canvas className="playtest__particles" ref={canvasRef} />
})

export default BattlefieldParticles
