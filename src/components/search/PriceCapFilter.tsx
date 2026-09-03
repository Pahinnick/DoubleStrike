import { formatPriceCap, nearestPriceCapIndex, PRICE_CAP_STEPS } from '../../utils/scryfallQuery'

type Props = {
  value: number | undefined
  onChange: (maxUsd: number | undefined) => void
}

const UNCAPPED_INDEX = PRICE_CAP_STEPS.length - 1

/** Budget cap for search results: a number box for an exact figure, plus a slider over the common
 *  price points for when you just want to drag to roughly "cheap". Both write the same filter. */
function PriceCapFilter({ value, onChange }: Props) {
  function setFromNumberBox(raw: string) {
    if (raw.trim() === '') return onChange(undefined)
    const parsed = Number(raw)
    // A negative or unparseable entry would build a `usd<=-3` clause that silently matches nothing.
    if (!Number.isFinite(parsed) || parsed < 0) return
    onChange(parsed)
  }

  return (
    <div className="advanced-search__row">
      <label className="advanced-search__select-field">
        <span>Max price</span>
        <input
          type="number"
          className="advanced-search__price-input"
          min={0}
          step={0.25}
          inputMode="decimal"
          placeholder="Any"
          aria-label="Maximum price in US dollars"
          value={value ?? ''}
          onChange={(event) => setFromNumberBox(event.target.value)}
        />
      </label>
      <input
        type="range"
        className="advanced-search__price-slider"
        min={0}
        max={UNCAPPED_INDEX}
        step={1}
        // A typed value that isn't one of the steps parks the handle at the closest one without
        // rewriting what was typed — dragging is what commits a step value.
        value={nearestPriceCapIndex(value)}
        aria-label="Maximum price"
        aria-valuetext={formatPriceCap(value)}
        onChange={(event) => onChange(PRICE_CAP_STEPS[Number(event.target.value)])}
      />
      <span className="advanced-search__price-readout">{formatPriceCap(value)}</span>
    </div>
  )
}

export default PriceCapFilter
