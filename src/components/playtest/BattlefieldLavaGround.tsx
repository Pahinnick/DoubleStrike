import { useEffect, useMemo, useRef, type CSSProperties } from 'react'

// The field is built from a few layers, all fixed per surface size (see buildField), not per-card
// — this is the ground everything else sits on, not a per-permanent reactive skin:
//   1. Rivers: bright molten channels of variable width that widen as they flow downstream and
//      dump into a bright pool at their mouth. A brightness wave travels along each (the flow),
//      the whole path slowly writhes/reshapes, and dark chunks of crust drift downstream on the
//      surface — the three things that together read as *flowing* lava rather than a glowing line.
//   2. Pools: a sparse, dim scatter of red hot-rock glow filling the crust between rivers, plus a
//      bright mouth pool where each river empties.
// On top of it all, an occasional "bubble pop" flares bright and fades.

const RIVER_AREA_PER = 360000 // one river per ~this many px² of surface
const RIVER_STEP = 130
const RIVER_STEPS_MIN = 10
const RIVER_STEPS_MAX = 16
const RIVER_WANDER = 0.7 // max radians of heading drift per step (lower = flows more directionally)
const RIVER_BODY_BASE = 34 // full-width reference; per-vertex width scales this (see WIDTH_*)
const WIDTH_SOURCE = 0.4 // width multiplier at the source (thin trickle)
const WIDTH_MOUTH = 1.7 // width multiplier at the mouth (wide, dumping into the pool)
// Two low-frequency sine "bulge" layers riding on top of the source→mouth taper, each river with
// its own randomized frequency/phase (see buildField) — this is what breaks the taper into a few
// wide, slow "bellies" and narrow "necks" along the length, instead of a clean cone or per-vertex
// static (which reads as jittery noise, not an organic non-uniform flow).
const BULGE1_AMP = 0.4
const BULGE1_FREQ_MIN = 1.2
const BULGE1_FREQ_MAX = 2.4
const BULGE2_AMP = 0.22
const BULGE2_FREQ_MIN = 3
const BULGE2_FREQ_MAX = 5.5
// Real lava piles up and spreads at a bend rather than holding a constant width through the turn
// — this multiplies width by how sharp the live (currently-writhing) path bends at each vertex,
// recomputed every frame since the writhe means the bend angle itself is never static.
const TURN_WIDTH_GAIN = 0.9
const CORE_RATIO = 0.44 // bright core width as a fraction of body width
const FLOW_SPEED = 0.0008 // radians of the travelling brightness wave per ms
const FLOW_WAVELENGTH = 0.011 // radians per px along the river

// Each river vertex slowly orbits its base position (a slither, not a march) so the whole path
// writhes and reshapes over time. Phase advances along the river's length (the `s *` terms in
// buildField) so the deformation travels downstream. Amplitude stays under RIVER_STEP so
// neighbours never cross and tangle; the CSS blur smooths what's left.
const MORPH_AMP_MIN = 16
const MORPH_AMP_MAX = 34
const MORPH_FREQ_X = 0.00021
const MORPH_FREQ_Y = 0.00017

// Dark crust chunks riding the current from source (t=0) to mouth (t=1), where they sink into the
// pool — drawn dark over the bright river (source-over, not additive) so they read as shadow.
const SPLOTCH_TRAVEL_MS = 14400
const SPLOTCH_SPAWN_MS = 1700
const SPLOTCH_SIZE_MIN = 0.55
const SPLOTCH_SIZE_MAX = 1.05
const MAX_SPLOTCH_PER_RIVER = 14

const POOL_SPACING = 240
const POOL_JITTER = 90
const POOL_RADIUS_MIN = 120
const POOL_RADIUS_MAX = 210
const MOUTH_RADIUS_MIN = 120
const MOUTH_RADIUS_MAX = 185
const BREATH_PERIOD_MIN = 9000
const BREATH_PERIOD_MAX = 19000

const POP_GAP_MIN = 8400
const POP_GAP_MAX = 18000
const POP_RISE_MS = 400
const POP_DECAY_MS = 1800
const POP_RADIUS = 74

const CRUST_DARK: [number, number, number] = [20, 7, 4]
const SPLOTCH_COLOR: [number, number, number] = [26, 9, 5]
const POOL_DEEP: [number, number, number] = [70, 14, 6]
const POOL_HOT: [number, number, number] = [190, 42, 14]
const RIVER_DEEP: [number, number, number] = [150, 28, 10]
const RIVER_HOT: [number, number, number] = [255, 82, 24]
const MOUTH_HOT: [number, number, number] = [255, 120, 45]
const POP_PEAK: [number, number, number] = [255, 150, 60]

type Point = { x: number; y: number }

interface RiverVertex {
  /** Base (rest) position; the drawn position orbits this — see updateLive. */
  bx: number
  by: number
  amp: number
  phaseX: number
  phaseY: number
  /** Body-width multiplier at this vertex — source→mouth taper with two bulge layers riding on
   *  top (see the BULGE1/BULGE2 constants); the turn-based widening in drawRivers is applied on
   *  top of this at draw time, since it depends on the live (currently-writhing) path, not this
   *  static base shape. */
  widthMul: number
}

interface Splotch {
  /** 0..1 position along the river, source→mouth; advances with the current. */
  t: number
  /** Size as a fraction of the local river half-width. */
  size: number
  /** Lateral offset across the channel, in [-1, 1] of the local half-width. */
  lateral: number
}

interface River {
  verts: RiverVertex[]
  /** Reused scratch buffer of live (animated) positions, recomputed each frame in updateLive. */
  live: Point[]
  /** Reused scratch buffer, one per vertex: 0 (straight) to 1 (sharp bend), from the live path —
   *  recomputed each frame in updateLive alongside `live`, since the writhe means bend angles
   *  are never static. Endpoints are always 0 (no bend to measure). */
  liveTurn: number[]
  /** Cumulative arc length at each vertex (from base positions), for the travelling flow wave. */
  dists: number[]
  phase: number
  breathPeriod: number
  breathPhase: number
  mouthRadius: number
  splotches: Splotch[]
  spawnAcc: number
}

interface Pool {
  x: number
  y: number
  radius: number
  breathPeriod: number
  breathPhase: number
}

interface Field {
  rivers: River[]
  pools: Pool[]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function buildField(width: number, height: number): Field {
  const rivers: River[] = []
  const count = Math.max(4, Math.round((width * height) / RIVER_AREA_PER))
  for (let r = 0; r < count; r++) {
    const verts: RiverVertex[] = []
    let x = Math.random() * width
    let y = Math.random() * height
    let angle = Math.random() * Math.PI * 2
    const steps = RIVER_STEPS_MIN + Math.floor(Math.random() * (RIVER_STEPS_MAX - RIVER_STEPS_MIN + 1))
    // Each river gets its own randomized bulge frequencies/phases so the "bellies" and "necks"
    // along its length land in different places from every other river.
    const bulge1Freq = BULGE1_FREQ_MIN + Math.random() * (BULGE1_FREQ_MAX - BULGE1_FREQ_MIN)
    const bulge1Phase = Math.random() * Math.PI * 2
    const bulge2Freq = BULGE2_FREQ_MIN + Math.random() * (BULGE2_FREQ_MAX - BULGE2_FREQ_MIN)
    const bulge2Phase = Math.random() * Math.PI * 2
    for (let s = 0; s < steps; s++) {
      const profileT = steps > 1 ? s / (steps - 1) : 1
      const bulge =
        (1 + BULGE1_AMP * Math.sin(profileT * bulge1Freq * Math.PI * 2 + bulge1Phase)) *
        (1 + BULGE2_AMP * Math.sin(profileT * bulge2Freq * Math.PI * 2 + bulge2Phase))
      verts.push({
        bx: x,
        by: y,
        amp: MORPH_AMP_MIN + Math.random() * (MORPH_AMP_MAX - MORPH_AMP_MIN),
        // Phase advances with vertex index (the `s *` term) so the deformation travels along the
        // river, plus a small random offset so rivers don't all writhe identically.
        phaseX: s * 0.7 + Math.random() * 0.6,
        phaseY: s * 0.55 + Math.random() * 0.6,
        widthMul: Math.max(0.15, lerp(WIDTH_SOURCE, WIDTH_MOUTH, profileT) * bulge),
      })
      angle += (Math.random() - 0.5) * 2 * RIVER_WANDER
      x += Math.cos(angle) * RIVER_STEP
      y += Math.sin(angle) * RIVER_STEP
    }
    const dists: number[] = [0]
    for (let i = 1; i < verts.length; i++) {
      dists.push(dists[i - 1] + Math.hypot(verts[i].bx - verts[i - 1].bx, verts[i].by - verts[i - 1].by))
    }
    rivers.push({
      verts,
      live: verts.map(() => ({ x: 0, y: 0 })),
      liveTurn: verts.map(() => 0),
      dists,
      phase: Math.random(),
      breathPeriod: BREATH_PERIOD_MIN + Math.random() * (BREATH_PERIOD_MAX - BREATH_PERIOD_MIN),
      breathPhase: Math.random(),
      mouthRadius: MOUTH_RADIUS_MIN + Math.random() * (MOUTH_RADIUS_MAX - MOUTH_RADIUS_MIN),
      splotches: [],
      spawnAcc: Math.random() * SPLOTCH_SPAWN_MS,
    })
  }

  const pools: Pool[] = []
  for (let gy = -POOL_SPACING / 2; gy < height + POOL_SPACING; gy += POOL_SPACING) {
    for (let gx = -POOL_SPACING / 2; gx < width + POOL_SPACING; gx += POOL_SPACING) {
      pools.push({
        x: gx + (Math.random() - 0.5) * POOL_JITTER * 2,
        y: gy + (Math.random() - 0.5) * POOL_JITTER * 2,
        radius: POOL_RADIUS_MIN + Math.random() * (POOL_RADIUS_MAX - POOL_RADIUS_MIN),
        breathPeriod: BREATH_PERIOD_MIN + Math.random() * (BREATH_PERIOD_MAX - BREATH_PERIOD_MIN),
        breathPhase: Math.random(),
      })
    }
  }

  return { rivers, pools }
}

function mixToward(base: [number, number, number], target: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(base[0] * (1 - t) + target[0] * t),
    Math.round(base[1] * (1 - t) + target[1] * t),
    Math.round(base[2] * (1 - t) + target[2] * t),
  ]
}

type Props = {
  /** Table-space size to fill — same `surface.width`/`surface.height` used to size
   *  .playtest__battlefield-surface (see BattlefieldParticles for why table-space, not viewport). */
  width: number
  height: number
  /** Overrides the canvas's default `top:0; left:0` (see playtest.css) — used in a pod to
   *  position one instance per seat's quadrant (see PlaytestView's per-seat skin layers). */
  style?: CSSProperties
}

/** The Ember Aura playmat's ground — a molten lava field rather than plain felt. A dark crust
 *  broken by bright rivers that widen downstream into glowing pools, with a flow wave, a writhing
 *  path, and dark crust chunks drifting on the current, plus the occasional bubble-pop flare.
 *  Purely ambient/time-driven (no card or cursor input) — this is the table material itself, not a
 *  per-permanent reactive effect; see BattlefieldEmberAura.tsx for the per-card fire frame and
 *  embers that sit on top of it. A CSS blur on the canvas element (see .playtest__lava-ground)
 *  merges the individually-drawn strokes and blobs into a continuous molten field. */
export default function BattlefieldLavaGround({ width, height, style }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }
  const field = useMemo(() => buildField(width, height), [width, height])
  const fieldRef = useRef(field)
  fieldRef.current = field

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
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    function fillCrust() {
      const { width: w, height: h } = sizeRef.current
      ctx!.fillStyle = `rgb(${CRUST_DARK[0]}, ${CRUST_DARK[1]}, ${CRUST_DARK[2]})`
      ctx!.fillRect(0, 0, w, h)
    }

    /** Recompute a river's live vertex positions for time `now` — each orbits its base point, so
     *  the path itself slowly reshapes frame to frame — plus each interior vertex's current bend
     *  sharpness (0 straight .. 1 sharp), used to widen the channel through turns. */
    function updateLive(river: River, now: number) {
      const { verts, live, liveTurn } = river
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i]
        live[i].x = v.bx + v.amp * Math.sin(now * MORPH_FREQ_X + v.phaseX)
        live[i].y = v.by + v.amp * Math.cos(now * MORPH_FREQ_Y + v.phaseY)
      }
      for (let i = 0; i < verts.length; i++) {
        if (i === 0 || i === verts.length - 1) {
          liveTurn[i] = 0
          continue
        }
        const inX = live[i].x - live[i - 1].x
        const inY = live[i].y - live[i - 1].y
        const outX = live[i + 1].x - live[i].x
        const outY = live[i + 1].y - live[i].y
        const inLen = Math.hypot(inX, inY) || 1
        const outLen = Math.hypot(outX, outY) || 1
        const cos = Math.max(-1, Math.min(1, (inX * outX + inY * outY) / (inLen * outLen)))
        liveTurn[i] = (1 - cos) / 2
      }
    }

    function drawPools(now: number) {
      for (const pool of fieldRef.current.pools) {
        const breath =
          0.5 + 0.5 * Math.sin((now / pool.breathPeriod) * Math.PI * 2 + pool.breathPhase * Math.PI * 2)
        const color = mixToward(POOL_DEEP, POOL_HOT, breath)
        const alpha = 0.06 + breath * 0.14
        const grad = ctx!.createRadialGradient(pool.x, pool.y, 0, pool.x, pool.y, pool.radius)
        grad.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`)
        grad.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`)
        ctx!.fillStyle = grad
        ctx!.beginPath()
        ctx!.arc(pool.x, pool.y, pool.radius, 0, Math.PI * 2)
        ctx!.fill()
      }
    }

    /** Additive pass: the glowing river body, its brighter flowing core, and the bright pool it
     *  empties into. Updates each river's live geometry as a side effect (reused by the splotch
     *  pass afterwards). */
    function drawRivers(now: number) {
      ctx!.lineCap = 'round'
      ctx!.lineJoin = 'round'
      for (const river of fieldRef.current.rivers) {
        updateLive(river, now)
        const live = river.live
        const n = live.length
        if (n < 2) continue
        const breath =
          0.5 + 0.5 * Math.sin((now / river.breathPeriod) * Math.PI * 2 + river.breathPhase * Math.PI * 2)

        // Wide dim body — variable thickness per segment (round caps overlap into a continuous
        // lumpy tube that widens toward the mouth and bulges further through turns), breathing
        // slowly.
        ctx!.strokeStyle = `rgba(${RIVER_DEEP[0]}, ${RIVER_DEEP[1]}, ${RIVER_DEEP[2]}, ${0.3 + breath * 0.16})`
        for (let i = 0; i < n - 1; i++) {
          const turnBonus = 1 + TURN_WIDTH_GAIN * ((river.liveTurn[i] + river.liveTurn[i + 1]) / 2)
          const w =
            RIVER_BODY_BASE * ((river.verts[i].widthMul + river.verts[i + 1].widthMul) / 2) * turnBonus * (0.85 + breath * 0.3)
          ctx!.lineWidth = w
          ctx!.beginPath()
          ctx!.moveTo(live[i].x, live[i].y)
          ctx!.lineTo(live[i + 1].x, live[i + 1].y)
          ctx!.stroke()
        }

        // Bright core — same variable width scaled down, with a brightness wave travelling
        // downstream so the channel reads as flowing.
        for (let i = 0; i < n - 1; i++) {
          const wave = 0.5 + 0.5 * Math.sin(now * FLOW_SPEED - river.dists[i] * FLOW_WAVELENGTH + river.phase * Math.PI * 2)
          const b = Math.min(1, 0.4 + wave * 0.6) * (0.7 + breath * 0.3)
          const color = mixToward(RIVER_DEEP, RIVER_HOT, b)
          const turnBonus = 1 + TURN_WIDTH_GAIN * ((river.liveTurn[i] + river.liveTurn[i + 1]) / 2)
          const w = RIVER_BODY_BASE * ((river.verts[i].widthMul + river.verts[i + 1].widthMul) / 2) * turnBonus * CORE_RATIO
          ctx!.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.4 + b * 0.5})`
          ctx!.lineWidth = w
          ctx!.beginPath()
          ctx!.moveTo(live[i].x, live[i].y)
          ctx!.lineTo(live[i + 1].x, live[i + 1].y)
          ctx!.stroke()
        }

        // Mouth pool — the bright bloom of lava the river empties into.
        const mouth = live[n - 1]
        const mb = 0.65 + 0.35 * breath
        const grad = ctx!.createRadialGradient(mouth.x, mouth.y, 0, mouth.x, mouth.y, river.mouthRadius)
        grad.addColorStop(0, `rgba(${MOUTH_HOT[0]}, ${MOUTH_HOT[1]}, ${MOUTH_HOT[2]}, ${0.5 * mb})`)
        grad.addColorStop(0.45, `rgba(${RIVER_HOT[0]}, ${RIVER_HOT[1]}, ${RIVER_HOT[2]}, ${0.3 * mb})`)
        grad.addColorStop(1, `rgba(${RIVER_HOT[0]}, ${RIVER_HOT[1]}, ${RIVER_HOT[2]}, 0)`)
        ctx!.fillStyle = grad
        ctx!.beginPath()
        ctx!.arc(mouth.x, mouth.y, river.mouthRadius, 0, Math.PI * 2)
        ctx!.fill()
      }
    }

    /** Normal-composite pass (call after restoring from the additive block): dark crust chunks
     *  drifting downstream. Drawn dark over the bright river so they read as shadow; invisible
     *  over the dark crust background, so they only show while riding the lava. */
    function drawSplotches(dt: number) {
      for (const river of fieldRef.current.rivers) {
        const live = river.live
        const n = live.length
        if (n < 2) continue

        river.spawnAcc += dt
        if (river.spawnAcc >= SPLOTCH_SPAWN_MS && river.splotches.length < MAX_SPLOTCH_PER_RIVER) {
          river.spawnAcc -= SPLOTCH_SPAWN_MS
          river.splotches.push({
            t: 0,
            size: SPLOTCH_SIZE_MIN + Math.random() * (SPLOTCH_SIZE_MAX - SPLOTCH_SIZE_MIN),
            lateral: (Math.random() - 0.5) * 1.2,
          })
        }

        for (let k = river.splotches.length - 1; k >= 0; k--) {
          const s = river.splotches[k]
          s.t += dt / SPLOTCH_TRAVEL_MS
          if (s.t >= 1) {
            river.splotches.splice(k, 1)
            continue
          }
          const seg = s.t * (n - 1)
          const i = Math.min(n - 2, Math.floor(seg))
          const f = seg - i
          const ax = live[i].x
          const ay = live[i].y
          const bx = live[i + 1].x
          const by = live[i + 1].y
          let px = lerp(ax, bx, f)
          let py = lerp(ay, by, f)
          const turnBonus = 1 + TURN_WIDTH_GAIN * lerp(river.liveTurn[i], river.liveTurn[i + 1], f)
          const halfW = RIVER_BODY_BASE * lerp(river.verts[i].widthMul, river.verts[i + 1].widthMul, f) * turnBonus * 0.5

          // Offset across the channel along the segment normal.
          const dx = bx - ax
          const dy = by - ay
          const len = Math.hypot(dx, dy) || 1
          px += (-dy / len) * s.lateral * halfW
          py += (dx / len) * s.lateral * halfW

          // Fade in from the source and out into the mouth pool so chunks don't pop in/out.
          const fade = s.t < 0.12 ? s.t / 0.12 : s.t > 0.82 ? (1 - s.t) / 0.18 : 1
          const radius = Math.max(4, halfW * s.size)
          const grad = ctx!.createRadialGradient(px, py, 0, px, py, radius)
          grad.addColorStop(0, `rgba(${SPLOTCH_COLOR[0]}, ${SPLOTCH_COLOR[1]}, ${SPLOTCH_COLOR[2]}, ${0.85 * fade})`)
          grad.addColorStop(0.7, `rgba(${SPLOTCH_COLOR[0]}, ${SPLOTCH_COLOR[1]}, ${SPLOTCH_COLOR[2]}, ${0.5 * fade})`)
          grad.addColorStop(1, `rgba(${SPLOTCH_COLOR[0]}, ${SPLOTCH_COLOR[1]}, ${SPLOTCH_COLOR[2]}, 0)`)
          ctx!.fillStyle = grad
          ctx!.beginPath()
          ctx!.arc(px, py, radius, 0, Math.PI * 2)
          ctx!.fill()
        }
      }
    }

    if (reduceMotion) {
      fillCrust()
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      drawPools(0)
      drawRivers(0)
      ctx.restore()
      return
    }

    // Bubble pops: one flare scheduled at a time (rare by design), placed at a random point on a
    // random river so the crust cracks open where the lava already flows.
    let nextPopAt = -1
    let popStart: number | null = null
    let popX = 0
    let popY = 0

    let frame = 0
    let lastTime = performance.now()

    function tick(now: number) {
      const dt = Math.min(48, now - lastTime)
      lastTime = now

      fillCrust()

      ctx!.save()
      ctx!.globalCompositeOperation = 'lighter'
      drawPools(now)
      drawRivers(now)

      const rivers = fieldRef.current.rivers
      if (nextPopAt < 0) nextPopAt = now + POP_GAP_MIN + Math.random() * (POP_GAP_MAX - POP_GAP_MIN)
      if (popStart === null && now >= nextPopAt && rivers.length > 0) {
        const river = rivers[Math.floor(Math.random() * rivers.length)]
        const pt = river.live[Math.floor(Math.random() * river.live.length)]
        popX = pt.x
        popY = pt.y
        popStart = now
      }
      if (popStart !== null) {
        const elapsed = now - popStart
        let v = 0
        if (elapsed < POP_RISE_MS) v = elapsed / POP_RISE_MS
        else if (elapsed < POP_RISE_MS + POP_DECAY_MS) v = 1 - (elapsed - POP_RISE_MS) / POP_DECAY_MS
        else {
          popStart = null
          nextPopAt = now + POP_GAP_MIN + Math.random() * (POP_GAP_MAX - POP_GAP_MIN)
        }
        if (v > 0) {
          const grad = ctx!.createRadialGradient(popX, popY, 0, popX, popY, POP_RADIUS)
          grad.addColorStop(0, `rgba(${POP_PEAK[0]}, ${POP_PEAK[1]}, ${POP_PEAK[2]}, ${v * 0.8})`)
          grad.addColorStop(0.5, `rgba(${RIVER_HOT[0]}, ${RIVER_HOT[1]}, ${RIVER_HOT[2]}, ${v * 0.4})`)
          grad.addColorStop(1, `rgba(${RIVER_HOT[0]}, ${RIVER_HOT[1]}, ${RIVER_HOT[2]}, 0)`)
          ctx!.fillStyle = grad
          ctx!.beginPath()
          ctx!.arc(popX, popY, POP_RADIUS, 0, Math.PI * 2)
          ctx!.fill()
        }
      }

      // Dark crust chunks ride on top of the glow — normal composite so they darken it.
      ctx!.globalCompositeOperation = 'source-over'
      drawSplotches(dt)
      ctx!.restore()

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <canvas
      className="playtest__skin-canvas playtest__lava-ground"
      ref={canvasRef}
      style={style}
    />
  )
}
