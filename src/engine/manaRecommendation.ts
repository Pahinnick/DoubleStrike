import { WUBRG, type Color } from '../utils/colors'
import { probCastableByTurn } from './castability'
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
 * Default land-drop confidence for `recommendTotalLands` when the player hasn't set their own via
 * the Mana Base panel's slider. Deliberately lower than castability.ts's HIGH_CONFIDENCE_THRESHOLD
 * (0.9, "tournament-grade" consistency by Frank Karsten's source tables) — that stricter bar is
 * what made this tool's land recommendations read as "more than typical" to players used to a
 * looser, more casual manabase. 0.8 lands closer to what a casual/EDH manabase actually runs while
 * still being a deliberate, explainable choice rather than an arbitrary lower number.
 */
export const DEFAULT_LAND_DROP_CONFIDENCE = 0.8

/**
 * Minimum total *lands* (out of the deck's fixed size) for `confidence` probability of hitting
 * land drops through the deck's own average mana value. Reuses probCastableByTurn's colorless
 * branch — a generic-only requirement equal to the target turn — scanning upward for the first
 * land count that clears `confidence`.
 *
 * `confidence` is user-facing (the Mana Base panel's "Target land-drop rate" slider) precisely
 * because it's a preference, not a fact — how many lands is "enough" depends on how much
 * inconsistency a player is willing to accept in exchange for more spell slots. See
 * DEFAULT_LAND_DROP_CONFIDENCE for why 0.8 is the baseline rather than castability's stricter 0.9.
 *
 * `ramp` (mana rocks/dorks) is layered on top of every candidate land count as an already-present
 * bonus, so a deck that already runs ramp needs fewer additional lands to reach the same
 * confidence. Ramp sources are treated as available as soon as they're drawn, same as a land —
 * this overstates them slightly on the very earliest turns (a rock still costs mana to cast, and
 * a dork has summoning sickness), but matches how mana-base sizing is conventionally counted
 * (Frank Karsten's source tables count rocks/dorks alongside lands the same way) and avoids
 * modeling casting sequencing that nothing else in this engine attempts either.
 */
export function recommendTotalLands(
  avgNonlandCmc: number,
  deckSize: number,
  ramp: LandSource[] = [],
  confidence: number = DEFAULT_LAND_DROP_CONFIDENCE,
): number {
  const targetTurn = Math.max(1, Math.round(avgNonlandCmc))
  const genericReq: PipRequirement = { generic: targetTurn, colored: {}, hybrid: [], phyrexian: [], twobrid: [] }
  const rampTotal = ramp.reduce((sum, r) => sum + r.quantity, 0)
  for (let lands = 0; lands <= deckSize; lands++) {
    const allLands: LandSource[] = [...ramp]
    if (lands > 0) allLands.push({ quantity: lands, colors: [] })
    const manaBase: ManaBase = { totalLands: lands + rampTotal, lands: allLands, exact: true }
    if (probCastableByTurn(genericReq, manaBase, deckSize, targetTurn, true) >= confidence) return lands
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

export type CoverageVerdict = 'low' | 'good' | 'high'

// A dual land legitimately counts toward more than one color's target (see splitLandsByColorNeed's
// doc comment), so "current" routinely and correctly overshoots "suggested" — that's not a problem
// worth flagging. These bands only need to catch a genuine shortfall or a genuine glut.
const LOW_RATIO = 0.85
const HIGH_RATIO = 1.4

/**
 * Buckets an actual source/land count against its suggested target into a plain-language verdict
 * instead of leaving players to eyeball two numbers side by side. Comparing the raw numbers reads
 * as broken once dual lands are in the mix — "Current: 27" next to "Suggested: 19" looks like a
 * bug even though it's the correct, expected result of overlapping color coverage. A qualitative
 * verdict sidesteps that entirely: it never asks the player to reconcile numbers that were never
 * meant to match.
 */
export function evaluateCoverage(actual: number, suggested: number): CoverageVerdict {
  if (suggested <= 0) return 'good'
  const ratio = actual / suggested
  if (ratio < LOW_RATIO) return 'low'
  if (ratio > HIGH_RATIO) return 'high'
  return 'good'
}
