import { describe, expect, it } from 'vitest'
import { isFlippableSnapshot, type CardSnapshot } from './cardCache'

function makeSnapshot(overrides: Partial<CardSnapshot>): CardSnapshot {
  return {
    id: 'test-id',
    oracle_id: 'test-oracle-id',
    name: 'Test Card',
    mana_cost: '',
    cmc: 0,
    type_line: 'Creature',
    colors: [],
    color_identity: [],
    layout: 'normal',
    legalities: {},
    cachedAt: new Date().toISOString(),
    ...overrides,
  }
}

const twoFaces = [
  { name: 'Front', mana_cost: '{1}{R}' },
  { name: 'Back', mana_cost: '' },
]

describe('isFlippableSnapshot', () => {
  it('is true for transform/MDFC/flip/token/reversible layouts with two faces', () => {
    for (const layout of ['transform', 'modal_dfc', 'flip', 'double_faced_token', 'reversible_card']) {
      expect(isFlippableSnapshot(makeSnapshot({ layout, card_faces: twoFaces }))).toBe(true)
    }
  })

  it('is false for split/adventure cards even though they have card_faces', () => {
    expect(isFlippableSnapshot(makeSnapshot({ layout: 'split', card_faces: twoFaces }))).toBe(false)
    expect(isFlippableSnapshot(makeSnapshot({ layout: 'adventure', card_faces: twoFaces }))).toBe(false)
  })

  it('is false for a normal single-faced card', () => {
    expect(isFlippableSnapshot(makeSnapshot({ layout: 'normal', card_faces: undefined }))).toBe(false)
  })

  it('is false for a transform layout with only one face somehow present', () => {
    expect(isFlippableSnapshot(makeSnapshot({ layout: 'transform', card_faces: [twoFaces[0]] }))).toBe(false)
  })
})
