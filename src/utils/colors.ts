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
