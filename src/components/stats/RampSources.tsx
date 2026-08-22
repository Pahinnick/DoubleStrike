import { useMemo } from 'react'
import type { CastabilityResult } from '../../engine/castability'
import type { CurveColorKey } from '../../engine/deckStats'
import { parseManaCost, pipShapeKey } from '../../engine/manaCost'
import { sortManaStack } from '../../utils/colors'

export type RampEntry = { name: string; quantity: number; manaCost: string; colors: string[] }

type Props = {
  entries: RampEntry[]
  castabilityIndex: Map<string, CastabilityResult>
}

type RampBucket = { label: string; sortKey: number; total: number; byColor: Partial<Record<CurveColorKey, number>> }

function colorFill(color: CurveColorKey): string {
  return `var(--color-${color.toLowerCase()})`
}

/** Buckets ramp sources by their avg-turn-online (rounded to match the old table's display),
 *  splitting each bar's height by the colors each source actually produces — same idea as
 *  computeManaCurve's byColor split, just keyed on avg turn instead of CMC. */
function bucketByAvgTurn(rows: { quantity: number; colors: string[]; avgTurn: number | null }[]): RampBucket[] {
  const buckets = new Map<string, RampBucket>()
  for (const row of rows) {
    const key = row.avgTurn === null ? 'none' : row.avgTurn.toFixed(1)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { label: row.avgTurn === null ? '10+' : key, sortKey: row.avgTurn ?? Infinity, total: 0, byColor: {} }
      buckets.set(key, bucket)
    }
    bucket.total += row.quantity
    const colors = (row.colors.length > 0 ? row.colors : ['C']) as CurveColorKey[]
    const share = row.quantity / colors.length
    for (const color of colors) {
      bucket.byColor[color] = (bucket.byColor[color] ?? 0) + share
    }
  }
  return [...buckets.values()].sort((a, b) => a.sortKey - b.sortKey)
}

function RampSources({ entries, castabilityIndex }: Props) {
  const rows = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        avgTurn: castabilityIndex.get(pipShapeKey(parseManaCost(entry.manaCost)))?.expectedTurn ?? null,
      })),
    [entries, castabilityIndex],
  )

  const buckets = useMemo(() => bucketByAvgTurn(rows), [rows])

  if (rows.length === 0) return null

  const totalSources = rows.reduce((sum, row) => sum + row.quantity, 0)
  const maxTotal = Math.max(1, ...buckets.map((b) => b.total))

  return (
    <div
      className="ramp-sources"
      title="Mana rocks and dorks — counted as extra mana sources in Avg Turn and the Mana Base suggestions above"
    >
      <h3>
        Ramp <span className="ramp-sources__count">({totalSources} source{totalSources > 1 ? 's' : ''})</span>
      </h3>
      {/* Plain flexbox bars, not a scaled SVG — a deck with many distinct-cost ramp sources needs
       *  many bars, and an SVG viewBox stretched or shrunk to fit distorts (via preserveAspectRatio)
       *  either the whole chart's height (aspect-ratio-preserving scale, squashing it flat) or, with
       *  preserveAspectRatio="none", the axis-label text glyphs themselves (non-uniform x/y scaling
       *  stretches or squishes the letterforms). Flex items just shrink in width like any other
       *  responsive layout, and text stays normal DOM text at a fixed, legible size regardless of
       *  how many buckets there are. */}
      <div className="ramp-chart" role="img" aria-label="Ramp sources by average turn online">
        {buckets.map((bucket) => {
          const segments = sortManaStack(bucket.byColor)
          return (
            <div key={bucket.label} className="ramp-chart__col">
              <div className="ramp-chart__bar" style={{ height: `${(bucket.total / maxTotal) * 100}%` }}>
                {segments.map(([color, count]) => (
                  <div
                    key={color}
                    className="ramp-chart__segment"
                    style={{ height: `${(count / bucket.total) * 100}%`, backgroundColor: colorFill(color) }}
                  />
                ))}
              </div>
              <span className="ramp-chart__label">{bucket.label}</span>
            </div>
          )
        })}
      </div>
      <p className="ramp-chart__axis-label">Avg turn online</p>
    </div>
  )
}

export default RampSources
