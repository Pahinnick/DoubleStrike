import { useState } from 'react'
import { COLOR_NAMES, WUBRG, type Color } from '../../utils/colors'
import {
  NUMERIC_COMPARATORS,
  RARITIES,
  type ColorMatch,
  type NumericComparator,
  type Rarity,
  type SearchFilters,
} from '../../utils/scryfallQuery'
import OracleTagBrowser from './OracleTagBrowser'
import TypeMultiSelect from './TypeMultiSelect'

type Filters = Omit<SearchFilters, 'format'>
type ColorKey = 'colors' | 'colorIdentity'
type ColorMatchKey = 'colorMatch' | 'colorIdentityMatch'
type StatComparatorKey = 'cmcComparator' | 'powerComparator' | 'toughnessComparator' | 'loyaltyComparator'
type StatValueKey = 'cmcValue' | 'powerValue' | 'toughnessValue' | 'loyaltyValue'

type Props = {
  filters: Filters
  onChange: (updater: (prev: Filters) => Filters) => void
}

function AdvancedSearchPanel({ filters, onChange }: Props) {
  const [otagBrowserOpen, setOtagBrowserOpen] = useState(false)

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange((prev) => ({ ...prev, [key]: value }))
  }

  function toggleColor(key: ColorKey, color: Color) {
    onChange((prev) => ({
      ...prev,
      [key]: prev[key].includes(color) ? prev[key].filter((c) => c !== color) : [...prev[key], color],
    }))
  }

  function renderColorGroup(label: string, key: ColorKey, matchKey: ColorMatchKey, ariaLabel: string) {
    return (
      <div className="advanced-search__row">
        <span className="advanced-search__label">{label}</span>
        <div className="color-filter" role="group" aria-label={ariaLabel}>
          {WUBRG.map((color) => (
            <button
              key={color}
              type="button"
              aria-pressed={filters[key].includes(color)}
              title={COLOR_NAMES[color]}
              className={`color-swatch color-swatch--${color.toLowerCase()} ${filters[key].includes(color) ? 'is-active' : ''}`}
              onClick={() => toggleColor(key, color)}
            >
              {color}
            </button>
          ))}
        </div>
        <select
          aria-label={`${ariaLabel} match mode`}
          value={filters[matchKey]}
          onChange={(event) => set(matchKey, event.target.value as ColorMatch)}
        >
          <option value=">=">At least these</option>
          <option value="=">Exactly these</option>
          <option value="<=">At most these</option>
        </select>
      </div>
    )
  }

  function renderStatField(label: string, comparatorKey: StatComparatorKey, valueKey: StatValueKey) {
    const value = filters[valueKey]
    return (
      <label className="advanced-search__stat">
        <span>{label}</span>
        <select
          aria-label={`${label} comparator`}
          value={filters[comparatorKey] ?? '='}
          onChange={(event) => set(comparatorKey, event.target.value as NumericComparator)}
        >
          {NUMERIC_COMPARATORS.map((comparator) => (
            <option key={comparator.value} value={comparator.value}>
              {comparator.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          aria-label={label}
          value={value ?? ''}
          onChange={(event) => set(valueKey, event.target.value === '' ? undefined : Number(event.target.value))}
        />
      </label>
    )
  }

  return (
    <div className="advanced-search">
      <div className="advanced-search__row">
        <label className="advanced-search__select-field advanced-search__select-field--grow">
          <span>Type line</span>
          <TypeMultiSelect types={filters.types} onChange={(types) => set('types', types)} ariaLabel="Card type" />
        </label>
      </div>

      <div className="advanced-search__row">
        <label className="advanced-search__select-field advanced-search__select-field--grow">
          <span>Card text</span>
          <input
            type="text"
            placeholder='e.g. flying, or "draw a card"'
            value={filters.cardText}
            onChange={(event) => set('cardText', event.target.value)}
          />
        </label>
      </div>

      {renderColorGroup('Colors', 'colors', 'colorMatch', 'Colors')}
      {renderColorGroup('Color Identity', 'colorIdentity', 'colorIdentityMatch', 'Color identity')}

      <div className="advanced-search__stats">
        {renderStatField('Mana value', 'cmcComparator', 'cmcValue')}
        {renderStatField('Power', 'powerComparator', 'powerValue')}
        {renderStatField('Toughness', 'toughnessComparator', 'toughnessValue')}
        {renderStatField('Loyalty', 'loyaltyComparator', 'loyaltyValue')}
      </div>

      <div className="advanced-search__row">
        <label className="advanced-search__select-field">
          <span>Rarity</span>
          <select
            value={filters.rarity ?? ''}
            onChange={(event) => set('rarity', (event.target.value || undefined) as Rarity | undefined)}
          >
            <option value="">Any</option>
            {RARITIES.map((rarity) => (
              <option key={rarity} value={rarity}>
                {rarity[0].toUpperCase() + rarity.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="advanced-search__select-field">
          <span>Set code</span>
          <input
            type="text"
            placeholder="e.g. mh3"
            value={filters.set}
            onChange={(event) => set('set', event.target.value)}
          />
        </label>
        <button type="button" onClick={() => setOtagBrowserOpen(true)}>
          OTags
        </button>
      </div>
      <OracleTagBrowser open={otagBrowserOpen} onClose={() => setOtagBrowserOpen(false)} />
    </div>
  )
}

export default AdvancedSearchPanel
