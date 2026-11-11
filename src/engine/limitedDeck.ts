/**
 * Pure helpers for building a Limited (draft) deck from a pool: suggesting basic lands and grouping
 * cards into mana-value columns. Used by components/draft/DraftDeckBuilder.
 */
import { WUBRG, type Color } from '../utils/colors'
import { computeColorPipTotals } from './deckStats'

/** The usual land count for a 40-card Limited deck. */
export const RECOMMENDED_LIMITED_LANDS = 17

export const BASIC_LAND_NAMES: Record<Color, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
}

/**
 * Splits `basicSlots` basic lands across colors in proportion to the deck's colored mana symbols
 * (largest-remainder rounding, so the counts always add up exactly). Any color with at least one
 * symbol gets at least one land when there's room. Returns all zeros if the deck has no colored
 * symbols at all (nothing to go on).
 */
export function suggestBasicLands(manaCosts: readonly string[], basicSlots: number): Record<Color, number> {
  const result: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  const slots = Math.max(0, Math.floor(basicSlots))
  const pips = computeColorPipTotals(manaCosts.map((manaCost) => ({ manaCost, quantity: 1 })))
  const colors = WUBRG.filter((color) => (pips[color] ?? 0) > 0)
  const total = colors.reduce((sum, color) => sum + (pips[color] ?? 0), 0)
  if (slots === 0 || total === 0) return result

  const shares = colors.map((color) => ({ color, exact: ((pips[color] ?? 0) / total) * slots }))
  for (const share of shares) result[share.color] = Math.floor(share.exact)
  let remaining = slots - shares.reduce((sum, share) => sum + Math.floor(share.exact), 0)
  for (const share of [...shares].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
    if (remaining <= 0) break
    result[share.color] += 1
    remaining -= 1
  }
  // A splash color rounded down to zero still needs a source or two — take it from the biggest pile.
  for (const share of shares) {
    if (result[share.color] > 0) continue
    const biggest = colors.reduce((a, b) => (result[a] >= result[b] ? a : b))
    if (result[biggest] <= 1) break
    result[biggest] -= 1
    result[share.color] += 1
  }
  return result
}

/** How many basics to add so the deck reaches the recommended land count, given the nonbasic lands
 *  already in it. */
export function basicLandSlots(nonbasicLandCount: number): number {
  return Math.max(0, RECOMMENDED_LIMITED_LANDS - nonbasicLandCount)
}

export const CURVE_COLUMNS = ['0–1', '2', '3', '4', '5', '6+'] as const
export type CurveColumn = (typeof CURVE_COLUMNS)[number] | 'Lands'

/** Which builder column a card goes in: lands get their own; spells by mana value. */
export function curveColumnOf(cmc: number, isLand: boolean): CurveColumn {
  if (isLand) return 'Lands'
  if (cmc <= 1) return '0–1'
  if (cmc >= 6) return '6+'
  return String(Math.floor(cmc)) as CurveColumn
}
