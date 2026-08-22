import { useEffect, useRef, useState } from 'react'

export type ChangeLogEntry = { id: string; text: string; at: number }

const MAX_ENTRIES = 8

/** What a seat's card diffs on — life/poison plus commander damage per source (keyed by seat, or
 *  the synthetic SOLO_CMDR_SOURCE in solo play). Passed fresh every render; the hook itself does
 *  the remembering. */
export type ChangeLogSnapshot = {
  life: number
  poison: number
  commanderDamage: Record<number, number>
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
 */
export function useChangeLog(snapshot: ChangeLogSnapshot, labelFor: (source: number) => string): ChangeLogEntry[] {
  const [log, setLog] = useState<ChangeLogEntry[]>([])
  const prevRef = useRef<ChangeLogSnapshot | null>(null)
  // labelFor is a fresh closure every render (it closes over commanderSources) — a ref keeps the
  // diff effect below from needing it as a dependency, so it doesn't re-run just because the
  // caller re-created the function without the underlying data actually changing.
  const labelForRef = useRef(labelFor)
  labelForRef.current = labelFor

  const commanderDamageKey = Object.entries(snapshot.commanderDamage)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([seat, value]) => `${seat}:${value}`)
    .join(',')

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = snapshot
    if (!prev) return

    const now = Date.now()
    const entries: ChangeLogEntry[] = []

    if (snapshot.life !== prev.life) {
      const delta = snapshot.life - prev.life
      entries.push({ id: `life-${now}`, text: `Life ${delta > 0 ? '+' : ''}${delta} → ${snapshot.life}`, at: now })
    }
    if (snapshot.poison !== prev.poison) {
      const delta = snapshot.poison - prev.poison
      entries.push({ id: `poison-${now}`, text: `Poison ${delta > 0 ? '+' : ''}${delta} → ${snapshot.poison}`, at: now })
    }
    const sources = new Set([...Object.keys(prev.commanderDamage), ...Object.keys(snapshot.commanderDamage)].map(Number))
    for (const source of sources) {
      const before = prev.commanderDamage[source] ?? 0
      const after = snapshot.commanderDamage[source] ?? 0
      if (before === after) continue
      const delta = after - before
      entries.push({ id: `cmdr-${source}-${now}`, text: `${labelForRef.current(source)} ${delta > 0 ? '+' : ''}${delta} → ${after}`, at: now })
    }

    if (entries.length === 0) return
    setLog((current) => [...entries, ...current].slice(0, MAX_ENTRIES))
    // snapshot's own identity changes every render; commanderDamageKey is its stable serialization
    // (life/poison are already primitives, safe to depend on directly).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.life, snapshot.poison, commanderDamageKey])

  return log
}
