import type { CounterColor, CounterPile, PtCounterPile } from '../../net/protocol'

export type { CounterColor, CounterPile, PtCounterPile }

/** Curated palette for the "Add Counter" and "Add Power/Toughness Counter" context-menu submenus
 *  — picked to read distinctly at battlefield-card scale, not tied to WUBRG mana identity. Nothing
 *  enforces what a pile is actually used for; the color is just a player-chosen visual tag (used
 *  for freeform piles like loyalty, charge, or poison). */
export const COUNTER_COLORS: { id: CounterColor; label: string; swatch: string }[] = [
  { id: 'green', label: 'Green', swatch: '#3f9142' },
  { id: 'red', label: 'Red', swatch: '#b3432f' },
  { id: 'blue', label: 'Blue', swatch: '#3a6fa8' },
  { id: 'black', label: 'Black', swatch: '#4a4a54' },
  { id: 'gold', label: 'Gold', swatch: '#c99a3a' },
  { id: 'colorless', label: 'Colorless', swatch: '#8a8a94' },
]

/** Curated list of standard keyword-ability counters for the "Add Keyword Counter" submenu — the
 *  kind granted by effects like Kamigawa's channel/modified cards. Each gets its own id (so it
 *  never merges with an unrelated pile) and a short `abbrev` shown on the chip instead of a
 *  running count, since these are typically single-instance "you have this ability now" markers
 *  rather than a value that's meaningful to stack. */
export const KEYWORD_COUNTERS: { id: CounterColor; label: string; swatch: string; abbrev: string }[] = [
  { id: 'flying', label: 'Flying', swatch: '#5b8fc7', abbrev: 'FLY' },
  { id: 'firststrike', label: 'First Strike', swatch: '#c78a4a', abbrev: 'FS' },
  { id: 'doublestrike', label: 'Double Strike', swatch: '#c75a4a', abbrev: 'DS' },
  { id: 'deathtouch', label: 'Deathtouch', swatch: '#4a6b3a', abbrev: 'DT' },
  { id: 'trample', label: 'Trample', swatch: '#8a6a3f', abbrev: 'TRM' },
  { id: 'vigilance', label: 'Vigilance', swatch: '#c7ac4a', abbrev: 'VIG' },
  { id: 'lifelink', label: 'Lifelink', swatch: '#c75a92', abbrev: 'LL' },
  { id: 'hexproof', label: 'Hexproof', swatch: '#4ac78a', abbrev: 'HXP' },
  { id: 'indestructible', label: 'Indestructible', swatch: '#8a4ac7', abbrev: 'IND' },
  { id: 'menace', label: 'Menace', swatch: '#5b4ac7', abbrev: 'MEN' },
  { id: 'reach', label: 'Reach', swatch: '#3a8a6b', abbrev: 'RCH' },
  { id: 'haste', label: 'Haste', swatch: '#c76a2f', abbrev: 'HST' },
]

const ALL_COUNTER_KINDS: { id: CounterColor; swatch: string }[] = [...COUNTER_COLORS, ...KEYWORD_COUNTERS]

export function swatchFor(color: CounterColor): string {
  return ALL_COUNTER_KINDS.find((c) => c.id === color)?.swatch ?? '#8a8a94'
}

export function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

/** Display text for a generic counter pile's chip — a keyword-counter pile shows its abbreviation
 *  (with a ×N suffix once the count strays from the default 1) instead of a signed running total,
 *  since "FLY" reads better than "+1" for a boolean-ish ability marker. Freeform color piles keep
 *  the old signed-number look. */
export function counterPileLabel(pile: { color: CounterColor; value: number }): string {
  const keyword = KEYWORD_COUNTERS.find((k) => k.id === pile.color)
  if (!keyword) return formatSigned(pile.value)
  return pile.value === 1 ? keyword.abbrev : `${keyword.abbrev}×${pile.value}`
}

/** Full name for a counter pile's tooltip — falls back to a generic "<Color> counter" for the
 *  freeform color piles, which have no inherent meaning beyond their tag color. */
export function counterPileName(color: CounterColor): string {
  return KEYWORD_COUNTERS.find((k) => k.id === color)?.label ?? `${COUNTER_COLORS.find((c) => c.id === color)?.label ?? 'Counter'} counter`
}

export function formatPtCounters(pt: { power: number; toughness: number }): string {
  return `${formatSigned(pt.power)}/${formatSigned(pt.toughness)}`
}
