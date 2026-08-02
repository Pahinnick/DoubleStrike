export const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const
export type Color = (typeof WUBRG)[number]

export const COLOR_NAMES: Record<Color, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
}
