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

const BAR_WIDTH = 34
const GAP = 8
const CHART_HEIGHT = 95
const LABEL_SPACE = 18

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
  const width = buckets.length * (BAR_WIDTH + GAP)

  return (
    <div
      className="ramp-sources"
      title="Mana rocks and dorks — counted as extra mana sources in Avg Turn and the Mana Base suggestions above"
    >
      <h3>
        Ramp <span className="ramp-sources__count">({totalSources} source{totalSources > 1 ? 's' : ''})</span>
      </h3>
      <svg
        viewBox={`0 0 ${width} ${CHART_HEIGHT + LABEL_SPACE}`}
        width={width}
        height={CHART_HEIGHT + LABEL_SPACE}
        className="ramp-chart"
        role="img"
        aria-label="Ramp sources by average turn online"
      >
        {buckets.map((bucket, index) => {
          const x = index * (BAR_WIDTH + GAP)
          let yOffset = CHART_HEIGHT - (bucket.total / maxTotal) * CHART_HEIGHT
          const segments = sortManaStack(bucket.byColor)

          return (
            <g key={bucket.label}>
              {segments.map(([color, count]) => {
                const segmentHeight = (count / maxTotal) * CHART_HEIGHT
                const rect = (
                  <rect key={color} x={x} y={yOffset} width={BAR_WIDTH} height={segmentHeight} fill={colorFill(color)} />
                )
                yOffset += segmentHeight
                return rect
              })}
              <text x={x + BAR_WIDTH / 2} y={CHART_HEIGHT + 12} textAnchor="middle" fontSize="9" fill="var(--text-dim)">
                {bucket.label}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="ramp-chart__axis-label">Avg turn online</p>
    </div>
  )
}

export default RampSources
