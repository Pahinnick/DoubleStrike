import { COLOR_NAMES, WUBRG, type Color } from '../../utils/colors'
import { sourceCountsByColor, type ManaBase } from '../../engine/manaSources'
import type { ManaBaseOverride } from '../../state/types'

type Props = {
  autoManaBase: ManaBase
  override: ManaBaseOverride | undefined
  onChangeOverride: (override: ManaBaseOverride | undefined) => void
  recommendedTotalLands: number
  suggestedLandsByColor: Partial<Record<Color, number>>
}

function ManaBaseControls({ autoManaBase, override, onChangeOverride, recommendedTotalLands, suggestedLandsByColor }: Props) {
  const isManual = override !== undefined
  const autoCounts = sourceCountsByColor(autoManaBase, WUBRG)
  const displayCounts = isManual ? override.sourceCounts : autoCounts
  const displayTotalLands = isManual ? override.totalLands : autoManaBase.totalLands

  function currentBase(): ManaBaseOverride {
    return override ?? { totalLands: autoManaBase.totalLands, sourceCounts: autoCounts }
  }

  function toggleManual() {
    onChangeOverride(isManual ? undefined : currentBase())
  }

  function updateCount(color: Color, value: number) {
    const base = currentBase()
    onChangeOverride({ ...base, sourceCounts: { ...base.sourceCounts, [color]: value } })
  }

  function updateTotalLands(value: number) {
    onChangeOverride({ ...currentBase(), totalLands: value })
  }

  return (
    <div className="mana-base-controls">
      <div className="mana-base-controls__header">
        <h3>Mana Base</h3>
        <label className="mana-base-controls__manual-toggle">
          <input type="checkbox" checked={isManual} onChange={toggleManual} /> Manual
        </label>
      </div>
      <label className="mana-base-controls__row">
        <span>Total lands</span>
        {recommendedTotalLands > 0 && (
          <span className="mana-base-controls__hint" title="Lands needed for ~90% confidence of hitting land drops through your deck's average mana value">
            Suggested: {recommendedTotalLands}
          </span>
        )}
        <input
          type="number"
          min={0}
          value={displayTotalLands}
          disabled={!isManual}
          onChange={(event) => updateTotalLands(Number(event.target.value))}
        />
      </label>
      {WUBRG.map((color) => {
        const suggested = suggestedLandsByColor[color]
        return (
          <label key={color} className="mana-base-controls__row">
            <span>{COLOR_NAMES[color]}</span>
            {suggested !== undefined && (
              <span
                className="mana-base-controls__hint"
                title={`${suggested} sources able to produce ${COLOR_NAMES[color]}, based on its share of the mana symbols in your casting costs — dual lands count toward more than one color's target, so this can add up to more than your total land count`}
              >
                Suggested: {suggested}
              </span>
            )}
            <input
              type="number"
              min={0}
              value={displayCounts[color] ?? 0}
              disabled={!isManual}
              onChange={(event) => updateCount(color, Number(event.target.value))}
            />
          </label>
        )
      })}
    </div>
  )
}

export default ManaBaseControls
