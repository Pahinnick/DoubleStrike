import type { CSSProperties } from 'react'
import type { Seat } from '../../net/protocol'
import { SEAT_COLORS } from './podLayout'

type Props = {
  name: string
  /** Null when the pinger's seat can't be resolved (e.g. solo play). */
  seat: Seat | null
  /** Viewport-space position (already run through the camera projection), like SeatOverlay. */
  style: CSSProperties
}

/** A brief animated ring + name tag marking a "look here" ping. Self-removed by the caller after its animation finishes. */
function PingMarker({ name, seat, style }: Props) {
  const colorStyle = {
    ...style,
    '--seat-color': seat !== null ? SEAT_COLORS[seat] : undefined,
  } as CSSProperties

  return (
    <div className="playtest__ping" style={colorStyle}>
      <span className="playtest__ping-ring" />
      <span className="playtest__ping-ring playtest__ping-ring--delay" />
      <span className="playtest__ping-label">{name}</span>
    </div>
  )
}

export default PingMarker
