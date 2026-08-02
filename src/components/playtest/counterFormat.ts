import type { CounterColor, CounterPile, PtCounterPile } from '../../net/protocol'

export type { CounterColor, CounterPile, PtCounterPile }

/** Curated palette for the "Add Counter" context-menu submenu — picked to read distinctly at
 *  battlefield-card scale, not tied to WUBRG mana identity. Nothing enforces what a pile is
 *  actually used for; the color is just a player-chosen visual tag. */
export const COUNTER_COLORS: { id: CounterColor; label: string; swatch: string }[] = [
  { id: 'green', label: 'Green', swatch: '#3f9142' },
  { id: 'red', label: 'Red', swatch: '#b3432f' },
  { id: 'blue', label: 'Blue', swatch: '#3a6fa8' },
  { id: 'black', label: 'Black', swatch: '#4a4a54' },
  { id: 'gold', label: 'Gold', swatch: '#c99a3a' },
  { id: 'colorless', label: 'Colorless', swatch: '#8a8a94' },
]

export function swatchFor(color: CounterColor): string {
  return COUNTER_COLORS.find((c) => c.id === color)?.swatch ?? '#8a8a94'
}

export function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

export function formatPtCounters(pt: { power: number; toughness: number }): string {
  return `${formatSigned(pt.power)}/${formatSigned(pt.toughness)}`
}
