export const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const
export type Color = (typeof WUBRG)[number]

export const COLOR_NAMES: Record<Color, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
}

export type ManaColorKey = Color | 'C'

/** All six mana color keys, WUBRG then colorless — the fixed vocabulary for anything that tracks
 *  per-color mana amounts (e.g. the floating mana pool; see gameReducer's GameState.floatingMana). */
export const MANA_COLOR_KEYS: readonly ManaColorKey[] = [...WUBRG, 'C']

/** A fresh all-zero mana amount, keyed by every ManaColorKey — the floating mana pool's baseline
 *  at game start and after every full empty (NEXT_TURN, CLEAR_FLOATING_MANA). */
export function zeroManaPool(): Record<ManaColorKey, number> {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
}

/** Reading order (bottom of a stacked bar to top), not draw order — see sortManaStack. */
const MANA_STACK_ORDER: readonly ManaColorKey[] = [...WUBRG, 'C']

/** Sorts a byColor map's entries for a stacked bar chart (ManaCurveChart, RampSources), where the
 *  caller draws top-down — each segment's rect starts where the previous one ended, so the FIRST
 *  entry returned here ends up as the TOPMOST segment and the LAST as the segment sitting on the
 *  baseline. Reversed against MANA_STACK_ORDER so that reading the finished bar bottom-to-top
 *  still comes out WUBRG-then-colorless, i.e. colorless renders at the very top of every bar. */
export function sortManaStack(byColor: Partial<Record<ManaColorKey, number>>): [ManaColorKey, number][] {
  return (Object.entries(byColor) as [ManaColorKey, number][]).sort(
    ([a], [b]) => MANA_STACK_ORDER.indexOf(b) - MANA_STACK_ORDER.indexOf(a),
  )
}
