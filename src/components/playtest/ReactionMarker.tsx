import type { CSSProperties } from 'react'

type Props = {
  emoji: string
  /** Viewport-space position (already run through the camera projection), like PingMarker —
   *  centered on the sender's own board quadrant instead of their sidebar nameplate. */
  style: CSSProperties
}

/** A one-click emoji reaction, popping up centered over the sender's board — viewport-anchored
 *  (constant size at any zoom) like PingMarker. Self-removed by the caller after its animation
 *  finishes. */
function ReactionMarker({ emoji, style }: Props) {
  return (
    <span className="playtest__reaction-marker" style={style} aria-hidden="true">
      {emoji}
    </span>
  )
}

export default ReactionMarker
