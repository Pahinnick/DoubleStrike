import { describe, expect, it } from 'vitest'
import { sortManaStack } from './colors'

describe('sortManaStack', () => {
  it('draws colorless first (topmost segment) so it renders at the top of the bar', () => {
    // Insertion order deliberately scrambled — this is real-world shaped, since byColor's own
    // key order just reflects whichever color the deck-scan happened to hit first.
    const result = sortManaStack({ C: 2, G: 1, W: 3 })
    expect(result.map(([color]) => color)).toEqual(['C', 'G', 'W'])
  })

  it('orders the WUBRG colors present so reading the bar bottom-to-top matches W,U,B,R,G,C', () => {
    const result = sortManaStack({ G: 1, W: 1, B: 1, U: 1, R: 1, C: 1 })
    // Draw order is top-to-bottom, i.e. the reverse of the bottom-to-top reading order.
    expect(result.map(([color]) => color)).toEqual(['C', 'G', 'R', 'B', 'U', 'W'])
  })

  it('skips colors absent from the bucket without leaving gaps', () => {
    const result = sortManaStack({ R: 4, C: 1 })
    expect(result.map(([color]) => color)).toEqual(['C', 'R'])
  })

  it('preserves each color\'s count', () => {
    const result = sortManaStack({ W: 3, C: 5 })
    expect(result).toEqual([
      ['C', 5],
      ['W', 3],
    ])
  })
})
