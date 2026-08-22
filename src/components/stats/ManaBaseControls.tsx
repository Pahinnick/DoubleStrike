import { COLOR_NAMES, WUBRG, type Color } from '../../utils/colors'
import { sourceCountsByColor, type ManaBase } from '../../engine/manaSources'
import { evaluateCoverage, type CoverageVerdict } from '../../engine/manaRecommendation'
import type { ManaBaseOverride } from '../../state/types'

type Props = {
  autoManaBase: ManaBase
  override: ManaBaseOverride | undefined
  onChangeOverride: (override: ManaBaseOverride | undefined) => void
  recommendedTotalLands: number
  suggestedLandsByColor: Partial<Record<Color, number>>
  landDropConfidence: number
  onChangeLandDropConfidence: (confidence: number) => void
}

// Plain-language verdicts instead of a "Suggested: N" number next to the player's own count —
// once dual lands are in the mix those two numbers are legitimately allowed to disagree (see
// evaluateCoverage), and asking new players to reconcile them read as a bug in the tool.
const TOTAL_LANDS_VERDICT_TEXT: Record<CoverageVerdict, string> = {
  low: 'Add more lands',
  good: 'On track',
  high: 'On track',
}

const COLOR_VERDICT_TEXT: Record<CoverageVerdict, string> = {
  low: 'Needs more sources',
  good: 'Looks good',
  high: 'Plenty of sources',
}

function ManaBaseControls({
  autoManaBase,
  override,
  onChangeOverride,
  recommendedTotalLands,
  suggestedLandsByColor,
  landDropConfidence,
  onChangeLandDropConfidence,
}: Props) {
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
      <div className="mana-base-controls__confidence">
        <label className="mana-base-controls__confidence-label" htmlFor="land-drop-confidence">
          <span>Target land-drop rate</span>
          <span className="mana-base-controls__confidence-value">{Math.round(landDropConfidence * 100)}%</span>
        </label>
        <input
          id="land-drop-confidence"
          type="range"
          min={50}
          max={95}
          step={1}
          value={Math.round(landDropConfidence * 100)}
          onChange={(event) => onChangeLandDropConfidence(Number(event.target.value) / 100)}
        />
        <p className="mana-base-controls__confidence-hint">
          How often you want to have drawn enough lands to hit your land drops on curve, through your deck's average mana value.
          This is what "Total lands" below is solved for — higher means a more consistent draw but recommends more lands, leaving
          fewer slots for spells.
        </p>
      </div>
      <label className="mana-base-controls__row">
        <span>Total lands</span>
        {recommendedTotalLands > 0 && (
          <span
            className={`mana-base-controls__hint mana-base-controls__hint--${evaluateCoverage(displayTotalLands, recommendedTotalLands)}`}
            title={`${recommendedTotalLands} lands needed for a ${Math.round(landDropConfidence * 100)}% chance of hitting land drops through your deck's average mana value (see the slider above)`}
          >
            {TOTAL_LANDS_VERDICT_TEXT[evaluateCoverage(displayTotalLands, recommendedTotalLands)]}
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
        const actual = displayCounts[color] ?? 0
        const verdict = suggested !== undefined ? evaluateCoverage(actual, suggested) : undefined
        return (
          <label key={color} className="mana-base-controls__row">
            <span>{COLOR_NAMES[color]}</span>
            {verdict !== undefined && (
              <span
                className={`mana-base-controls__hint mana-base-controls__hint--${verdict}`}
                title={`Aiming for ${suggested} sources able to produce ${COLOR_NAMES[color]}, based on its share of the mana symbols in your casting costs. You currently have ${actual}. Dual lands count toward every color they produce, so your color counts can add up to more than your total land count — that's expected, not a bug.`}
              >
                {COLOR_VERDICT_TEXT[verdict]}
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
