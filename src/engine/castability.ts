import type { Color } from '../utils/colors'
import { multivariateHypergeomPMF } from './hypergeometric'
import { pipShapeKey, totalManaValue, type PipRequirement } from './manaCost'
import { sourceCountForColor, type ManaBase } from './manaSources'

export const MAX_TURN = 10
export const HAND_SIZE = 7
export const HIGH_CONFIDENCE_THRESHOLD = 0.9

/** Cards needing more distinct colors than this fall back to an independent approximation (see below). */
const EXACT_MODEL_MAX_COLORS = 2

export type CastabilityResult = {
  probByTurn: number[] // index t-1 = P(castable by turn t), for t = 1..MAX_TURN
  expectedTurn: number | null // null means "never reaches high confidence by MAX_TURN" (displayed as "10+")
}

/** How many cards a player has seen (opening hand + draws) by the given turn. Exported for the
 *  goldfish practice mode's "lands drawn vs. expected" stat (see PlaytestView.tsx), which needs
 *  the same sample size this module already uses for castability odds. */
export function drawsByTurn(turn: number, onPlay: boolean): number {
  return HAND_SIZE + (onPlay ? turn - 1 : turn)
}

/** Cumulative P(at least `minNeeded` cards of a single category drawn) via simple 2-category hypergeometric. */
function probAtLeast(categorySize: number, deckSize: number, sampleSize: number, minNeeded: number): number {
  if (minNeeded <= 0) return 1
  let total = 0
  const maxDraw = Math.min(categorySize, sampleSize)
  for (let x = minNeeded; x <= maxDraw; x++) {
    total += multivariateHypergeomPMF([categorySize, deckSize - categorySize], [x, sampleSize - x], deckSize, sampleSize)
  }
  return total
}

function powerSet<T>(items: T[]): T[][] {
  return items.reduce<T[][]>((subsets, item) => subsets.concat(subsets.map((s) => [...s, item])), [[]])
}

/**
 * Sums multivariateHypergeomPMF over every way to draw exactly `sampleSize`
 * cards across the given categories for which `isSatisfied` holds. The last
 * category's draw count is always the remainder, cutting one dimension off
 * the search.
 */
function enumerateAndSum(
  categorySizes: number[],
  sampleSize: number,
  deckSize: number,
  isSatisfied: (draws: number[]) => boolean,
): number {
  const k = categorySizes.length
  const draws = new Array(k).fill(0)
  let total = 0

  function recurse(index: number, remaining: number) {
    if (index === k - 1) {
      if (remaining < 0 || remaining > categorySizes[index]) return
      draws[index] = remaining
      if (isSatisfied(draws)) {
        total += multivariateHypergeomPMF(categorySizes, draws, deckSize, sampleSize)
      }
      return
    }
    const maxForThis = Math.min(categorySizes[index], remaining)
    for (let x = 0; x <= maxForThis; x++) {
      draws[index] = x
      recurse(index + 1, remaining - x)
    }
  }

  recurse(0, sampleSize)
  return total
}

/**
 * Exact joint probability for cards needing up to EXACT_MODEL_MAX_COLORS
 * distinct colors. Partitions the deck's lands via inclusion-exclusion over
 * the required colors (a land producing both required colors lands in its
 * own "both" category, so it isn't double-counted), then sums the joint
 * hypergeometric PMF over every draw outcome that satisfies both the
 * per-color minimums and the total-mana requirement.
 */
function exactJointProbability(
  manaBase: ManaBase,
  deckSize: number,
  sampleSize: number,
  colors: Color[],
  colorMinimums: Partial<Record<Color, number>>,
  totalManaNeeded: number,
): number {
  const subsets = powerSet(colors)
  const categories = subsets.map((subset) => ({ colors: subset, size: 0 }))
  const emptyIndex = categories.findIndex((c) => c.colors.length === 0)

  for (const land of manaBase.lands) {
    const relevant = colors.filter((c) => land.colors.includes(c))
    const index = categories.findIndex(
      (cat) => cat.colors.length === relevant.length && cat.colors.every((c) => relevant.includes(c)),
    )
    categories[index === -1 ? emptyIndex : index].size += land.quantity
  }

  const nonlandSize = deckSize - manaBase.totalLands
  const categorySizes = [...categories.map((c) => c.size), nonlandSize]
  const numLandCategories = categories.length

  function isSatisfied(draws: number[]): boolean {
    let totalLandDraws = 0
    for (let i = 0; i < numLandCategories; i++) totalLandDraws += draws[i]
    if (totalLandDraws < totalManaNeeded) return false

    for (const color of colors) {
      let colorDraws = 0
      for (let i = 0; i < numLandCategories; i++) {
        if (categories[i].colors.includes(color)) colorDraws += draws[i]
      }
      if (colorDraws < (colorMinimums[color] ?? 0)) return false
    }
    return true
  }

  return enumerateAndSum(categorySizes, sampleSize, deckSize, isSatisfied)
}

/**
 * Approximation for 3+ required colors: treats the total-land requirement
 * and each color's source requirement as independent, multiplying their
 * individual probabilities. Exact inclusion-exclusion partitioning grows as
 * 2^colors and stops being cheap enough to recompute live beyond 2 colors,
 * and 3+-color single-card requirements are rare enough that the
 * independence approximation's error is an acceptable trade for staying
 * responsive in the browser.
 */
function approximateJointProbability(
  manaBase: ManaBase,
  deckSize: number,
  sampleSize: number,
  colors: Color[],
  colorMinimums: Partial<Record<Color, number>>,
  totalManaNeeded: number,
): number {
  let probability = probAtLeast(manaBase.totalLands, deckSize, sampleSize, totalManaNeeded)
  for (const color of colors) {
    const sourceCount = sourceCountForColor(manaBase, color)
    probability *= probAtLeast(sourceCount, deckSize, sampleSize, colorMinimums[color] ?? 0)
  }
  return probability
}

/** P(the card is castable by the given turn), i.e. enough total lands AND enough of each required color's sources. */
export function probCastableByTurn(
  pipReq: PipRequirement,
  manaBase: ManaBase,
  deckSize: number,
  turn: number,
  onPlay: boolean,
): number {
  // A manaBase (esp. a manual override) can describe more lands than
  // deckSize accounts for (e.g. planning a 22-land manabase before the rest
  // of a 60-card deck is filled in) — never let the derived "nonland" bucket
  // go negative.
  const effectiveDeckSize = Math.max(deckSize, manaBase.totalLands)
  // Clamp to effectiveDeckSize: a small deck can't yield more draws than it
  // has cards, and the exact/approximate models below handle
  // sampleSize === effectiveDeckSize (drawing the whole deck) correctly.
  const sampleSize = Math.min(drawsByTurn(turn, onPlay), effectiveDeckSize)
  const totalManaNeeded = totalManaValue(pipReq)

  if (totalManaNeeded === 0) return 1
  if (totalManaNeeded > sampleSize) return 0

  const colors = (Object.keys(pipReq.colored) as Color[]).filter((c) => (pipReq.colored[c] ?? 0) > 0)
  const colorMinimums = pipReq.colored

  if (colors.length === 0) {
    return probAtLeast(manaBase.totalLands, effectiveDeckSize, sampleSize, totalManaNeeded)
  }
  // The exact model partitions `manaBase.lands` into disjoint categories and
  // assumes their quantities sum to totalLands. That only holds for a manaBase
  // built from real, non-overlapping land data (manaBase.exact) — a manual
  // override's per-color counts can overlap (multi-color sources), so it always
  // falls back to the independence approximation regardless of color count.
  if (colors.length <= EXACT_MODEL_MAX_COLORS && manaBase.exact) {
    return exactJointProbability(manaBase, effectiveDeckSize, sampleSize, colors, colorMinimums, totalManaNeeded)
  }
  return approximateJointProbability(manaBase, effectiveDeckSize, sampleSize, colors, colorMinimums, totalManaNeeded)
}

/**
 * Expected turn the card first becomes castable, via E[T] = sum_{t=0}^{9} P(T > t),
 * truncated at MAX_TURN. Returns expectedTurn: null (displayed as "10+") when
 * turn-10 confidence never crosses HIGH_CONFIDENCE_THRESHOLD, since the
 * truncated sum would understate the true expectation in that case.
 */
export function expectedTurnCastable(
  pipReq: PipRequirement,
  manaBase: ManaBase,
  deckSize: number,
  onPlay = true,
): CastabilityResult {
  const probByTurn: number[] = []
  for (let turn = 1; turn <= MAX_TURN; turn++) {
    probByTurn.push(probCastableByTurn(pipReq, manaBase, deckSize, turn, onPlay))
  }

  if (probByTurn[MAX_TURN - 1] < HIGH_CONFIDENCE_THRESHOLD) {
    return { probByTurn, expectedTurn: null }
  }

  let expectedTurn = 1 // the t=0 term: P(T* > 0) = 1
  for (let turn = 1; turn < MAX_TURN; turn++) {
    expectedTurn += 1 - probByTurn[turn - 1]
  }
  return { probByTurn, expectedTurn }
}

/** Computes castability once per distinct pip shape, since many cards in a deck share the same cost shape. */
export function computeCastabilityIndex(
  pipRequirements: PipRequirement[],
  manaBase: ManaBase,
  deckSize: number,
  onPlay = true,
): Map<string, CastabilityResult> {
  const index = new Map<string, CastabilityResult>()
  for (const req of pipRequirements) {
    const key = pipShapeKey(req)
    if (index.has(key)) continue
    index.set(key, expectedTurnCastable(req, manaBase, deckSize, onPlay))
  }
  return index
}
