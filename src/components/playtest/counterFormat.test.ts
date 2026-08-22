import { describe, expect, it } from 'vitest'
import { COUNTER_COLORS, counterPileLabel, counterPileName, formatPtCounters, formatSigned, KEYWORD_COUNTERS, swatchFor } from './counterFormat'

describe('formatSigned', () => {
  it('prefixes positive numbers with +', () => {
    expect(formatSigned(3)).toBe('+3')
  })
  it('leaves the native minus sign on negatives', () => {
    expect(formatSigned(-2)).toBe('-2')
  })
  it('renders zero with no sign', () => {
    expect(formatSigned(0)).toBe('0')
  })
})

describe('formatPtCounters', () => {
  it('formats independently-signed power and toughness', () => {
    expect(formatPtCounters({ power: 2, toughness: -1 })).toBe('+2/-1')
    expect(formatPtCounters({ power: -3, toughness: 3 })).toBe('-3/+3')
    expect(formatPtCounters({ power: 1, toughness: 1 })).toBe('+1/+1')
    expect(formatPtCounters({ power: -1, toughness: -1 })).toBe('-1/-1')
  })
})

describe('swatchFor', () => {
  it('returns a distinct swatch for every palette color', () => {
    const swatches = new Set(COUNTER_COLORS.map((c) => swatchFor(c.id)))
    expect(swatches.size).toBe(COUNTER_COLORS.length)
  })

  it('also resolves keyword-counter kinds, distinctly from each other', () => {
    const swatches = new Set(KEYWORD_COUNTERS.map((k) => swatchFor(k.id)))
    expect(swatches.size).toBe(KEYWORD_COUNTERS.length)
  })
})

describe('counterPileLabel', () => {
  it('shows a keyword counter as its abbreviation at the default count of 1', () => {
    expect(counterPileLabel({ color: 'flying', value: 1 })).toBe('FLY')
  })

  it('appends a ×N suffix once a keyword counter pile strays from 1', () => {
    expect(counterPileLabel({ color: 'deathtouch', value: 3 })).toBe('DT×3')
    expect(counterPileLabel({ color: 'deathtouch', value: 0 })).toBe('DT×0')
  })

  it('falls back to a signed number for freeform color piles', () => {
    expect(counterPileLabel({ color: 'green', value: 4 })).toBe('+4')
  })
})

describe('counterPileName', () => {
  it('returns the full keyword name', () => {
    expect(counterPileName('doublestrike')).toBe('Double Strike')
  })

  it('falls back to a generic "<Color> counter" for freeform piles', () => {
    expect(counterPileName('gold')).toBe('Gold counter')
  })
})
