import { describe, expect, it } from 'vitest'
import type { ScryfallCard } from '../api/scryfallTypes'
import { chooseAutoPick, mainColors, toAutoPickInfo, type AutoPickInfo } from './autoPick'

const INFO: AutoPickInfo = {
  bolt: { rarity: 'common', colors: ['R'], isBasicLand: false },
  shock: { rarity: 'common', colors: ['R'], isBasicLand: false },
  counterspell: { rarity: 'uncommon', colors: ['U'], isBasicLand: false },
  giant: { rarity: 'uncommon', colors: ['G'], isBasicLand: false },
  dragon: { rarity: 'mythic', colors: ['R'], isBasicLand: false },
  angel: { rarity: 'rare', colors: ['W'], isBasicLand: false },
  golem: { rarity: 'uncommon', colors: [], isBasicLand: false },
  mountain: { rarity: 'common', colors: [], isBasicLand: true },
}

describe('chooseAutoPick', () => {
  it('takes the highest rarity', () => {
    expect(chooseAutoPick(['bolt', 'angel', 'dragon', 'giant'], [], INFO)).toBe('dragon')
  })

  it('prefers the colors the player has been drafting at the same rarity', () => {
    const pool = ['bolt', 'shock']
    expect(chooseAutoPick(['counterspell', 'giant', 'golem'], pool, INFO)).toBe('golem')
    expect(chooseAutoPick(['counterspell', 'giant'], ['giant'], INFO)).toBe('giant')
  })

  it('still takes a better rarity off-color', () => {
    expect(chooseAutoPick(['bolt', 'angel'], ['bolt', 'shock'], INFO)).toBe('angel')
  })

  it("never takes a basic land while there's anything else", () => {
    expect(chooseAutoPick(['mountain', 'unknown-card'], [], INFO)).toBe('unknown-card')
    expect(chooseAutoPick(['mountain'], [], INFO)).toBe('mountain')
  })

  it('reads foil keys and falls back to the first card with no info at all', () => {
    expect(chooseAutoPick(['bolt', 'dragon~foil'], [], INFO)).toBe('dragon~foil')
    expect(chooseAutoPick(['a', 'b', 'c'], [], {})).toBe('a')
    expect(chooseAutoPick([], [], INFO)).toBeNull()
  })
})

describe('mainColors', () => {
  it('returns the two most-drafted colors', () => {
    expect(mainColors(['bolt', 'shock', 'dragon', 'giant', 'giant', 'counterspell'], { ...INFO })).toEqual(['R', 'G'])
  })
})

describe('toAutoPickInfo', () => {
  it('uses the front face colors for a double-faced card and flags basics', () => {
    const cards = [
      { id: 'dfc', rarity: 'rare', type_line: 'Creature // Creature', color_identity: ['G', 'B'], card_faces: [{ colors: ['G'] }, { colors: ['B'] }] },
      { id: 'forest', rarity: 'common', type_line: 'Basic Land — Forest', colors: [], color_identity: ['G'] },
    ] as unknown as ScryfallCard[]
    const info = toAutoPickInfo(cards)
    expect(info.dfc).toEqual({ rarity: 'rare', colors: ['G'], isBasicLand: false })
    expect(info.forest.isBasicLand).toBe(true)
  })
})
