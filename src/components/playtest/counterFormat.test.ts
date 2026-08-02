import { describe, expect, it } from 'vitest'
import { COUNTER_COLORS, formatPtCounters, formatSigned, swatchFor } from './counterFormat'

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
})
