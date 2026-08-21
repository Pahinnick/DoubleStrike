import { describe, expect, it } from 'vitest'
import type { ScryfallCard } from '../api/scryfallTypes'
import { isFlippableSnapshot, toSnapshot, type CardSnapshot } from './cardCache'

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

describe('toSnapshot', () => {
  it('uses the top-level type_line when present', () => {
    const card: ScryfallCard = {
      id: 'test-id',
      oracle_id: 'test-oracle-id',
      name: 'Test Card',
      layout: 'normal',
      cmc: 1,
      type_line: 'Creature — Human',
      color_identity: [],
      legalities: {},
    }
    expect(toSnapshot(card).type_line).toBe('Creature — Human')
  })

  it('falls back to the front face cmc/type_line/colors for reversible cards, which have no top-level ones', () => {
    // Scryfall's "reversible_card" layout (e.g. Steam Vents from the ECL reversible frames, or SLD's
    // Dragonlord Atarka) omits cmc, type_line, mana_cost, and colors from the top-level card object
    // entirely — each face is really its own full card, so those only exist per-face — meaning a real
    // API response can violate ScryfallCard's `cmc: number` / `type_line: string` typing.
    const card = {
      id: 'test-id',
      oracle_id: 'test-oracle-id',
      name: 'Dragonlord Atarka // Dragonlord Atarka',
      layout: 'reversible_card',
      color_identity: ['G', 'R'],
      legalities: {},
      card_faces: [
        { name: 'Dragonlord Atarka', mana_cost: '{5}{R}{G}', cmc: 7, type_line: 'Legendary Creature — Elder Dragon', colors: ['G', 'R'] },
        { name: 'Dragonlord Atarka', mana_cost: '{5}{R}{G}', cmc: 7, type_line: 'Legendary Creature — Elder Dragon', colors: ['G', 'R'] },
      ],
    } as unknown as ScryfallCard
    const snapshot = toSnapshot(card)
    expect(snapshot.cmc).toBe(7)
    expect(snapshot.type_line).toBe('Legendary Creature — Elder Dragon')
    expect(snapshot.colors).toEqual(['G', 'R'])
  })

  it('defaults cmc to 0 and type_line to empty when neither the card nor any face has one', () => {
    const card = {
      id: 'test-id',
      oracle_id: 'test-oracle-id',
      name: 'Edge Case',
      layout: 'normal',
      color_identity: [],
      legalities: {},
    } as unknown as ScryfallCard
    const snapshot = toSnapshot(card)
    expect(snapshot.cmc).toBe(0)
    expect(snapshot.type_line).toBe('')
  })
})
