import { describe, expect, it } from 'vitest'
import { choose } from './hypergeometric'
import {
  computeCastabilityIndex,
  drawsByTurn,
  expectedTurnCastable,
  HAND_SIZE,
  HIGH_CONFIDENCE_THRESHOLD,
  MAX_TURN,
  probCastableByTurn,
} from './castability'
import { parseManaCost } from './manaCost'
import { deriveManaBase, manaBaseFromOverride } from './manaSources'

describe('drawsByTurn', () => {
  it('opening hand only on turn 1 while on the play', () => {
    expect(drawsByTurn(1, true)).toBe(HAND_SIZE)
  })

  it('adds one draw per turn thereafter while on the play', () => {
    expect(drawsByTurn(2, true)).toBe(HAND_SIZE + 1)
    expect(drawsByTurn(3, true)).toBe(HAND_SIZE + 2)
  })

  it('draws on turn 1 too when not on the play', () => {
    expect(drawsByTurn(1, false)).toBe(HAND_SIZE + 1)
  })
})

describe('probCastableByTurn', () => {
  it('is always 1 for a free spell (0 mana value)', () => {
    const manaBase = deriveManaBase([{ quantity: 17, producedMana: ['U'] }])
    const req = parseManaCost('')
    expect(probCastableByTurn(req, manaBase, 40, 1, true)).toBe(1)
  })

  it('is 0 when the cost exceeds every possible draw by that turn', () => {
    const manaBase = deriveManaBase([{ quantity: 17, producedMana: ['U'] }])
    const req = parseManaCost('{10}{U}')
    expect(probCastableByTurn(req, manaBase, 40, 1, true)).toBe(0)
  })

  it('matches the closed-form single-category hypergeometric probability when total mana equals the one colored pip', () => {
    // A card costing just {U}: total mana needed (1) equals the pip
    // requirement (1), so "enough total lands" is implied by "enough U
    // sources" and the joint model must collapse to the simple closed form:
    // P(>=1 U source in sampleSize draws) = 1 - C(deckSize-sources, sampleSize) / C(deckSize, sampleSize).
    const deckSize = 40
    const sources = 8
    const otherLands = 9
    const manaBase = deriveManaBase([
      { quantity: sources, producedMana: ['U'] },
      { quantity: otherLands, producedMana: [] },
    ])
    const req = parseManaCost('{U}')
    const sampleSize = 7 // turn 1, on the play

    const result = probCastableByTurn(req, manaBase, deckSize, 1, true)
    const expected = 1 - choose(deckSize - sources, sampleSize) / choose(deckSize, sampleSize)
    expect(result).toBeCloseTo(expected, 10)
  })

  it("does not overstate a card's colored requirement from its full CMC (the {5}{B} motivating case)", () => {
    // A {5}{B} card should be roughly as castable, color-wise, as a {5}{U}
    // card in the same deck (both need just 1 pip of their color) — NOT
    // dramatically harder because it "looks like" a 6-mana black-intensive
    // card. With modest black sources it should still reach high confidence
    // by a reasonable turn, not require heavy black density.
    const manaBase = deriveManaBase([
      { quantity: 8, producedMana: ['B'] },
      { quantity: 9, producedMana: ['U'] },
    ])
    const deckSize = 40
    const bCost = parseManaCost('{5}{B}')
    const uCost = parseManaCost('{5}{U}')
    const probB = probCastableByTurn(bCost, manaBase, deckSize, 6, true)
    const probU = probCastableByTurn(uCost, manaBase, deckSize, 6, true)
    // Same total mana value, same single-pip structure, comparable source
    // counts (8 vs 9) -> probabilities should be close to each other.
    expect(Math.abs(probB - probU)).toBeLessThan(0.05)
  })

  it('is non-decreasing as the turn increases (more draws can only help)', () => {
    const manaBase = deriveManaBase([{ quantity: 17, producedMana: ['U'] }])
    const req = parseManaCost('{3}{U}{U}')
    let previous = 0
    for (let turn = 1; turn <= MAX_TURN; turn++) {
      const p = probCastableByTurn(req, manaBase, 40, turn, true)
      expect(p).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = p
    }
  })

  it('handles a colorless-only cost using just the total-land constraint', () => {
    const manaBase = deriveManaBase([{ quantity: 17, producedMana: ['U'] }])
    const req = parseManaCost('{4}')
    const withPlentyOfDraws = probCastableByTurn(req, manaBase, 40, 10, true)
    const withFewDraws = probCastableByTurn(req, manaBase, 40, 1, true)
    expect(withPlentyOfDraws).toBeGreaterThan(withFewDraws)
  })

  it('handles a two-color exact case (both colors needed)', () => {
    const manaBase = deriveManaBase([
      { quantity: 8, producedMana: ['U'] },
      { quantity: 8, producedMana: ['B'] },
      { quantity: 1, producedMana: ['U', 'B'] },
    ])
    const req = parseManaCost('{1}{U}{B}')
    const p = probCastableByTurn(req, manaBase, 40, 4, true)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThanOrEqual(1)
  })

  it('handles a manaBase describing more lands than deckSize without going negative or NaN', () => {
    // A manual override can describe a bigger intended manabase (e.g. 22
    // lands planned for an eventual 60-card deck) than the cards added to
    // the deck so far — deckSize here is smaller than manaBase.totalLands.
    const manaBase = deriveManaBase([
      { quantity: 12, producedMana: ['G'] },
      { quantity: 10, producedMana: ['B'] },
    ])
    const req = parseManaCost('{4}{B}{B}')
    const p = probCastableByTurn(req, manaBase, 15, 6, true)
    expect(Number.isFinite(p)).toBe(true)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThanOrEqual(1)
  })

  it('stays sane for a manual override whose per-color counts overlap (e.g. all-color rocks/lands, common in Commander)', () => {
    // Regression test: a manual override built from 5-color sources (like
    // Command Tower) that each count toward every color's total. If the
    // exact joint model treated these five per-color counts as disjoint
    // categories, they'd sum to far more than totalLands and produce
    // garbage (previously: wildly negative expected turns).
    const manaBase = manaBaseFromOverride(3, { W: 3, U: 3, B: 3, R: 3, G: 3 })
    expect(manaBase.exact).toBe(false)
    const req = parseManaCost('{W}')
    for (let turn = 1; turn <= MAX_TURN; turn++) {
      const p = probCastableByTurn(req, manaBase, 15, turn, true)
      expect(Number.isFinite(p)).toBe(true)
      expect(p).toBeGreaterThanOrEqual(0)
      // Allow a hair of floating-point drift from the log-space hypergeometric math.
      expect(p).toBeLessThanOrEqual(1 + 1e-9)
    }
    const { expectedTurn } = expectedTurnCastable(req, manaBase, 15, true)
    if (expectedTurn !== null) {
      expect(expectedTurn).toBeGreaterThan(0)
      expect(expectedTurn).toBeLessThanOrEqual(MAX_TURN)
    }
  })

  it('handles a three-color card via the approximation fallback without throwing', () => {
    const manaBase = deriveManaBase([
      { quantity: 6, producedMana: ['U'] },
      { quantity: 6, producedMana: ['B'] },
      { quantity: 6, producedMana: ['R'] },
    ])
    const req = parseManaCost('{U}{B}{R}')
    const p = probCastableByTurn(req, manaBase, 40, 5, true)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})

describe('expectedTurnCastable', () => {
  it('gives a low expected turn for an easy, heavily-supported one-drop', () => {
    const manaBase = deriveManaBase([{ quantity: 17, producedMana: ['U'] }])
    const req = parseManaCost('{U}')
    const { expectedTurn } = expectedTurnCastable(req, manaBase, 40, true)
    expect(expectedTurn).not.toBeNull()
    expect(expectedTurn as number).toBeLessThan(2)
  })

  it('returns null ("10+") for a card that never reaches high confidence', () => {
    const manaBase = deriveManaBase([{ quantity: 2, producedMana: ['B'] }])
    const req = parseManaCost('{6}{B}{B}{B}')
    const { expectedTurn, probByTurn } = expectedTurnCastable(req, manaBase, 40, true)
    expect(probByTurn[MAX_TURN - 1]).toBeLessThan(HIGH_CONFIDENCE_THRESHOLD)
    expect(expectedTurn).toBeNull()
  })
})

describe('computeCastabilityIndex performance', () => {
  it('computes a full 60-card deck worth of distinct pip shapes well within a UI-responsive budget', () => {
    const manaBase = deriveManaBase([
      { quantity: 8, producedMana: ['U'] },
      { quantity: 8, producedMana: ['B'] },
      { quantity: 1, producedMana: ['U', 'B'] },
    ])
    // A realistic spread of ~25 distinct cost shapes, roughly what a 60-card
    // deck's nonland cards would produce after deduplication.
    const shapes = [
      '{U}',
      '{B}',
      '{1}{U}',
      '{1}{B}',
      '{2}{U}',
      '{2}{B}',
      '{1}{U}{U}',
      '{1}{B}{B}',
      '{2}{U}{B}',
      '{3}{U}',
      '{3}{B}',
      '{U}{B}',
      '{4}{U}',
      '{4}{B}',
      '{2}{U}{U}',
      '{2}{B}{B}',
      '{5}{U}',
      '{5}{B}',
      '{1}{U/B}',
      '{2}{U/B}{U/B}',
      '{6}',
      '{3}{U}{B}',
      '{X}{U}',
      '{U/P}',
      '{2/B}',
    ].map(parseManaCost)

    const start = performance.now()
    const index = computeCastabilityIndex(shapes, manaBase, 60, true)
    const durationMs = performance.now() - start

    // {X}{U} and {U} share a pip shape (X assumed 0), so fewer distinct
    // entries than input shapes is expected — just confirm dedup happened
    // sanely and nothing was dropped outright.
    expect(index.size).toBeGreaterThan(20)
    expect(index.size).toBeLessThanOrEqual(shapes.length)
    expect(durationMs).toBeLessThan(500)
  })
})

describe('probCastableByTurn — one land pays for one pip', () => {
  it('does not let a single dual land pay both colours of {W}{U}', () => {
    // Two lands, the whole deck drawn: one W/U dual and one colourless land can make W or U,
    // never both.
    const manaBase = deriveManaBase([
      { quantity: 1, producedMana: ['W', 'U'] },
      { quantity: 1, producedMana: [] },
    ])
    expect(probCastableByTurn(parseManaCost('{W}{U}'), manaBase, 2, 1, true)).toBe(0)
  })

  it('still casts {W}{U} off two duals', () => {
    const manaBase = deriveManaBase([{ quantity: 2, producedMana: ['W', 'U'] }])
    expect(probCastableByTurn(parseManaCost('{W}{U}'), manaBase, 2, 1, true)).toBeCloseTo(1)
  })

  it('needs a source of either colour for a hybrid pip', () => {
    const mountains = deriveManaBase([{ quantity: 37, producedMana: ['R'] }])
    expect(probCastableByTurn(parseManaCost('{1}{G/W}{G/W}'), mountains, 99, 4, true)).toBe(0)

    const forests = deriveManaBase([{ quantity: 37, producedMana: ['G'] }])
    expect(probCastableByTurn(parseManaCost('{1}{G/W}{G/W}'), forests, 99, 4, true)).toBeCloseTo(
      probCastableByTurn(parseManaCost('{1}{G}{G}'), forests, 99, 4, true),
    )
  })
})
