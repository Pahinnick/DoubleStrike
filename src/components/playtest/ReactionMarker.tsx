import type { CSSProperties } from 'react'

type Props = {
  emoji: string
  /** Viewport-space position (already run through the camera projection), like PingMarker —
   *  centered on the sender's own board quadrant instead of their sidebar nameplate. */
  style: CSSProperties
}

/**
 * Satellites around the main emoji, as two rings. Each ring sits further out, smaller and
 * fainter than the one inside it, so the burst reads as one thing radiating outward rather than
 * a flat scatter of equal copies. The outer ring is rotated half a step so it interleaves with
 * the inner one instead of hiding directly behind it.
 *
 * Positions are precomputed here rather than done with trig in CSS: it's a fixed, tiny table,
 * and it keeps the stylesheet to "put this one where its variables say".
 */
const RINGS = [
  { count: 6, radius: 52, scale: 0.46, opacity: 0.7, offset: 0, delay: 0.04 },
  { count: 6, radius: 92, scale: 0.28, opacity: 0.32, offset: 30, delay: 0.08 },
]

const SATELLITES = RINGS.flatMap((ring, ringIndex) =>
  Array.from({ length: ring.count }, (_, i) => {
    const angle = ((i * 360) / ring.count + ring.offset) * (Math.PI / 180)
    return {
      key: `${ringIndex}-${i}`,
      dx: Math.round(Math.cos(angle) * ring.radius),
      dy: Math.round(Math.sin(angle) * ring.radius),
      scale: ring.scale,
      opacity: ring.opacity,
      delay: ring.delay,
    }
  }),
)

/** A one-click emoji reaction, bursting outward over the sender's board — viewport-anchored
 *  (constant size at any zoom) like PingMarker. Self-removed by the caller after its animation
 *  finishes. */
function ReactionMarker({ emoji, style }: Props) {
  return (
    <span className="playtest__reaction-burst" style={style} aria-hidden="true">
      {SATELLITES.map((s) => (
        <span
          key={s.key}
          className="playtest__reaction-satellite"
          style={
            {
              '--sat-dx': `${s.dx}px`,
              '--sat-dy': `${s.dy}px`,
              '--sat-scale': s.scale,
              '--sat-opacity': s.opacity,
              animationDelay: `${s.delay}s`,
            } as CSSProperties
          }
        >
          {emoji}
        </span>
      ))}
      {/* Last so it paints over its own satellites — the one everybody's actually meant to read. */}
      <span className="playtest__reaction-marker">{emoji}</span>
    </span>
  )
}

export default ReactionMarker
