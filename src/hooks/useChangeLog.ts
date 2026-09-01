import { useEffect, useRef, useState } from 'react'

export type ChangeLogEntry = { id: string; text: string; at: number }

const MAX_ENTRIES = 8
// How long a run of same-stat changes stays "live" for coalescing — a mash of +1 clicks on the
// same stat a couple seconds apart still reads as one gesture and collapses into a single entry
// (its delta growing in place) instead of spamming the log with one line per click. Long enough to
// cover a realistic flurry of clicks, short enough that a later, clearly separate adjustment to
// the same stat still gets its own line.
const COALESCE_WINDOW_MS = 2000

/** What a seat's card diffs on — life/poison plus commander damage per source (keyed by seat, or
 *  the synthetic SOLO_CMDR_SOURCE in solo play). Passed fresh every render; the hook itself does
 *  the remembering. */
export type ChangeLogSnapshot = {
  life: number
  poison: number
  commanderDamage: Record<number, number>
}

/** An in-progress run of same-stat changes being coalesced into one log entry — see
 *  COALESCE_WINDOW_MS. `entryId` names which log entry is currently absorbing new deltas;
 *  `startValue` is the stat's value from before the run began, so the entry's delta is always
 *  "total change over the whole run," not just the latest single step. */
type CoalesceStreak = { entryId: string; startValue: number; lastUpdatedAt: number }

function formatEntry(label: string, delta: number, after: number): string {
  return `${label} ${delta > 0 ? '+' : ''}${delta} → ${after}`
}

/**
 * Derives a small "what just changed" log for a seat's card by diffing this snapshot against the
 * previous one on every render — works for opponents' cards too, not just your own, since it only
 * needs the same public totals SeatOverlay already renders (life/poison/commanderDamage), not an
 * actual event stream over the wire. `labelFor` names a commander-damage source (a seat number,
 * or SOLO_CMDR_SOURCE) for its log line.
 *
 * Purely local/ephemeral — never synced, never persisted, capped at MAX_ENTRIES (oldest falls
 * off). The very first snapshot a seat is seen at (mount, or a fresh join) logs nothing: there's
 * nothing to diff against yet, and treating "0 → its starting life" as a loggable change would
 * just be noise every single time.
 *
 * A rapid run of changes to the SAME stat (mashing the +1/-1 life buttons, say) coalesces into one
 * entry whose delta grows in place, rather than one line per click — see COALESCE_WINDOW_MS. The
 * run breaks (a fresh entry starts) once something else gets logged in between, or the window
 * lapses — see the position-0 check below.
 */
export function useChangeLog(snapshot: ChangeLogSnapshot, labelFor: (source: number) => string): ChangeLogEntry[] {
  const [log, setLog] = useState<ChangeLogEntry[]>([])
  const prevRef = useRef<ChangeLogSnapshot | null>(null)
  // labelFor is a fresh closure every render (it closes over commanderSources) — a ref keeps the
  // diff effect below from needing it as a dependency, so it doesn't re-run just because the
  // caller re-created the function without the underlying data actually changing.
  const labelForRef = useRef(labelFor)
  labelForRef.current = labelFor
  // One streak per stat kind ('life', 'poison', or `cmdr-${source}`) — see CoalesceStreak's doc.
  const streaksRef = useRef(new Map<string, CoalesceStreak>())

  const commanderDamageKey = Object.entries(snapshot.commanderDamage)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([seat, value]) => `${seat}:${value}`)
    .join(',')

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = snapshot
    if (!prev) return

    const now = Date.now()
    const diffs: { kindId: string; label: string; before: number; after: number }[] = []

    if (snapshot.life !== prev.life) diffs.push({ kindId: 'life', label: 'Life', before: prev.life, after: snapshot.life })
    if (snapshot.poison !== prev.poison) diffs.push({ kindId: 'poison', label: 'Poison', before: prev.poison, after: snapshot.poison })
    const sources = new Set([...Object.keys(prev.commanderDamage), ...Object.keys(snapshot.commanderDamage)].map(Number))
    for (const source of sources) {
      const before = prev.commanderDamage[source] ?? 0
      const after = snapshot.commanderDamage[source] ?? 0
      if (before === after) continue
      diffs.push({ kindId: `cmdr-${source}`, label: labelForRef.current(source), before, after })
    }
    if (diffs.length === 0) return

    setLog((current) => {
      let next = current
      for (const diff of diffs) {
        const streak = streaksRef.current.get(diff.kindId)
        // Coalesce only if that streak's entry is still the very top of the log — if anything
        // else got logged since (another stat, or another seat's card re-rendering into the same
        // list... though this hook's log is per-card, so realistically just "a different stat"),
        // the run is over even if the window hasn't lapsed yet.
        const canCoalesce = streak && now - streak.lastUpdatedAt <= COALESCE_WINDOW_MS && next[0]?.id === streak.entryId
        if (canCoalesce) {
          const totalDelta = diff.after - streak.startValue
          next = [{ id: streak.entryId, text: formatEntry(diff.label, totalDelta, diff.after), at: now }, ...next.slice(1)]
          streaksRef.current.set(diff.kindId, { ...streak, lastUpdatedAt: now })
        } else {
          const id = `${diff.kindId}-${now}`
          const delta = diff.after - diff.before
          next = [{ id, text: formatEntry(diff.label, delta, diff.after), at: now }, ...next].slice(0, MAX_ENTRIES)
          streaksRef.current.set(diff.kindId, { entryId: id, startValue: diff.before, lastUpdatedAt: now })
        }
      }
      return next
    })
    // snapshot's own identity changes every render; commanderDamageKey is its stable serialization
    // (life/poison are already primitives, safe to depend on directly).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.life, snapshot.poison, commanderDamageKey])

  return log
}
