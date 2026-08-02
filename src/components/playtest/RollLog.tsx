import type { CSSProperties } from 'react'
import type { RollResult, Seat } from '../../net/protocol'
import { SEAT_COLORS } from './podLayout'

export type RollLogEntry = {
  id: string
  name: string
  roll: RollResult
  /** Null when the roller's seat can't be resolved (e.g. solo play). */
  seat: Seat | null
}

type Props = {
  entries: RollLogEntry[]
}

function formatRoll(roll: RollResult): string {
  return roll.kind === 'die' ? `d${roll.sides} → ${roll.value}` : roll.value === 'heads' ? 'Heads' : 'Tails'
}

/** Small floating log of recent dice/coin results — newest first, visible to the whole pod (or just yourself, solo). */
function RollLog({ entries }: Props) {
  if (entries.length === 0) return null
  return (
    <div className="playtest__roll-log" aria-label="Recent rolls">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="playtest__roll-entry"
          style={entry.seat !== null ? ({ '--seat-color': SEAT_COLORS[entry.seat] } as unknown as CSSProperties) : undefined}
        >
          <span aria-hidden="true">{entry.roll.kind === 'die' ? '\u{1F3B2}' : '\u{1FA99}'}</span>
          <span className="playtest__roll-name">{entry.name}</span>
          <span className="playtest__roll-value">{formatRoll(entry.roll)}</span>
        </div>
      ))}
    </div>
  )
}

export default RollLog
