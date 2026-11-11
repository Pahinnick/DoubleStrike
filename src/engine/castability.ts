import type { Color } from '../utils/colors'
import { multivariateHypergeomPMF } from './hypergeometric'
import { WUBRG } from '../utils/colors'
import { pipShapeKey, totalManaValue, type PipRequirement } from './manaCost'
import type { ManaBase } from './manaSources'

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

/** One coloured demand of a cost: `count` mana, each payable by any colour in `options`. A plain
 *  {G} pip is `{ options: ['G'], count: 1 }`; a hybrid {G/W} pip is `{ options: ['G', 'W'], count: 1 }`. */
type SourceRequirement = { options: Color[]; count: number }

/** Coloured and hybrid pips as source requirements. Twobrid ({2/G}) is left out on purpose — it
 *  can always be paid with generic mana, so it constrains the land total but no colour. */
function sourceRequirements(pipReq: PipRequirement): SourceRequirement[] {
  const requirements: SourceRequirement[] = []
  for (const color of WUBRG) {
    const count = pipReq.colored[color] ?? 0
    if (count > 0) requirements.push({ options: [color], count })
  }
  for (const group of pipReq.hybrid) {
    if (group.count > 0) requirements.push({ options: group.options, count: group.count })
  }
  return requirements
}

/** Lands that can produce at least one of the given colours, regardless of what else they produce. */
function sourceCountForAny(manaBase: ManaBase, colors: Color[]): number {
  const count = manaBase.lands.filter((l) => l.colors.some((c) => colors.includes(c))).reduce((sum, l) => sum + l.quantity, 0)
  // A manual override's per-colour counts can overlap, so their sum can exceed the land total.
  return Math.min(count, manaBase.totalLands)
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
 * hypergeometric PMF over every draw outcome that can actually pay the cost.
 *
 * "Can pay" is checked as an assignment problem, not per colour: each land pays for one pip, so
 * for every group of requirements the lands able to pay for any of them must number at least the
 * group's total. Checking each colour on its own let a single W/U dual count as both the W and
 * the U of a {W}{U} cost.
 */
function exactJointProbability(
  manaBase: ManaBase,
  deckSize: number,
  sampleSize: number,
  colors: Color[],
  requirements: SourceRequirement[],
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

  // Every non-empty group of requirements, with which land categories can pay toward it and how
  // much mana the group needs in total.
  const demandGroups = powerSet(requirements)
    .filter((group) => group.length > 0)
    .map((group) => {
      const payable = new Set(group.flatMap((r) => r.options))
      return {
        needed: group.reduce((sum, r) => sum + r.count, 0),
        categoryPays: categories.map((cat) => cat.colors.some((c) => payable.has(c))),
      }
    })

  function isSatisfied(draws: number[]): boolean {
    let totalLandDraws = 0
    for (let i = 0; i < numLandCategories; i++) totalLandDraws += draws[i]
    if (totalLandDraws < totalManaNeeded) return false

    for (const group of demandGroups) {
      let payingDraws = 0
      for (let i = 0; i < numLandCategories; i++) {
        if (group.categoryPays[i]) payingDraws += draws[i]
      }
      if (payingDraws < group.needed) return false
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
  requirements: SourceRequirement[],
  totalManaNeeded: number,
): number {
  let probability = probAtLeast(manaBase.totalLands, deckSize, sampleSize, totalManaNeeded)
  for (const requirement of requirements) {
    const sourceCount = sourceCountForAny(manaBase, requirement.options)
    probability *= probAtLeast(sourceCount, deckSize, sampleSize, requirement.count)
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

  // Hybrid pips count here too: {1}{G/W}{G/W} needs two lands that make G or W, which a
  // mono-red manabase can never supply however many lands it draws.
  const requirements = sourceRequirements(pipReq)
  const colors = WUBRG.filter((c) => requirements.some((r) => r.options.includes(c)))

  if (colors.length === 0) {
    return probAtLeast(manaBase.totalLands, effectiveDeckSize, sampleSize, totalManaNeeded)
  }
  // The exact model partitions `manaBase.lands` into disjoint categories and
  // assumes their quantities sum to totalLands. That only holds for a manaBase
  // built from real, non-overlapping land data (manaBase.exact) — a manual
  // override's per-color counts can overlap (multi-color sources), so it always
  // falls back to the independence approximation regardless of color count.
  if (colors.length <= EXACT_MODEL_MAX_COLORS && manaBase.exact) {
    return exactJointProbability(manaBase, effectiveDeckSize, sampleSize, colors, requirements, totalManaNeeded)
  }
  return approximateJointProbability(manaBase, effectiveDeckSize, sampleSize, requirements, totalManaNeeded)
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
