import { describe, expect, it } from 'vitest'
import { parseManaCost, pipShapeKey, requiredColors, totalManaValue } from './manaCost'

describe('parseManaCost', () => {
  it('parses a simple generic + colored cost', () => {
    const req = parseManaCost('{2}{U}{U}')
    expect(req.generic).toBe(2)
    expect(req.colored).toEqual({ U: 2 })
  })

  it('parses the classic example: mostly generic, one colored pip', () => {
    // The user's motivating case: {5}{B} should need only 1 black source,
    // not be treated as if all 6 mana were black.
    const req = parseManaCost('{5}{B}')
    expect(req.generic).toBe(5)
    expect(req.colored).toEqual({ B: 1 })
  })

  it('treats X, Y, Z as 0', () => {
    const req = parseManaCost('{X}{X}{R}')
    expect(req.generic).toBe(0)
    expect(req.colored).toEqual({ R: 1 })
  })

  it('folds colorless {C} and snow {S} into generic', () => {
    const req = parseManaCost('{C}{S}{1}')
    expect(req.generic).toBe(3)
  })

  it('parses hybrid mana as a group satisfiable by either color', () => {
    const req = parseManaCost('{1}{W/B}{W/B}')
    expect(req.generic).toBe(1)
    expect(req.hybrid).toEqual([{ options: ['B', 'W'], count: 2 }])
  })

  it('parses distinct hybrid pairs as separate groups', () => {
    const req = parseManaCost('{U/B}{U/R}')
    expect(req.hybrid).toHaveLength(2)
    expect(req.hybrid).toContainEqual({ options: ['B', 'U'], count: 1 })
    expect(req.hybrid).toContainEqual({ options: ['R', 'U'], count: 1 })
  })

  it('parses Phyrexian mana separately from colored pips', () => {
    const req = parseManaCost('{U/P}{U/P}')
    expect(req.colored).toEqual({})
    expect(req.phyrexian).toEqual([{ color: 'U', count: 2 }])
  })

  it('parses twobrid mana as its own group', () => {
    const req = parseManaCost('{2/U}{2/U}{2/R}')
    expect(req.twobrid).toContainEqual({ color: 'U', count: 2 })
    expect(req.twobrid).toContainEqual({ color: 'R', count: 1 })
  })

  it('returns an all-zero requirement for an empty cost (e.g. a land)', () => {
    const req = parseManaCost('')
    expect(req).toEqual({ generic: 0, colored: {}, hybrid: [], phyrexian: [], twobrid: [] })
  })
})

describe('totalManaValue', () => {
  it('sums generic, colored, hybrid, and twobrid pips', () => {
    const req = parseManaCost('{2}{U}{U}{W/B}{2/R}')
    expect(totalManaValue(req)).toBe(2 + 2 + 1 + 1)
  })

  it('excludes Phyrexian pips (assumed paid via life)', () => {
    const req = parseManaCost('{1}{U/P}')
    expect(totalManaValue(req)).toBe(1)
  })

  it('excludes X (assumed 0)', () => {
    const req = parseManaCost('{X}{R}')
    expect(totalManaValue(req)).toBe(1)
  })
})

describe('requiredColors', () => {
  it('includes colored, hybrid, and twobrid colors but not Phyrexian', () => {
    const req = parseManaCost('{B}{W/U}{2/R}{G/P}')
    expect(requiredColors(req).sort()).toEqual(['B', 'R', 'U', 'W'])
  })

  it('returns an empty array for a colorless cost', () => {
    expect(requiredColors(parseManaCost('{3}'))).toEqual([])
  })
})

describe('pipShapeKey', () => {
  it('produces identical keys for identical cost shapes', () => {
    const a = pipShapeKey(parseManaCost('{1}{U}'))
    const b = pipShapeKey(parseManaCost('{1}{U}'))
    expect(a).toBe(b)
  })

  it('produces different keys for different cost shapes', () => {
    const a = pipShapeKey(parseManaCost('{1}{U}'))
    const b = pipShapeKey(parseManaCost('{2}{U}'))
    expect(a).not.toBe(b)
  })

  it('is stable regardless of symbol order in the source string', () => {
    const a = pipShapeKey(parseManaCost('{U}{B}{1}'))
    const b = pipShapeKey(parseManaCost('{1}{B}{U}'))
    expect(a).toBe(b)
  })
})
