import type { CSSProperties } from 'react'
import type { RollResult, Seat } from '../../net/protocol'
import { SEAT_COLORS } from './podLayout'

export type RollLogEntry = {
  id: string
  /** Who made the roll — used to decide whose entry carries the dismiss control. */
  playerId: string
  name: string
  roll: RollResult
  /** Null when the roller's seat can't be resolved (e.g. solo play). */
  seat: Seat | null
}

type Props = {
  entries: RollLogEntry[]
  /** Present only for rolls this client made: clears the roll for the whole pod. Rolls stay up
   *  until their own roller takes them back, so somebody else's result is never yours to
   *  remove — that's why this is per-entry rather than a blanket "clear the log" button. */
  onDismiss?: (id: string) => void
  /** This client's own playerId, so only our own rolls get the dismiss control. */
  selfPlayerId?: string
}

function formatRoll(roll: RollResult): string {
  if (roll.kind !== 'die') return roll.value === 'heads' ? 'Heads' : 'Tails'
  // Multi-die rolls show the total first (the number people actually want) with the individual
  // faces after it, so "11d6 → 41" is readable at a glance but still auditable.
  if (roll.values && roll.values.length > 1) {
    return `${roll.values.length}d${roll.sides} → ${roll.value} (${roll.values.join(', ')})`
  }
  return `d${roll.sides} → ${roll.value}`
}

/** Small floating log of recent dice/coin results — newest first, visible to the whole pod (or just yourself, solo). */
function RollLog({ entries, onDismiss, selfPlayerId }: Props) {
  if (entries.length === 0) return null
  return (
    <div className="playtest__roll-log" aria-label="Recent rolls">
      {entries.map((entry) => {
        const mine = onDismiss !== undefined && entry.playerId === selfPlayerId
        return (
          <div
            key={entry.id}
            className={`playtest__roll-entry ${mine ? 'is-dismissable' : ''}`}
            style={entry.seat !== null ? ({ '--seat-color': SEAT_COLORS[entry.seat] } as unknown as CSSProperties) : undefined}
          >
            <span aria-hidden="true">{entry.roll.kind === 'die' ? '\u{1F3B2}' : '\u{1FA99}'}</span>
            <span className="playtest__roll-name">{entry.name}</span>
            <span className="playtest__roll-value">{formatRoll(entry.roll)}</span>
            {mine && (
              <button
                type="button"
                className="playtest__roll-dismiss"
                onClick={() => onDismiss(entry.id)}
                title="Clear this roll for everyone"
                aria-label={`Clear your roll: ${formatRoll(entry.roll)}`}
              >
                ×
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default RollLog
