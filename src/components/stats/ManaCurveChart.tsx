import { WUBRG } from '../../utils/colors'
import type { CurveBucket, CurveColorKey } from '../../engine/deckStats'

type Props = {
  buckets: CurveBucket[]
}

const BAR_WIDTH = 26
const GAP = 6
const CHART_HEIGHT = 90
const LABEL_SPACE = 16

// Standard WUBRG order, colorless last — bucket.byColor's own key order just reflects whichever
// color happened to be encountered first while scanning the deck's cards, so each bar's color
// stacking order was effectively random/data-dependent without this.
const COLOR_ORDER: readonly CurveColorKey[] = [...WUBRG, 'C']

function colorFill(color: CurveColorKey): string {
  return `var(--color-${color.toLowerCase()})`
}

function ManaCurveChart({ buckets }: Props) {
  const maxTotal = Math.max(1, ...buckets.map((b) => b.total))
  const width = buckets.length * (BAR_WIDTH + GAP)

  return (
    <svg
      viewBox={`0 0 ${width} ${CHART_HEIGHT + LABEL_SPACE}`}
      className="mana-curve-chart"
      role="img"
      aria-label="Mana curve by converted mana cost"
    >
      {buckets.map((bucket, index) => {
        const x = index * (BAR_WIDTH + GAP)
        let yOffset = CHART_HEIGHT - (bucket.total / maxTotal) * CHART_HEIGHT
        const segments = (Object.entries(bucket.byColor) as [CurveColorKey, number][]).sort(
          ([a], [b]) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b),
        )

        return (
          <g key={bucket.cmc}>
            {segments.map(([color, count]) => {
              const segmentHeight = (count / maxTotal) * CHART_HEIGHT
              const rect = (
                <rect key={color} x={x} y={yOffset} width={BAR_WIDTH} height={segmentHeight} fill={colorFill(color)} />
              )
              yOffset += segmentHeight
              return rect
            })}
            <text x={x + BAR_WIDTH / 2} y={CHART_HEIGHT + 12} textAnchor="middle" fontSize="9" fill="var(--text-dim)">
              {bucket.cmc === 7 ? '7+' : bucket.cmc}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default ManaCurveChart
