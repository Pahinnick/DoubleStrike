import { WUBRG, type Color } from '../utils/colors'
import { parseManaCost, requiredColors } from './manaCost'

export type CurveColorKey = Color | 'C'
export type CurveBucket = { cmc: number; total: number; byColor: Partial<Record<CurveColorKey, number>> }

const CURVE_MAX_BUCKET = 7

export type ManaCostEntry = { manaCost: string; cmc: number; quantity: number }

/** Buckets nonland cards by CMC (0..7+), splitting each bucket's height by the colors its cards actually require. */
export function computeManaCurve(entries: ManaCostEntry[]): CurveBucket[] {
  const buckets: CurveBucket[] = Array.from({ length: CURVE_MAX_BUCKET + 1 }, (_, cmc) => ({
    cmc,
    total: 0,
    byColor: {},
  }))

  for (const entry of entries) {
    const bucketIndex = Math.min(Math.max(0, Math.floor(entry.cmc)), CURVE_MAX_BUCKET)
    const bucket = buckets[bucketIndex]
    bucket.total += entry.quantity

    const colors = requiredColors(parseManaCost(entry.manaCost))
    if (colors.length === 0) {
      bucket.byColor.C = (bucket.byColor.C ?? 0) + entry.quantity
    } else {
      const share = entry.quantity / colors.length
      for (const color of colors) {
        bucket.byColor[color] = (bucket.byColor[color] ?? 0) + share
      }
    }
  }

  return buckets
}

/** Total colored pips per color across the given cards (hybrid pips split evenly across their options). */
export function computeColorPipTotals(entries: Pick<ManaCostEntry, 'manaCost' | 'quantity'>[]): Partial<Record<Color, number>> {
  const totals: Partial<Record<Color, number>> = {}

  for (const entry of entries) {
    const req = parseManaCost(entry.manaCost)
    for (const color of WUBRG) {
      const pips = req.colored[color] ?? 0
      if (pips > 0) totals[color] = (totals[color] ?? 0) + pips * entry.quantity
    }
    for (const group of req.hybrid) {
      const share = (group.count * entry.quantity) / group.options.length
      for (const color of group.options) {
        totals[color] = (totals[color] ?? 0) + share
      }
    }
  }

  return totals
}
