import { WUBRG, type Color } from '../../utils/colors'

type Props = {
  totals: Partial<Record<Color, number>>
}

const CENTER = 50
const OUTER_RADIUS = 42
const INNER_RADIUS = 24

function arcPath(startAngle: number, endAngle: number): string {
  const x1 = CENTER + OUTER_RADIUS * Math.cos(startAngle)
  const y1 = CENTER + OUTER_RADIUS * Math.sin(startAngle)
  const x2 = CENTER + OUTER_RADIUS * Math.cos(endAngle)
  const y2 = CENTER + OUTER_RADIUS * Math.sin(endAngle)
  const ix1 = CENTER + INNER_RADIUS * Math.cos(endAngle)
  const iy1 = CENTER + INNER_RADIUS * Math.sin(endAngle)
  const ix2 = CENTER + INNER_RADIUS * Math.cos(startAngle)
  const iy2 = CENTER + INNER_RADIUS * Math.sin(startAngle)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${largeArc} 0 ${ix2} ${iy2} Z`
}

function ColorPieChart({ totals }: Props) {
  const entries = WUBRG.map((color) => [color, totals[color] ?? 0] as [Color, number]).filter(([, value]) => value > 0)
  const grandTotal = entries.reduce((sum, [, value]) => sum + value, 0)

  if (grandTotal === 0) {
    return <p className="search-status">No colored pips yet.</p>
  }

  let cumulativeAngle = -Math.PI / 2

  return (
    <svg viewBox="0 0 100 100" className="color-pie-chart" role="img" aria-label="Colored mana pip distribution">
      {entries.map(([color, value]) => {
        const angle = (value / grandTotal) * Math.PI * 2
        const path = arcPath(cumulativeAngle, cumulativeAngle + angle)
        cumulativeAngle += angle
        return <path key={color} d={path} fill={`var(--color-${color.toLowerCase()})`} />
      })}
    </svg>
  )
}

export default ColorPieChart
