type Props = {
  /** Full class list for the outer circle (size/color come from these, e.g. "playtest__life-bubble playtest__life-bubble--life"). */
  wrapperClassName: string
  label: string
  value: number
  onChange: (delta: number) => void
}

const WEDGES: { direction: 'top' | 'bottom' | 'left' | 'right'; delta: number; deltaLabel: string }[] = [
  { direction: 'top', delta: 1, deltaLabel: '+1' },
  { direction: 'right', delta: 10, deltaLabel: '+10' },
  { direction: 'bottom', delta: -1, deltaLabel: '-1' },
  { direction: 'left', delta: -10, deltaLabel: '-10' },
]

/** A life total split into four click zones (top +1, bottom -1, left -10, right +10) instead of a
 *  single left-click-+1/right-click--1 button, so both fine and coarse adjustments are one click away. */
function HealthBubble({ wrapperClassName, label, value, onChange }: Props) {
  return (
    <div className={wrapperClassName} role="group" aria-label={`${label} ${value}`}>
      {WEDGES.map((wedge) => (
        <button
          key={wedge.direction}
          type="button"
          className={`playtest__life-wedge playtest__life-wedge--${wedge.direction}`}
          onClick={() => onChange(wedge.delta)}
          title={`${label} ${wedge.deltaLabel}`}
          aria-label={`${label} ${wedge.deltaLabel}`}
        >
          <span className={`playtest__life-wedge-label playtest__life-wedge-label--${wedge.direction}`} aria-hidden="true">
            {wedge.deltaLabel}
          </span>
        </button>
      ))}
      <span className="playtest__life-value" aria-hidden="true">
        {value}
      </span>
    </div>
  )
}

export default HealthBubble
