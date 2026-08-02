import { WUBRG, type Color } from '../utils/colors'
import { HIGH_CONFIDENCE_THRESHOLD, probCastableByTurn } from './castability'
import type { PipRequirement } from './manaCost'
import type { LandSource, ManaBase } from './manaSources'

export type CardCostEntry = { name: string; manaCost: string; cmc: number; quantity: number }

/** Quantity-weighted average mana value across nonland entries, 0 if there are none. */
export function averageManaValue(entries: Pick<CardCostEntry, 'cmc' | 'quantity'>[]): number {
  const totalQty = entries.reduce((sum, e) => sum + e.quantity, 0)
  if (totalQty === 0) return 0
  const weightedSum = entries.reduce((sum, e) => sum + e.cmc * e.quantity, 0)
  return weightedSum / totalQty
}

/**
 * Minimum total *lands* (out of the deck's fixed size) for ~90% confidence of hitting land drops
 * through the deck's own average mana value. Reuses probCastableByTurn's colorless branch — a
 * generic-only requirement equal to the target turn — scanning upward for the first land count
 * that clears HIGH_CONFIDENCE_THRESHOLD.
 *
 * `ramp` (mana rocks/dorks) is layered on top of every candidate land count as an already-present
 * bonus, so a deck that already runs ramp needs fewer additional lands to reach the same
 * confidence. Ramp sources are treated as available as soon as they're drawn, same as a land —
 * this overstates them slightly on the very earliest turns (a rock still costs mana to cast, and
 * a dork has summoning sickness), but matches how mana-base sizing is conventionally counted
 * (Frank Karsten's source tables count rocks/dorks alongside lands the same way) and avoids
 * modeling casting sequencing that nothing else in this engine attempts either.
 */
export function recommendTotalLands(avgNonlandCmc: number, deckSize: number, ramp: LandSource[] = []): number {
  const targetTurn = Math.max(1, Math.round(avgNonlandCmc))
  const genericReq: PipRequirement = { generic: targetTurn, colored: {}, hybrid: [], phyrexian: [], twobrid: [] }
  const rampTotal = ramp.reduce((sum, r) => sum + r.quantity, 0)
  for (let lands = 0; lands <= deckSize; lands++) {
    const allLands: LandSource[] = [...ramp]
    if (lands > 0) allLands.push({ quantity: lands, colors: [] })
    const manaBase: ManaBase = { totalLands: lands + rampTotal, lands: allLands, exact: true }
    if (probCastableByTurn(genericReq, manaBase, deckSize, targetTurn, true) >= HIGH_CONFIDENCE_THRESHOLD) return lands
  }
  return deckSize
}

/**
 * Target *source count* for each of the deck's colors, in proportion to that color's share of
 * colored mana symbols in casting costs — the classic "count your pips" heuristic, e.g. a color
 * with 40% of the deck's colored pips wants sources covering ~40% of `totalLands`.
 *
 * Each color's target is rounded independently and is deliberately allowed to sum to MORE than
 * `totalLands` — a dual land counts fully toward every color it produces (same as
 * `sourceCountForColor`'s real-deck source counting), so hitting two colors' targets at once
 * often takes far fewer than target(colorA) + target(colorB) physical lands. `totalLands` itself
 * (see `recommendTotalLands`) already covers *how many lands total* for reliably hitting land
 * drops, independent of color — that number doesn't shrink just because duals make individual
 * colors "efficient" to cover; you still want to actually draw that many lands. This function
 * only answers "of those lands, how many should be able to produce each color," which a real
 * manabase can satisfy with overlapping (dual) sources rather than disjoint ones.
 *
 * (Earlier version forced these to sum exactly to totalLands via largest-remainder rounding,
 * treating each color as a separate non-overlapping slot — that's what made the "Suggested"
 * numbers read as if you needed close to double totalLands once dual-heavy fixing was in the
 * picture. This version's numbers are now directly comparable to `sourceCountsByColor`'s real
 * per-color counts, which have always legitimately double-counted duals the same way.)
 */
export function splitLandsByColorNeed(
  totalLands: number,
  pipTotals: Partial<Record<Color, number>>,
): Partial<Record<Color, number>> {
  const colors = WUBRG.filter((c) => (pipTotals[c] ?? 0) > 0)
  const totalPips = colors.reduce((sum, c) => sum + (pipTotals[c] ?? 0), 0)
  if (totalPips === 0 || totalLands <= 0) return {}

  const result: Partial<Record<Color, number>> = {}
  for (const color of colors) {
    result[color] = Math.round((totalLands * (pipTotals[color] ?? 0)) / totalPips)
  }
  return result
}
