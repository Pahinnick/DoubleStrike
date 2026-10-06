import { describe, expect, it } from 'vitest'
import { isLandCard, resolveTypeLine } from './cardTypes'

describe('isLandCard', () => {
  it('is true for a plain land', () => {
    expect(isLandCard({ type_line: 'Basic Snow Land — Island', layout: 'normal' })).toBe(true)
  })

  it('is false for a transforming card whose back face is a land', () => {
    expect(isLandCard({ type_line: 'Legendary Enchantment // Legendary Land', layout: 'transform' })).toBe(false)
  })

  it('still counts a modal double-faced spell//land', () => {
    expect(isLandCard({ type_line: 'Sorcery // Land', layout: 'modal_dfc' })).toBe(true)
  })

  it('keeps the any-face behaviour for a snapshot cached before layout was recorded', () => {
    expect(isLandCard({ type_line: 'Sorcery // Land' })).toBe(true)
  })

  it('reads the front face of a card with no top-level type line', () => {
    const reversible = { layout: 'reversible_card', card_faces: [{ type_line: 'Land — Island Mountain' }, { type_line: 'Land — Island Mountain' }] }
    expect(resolveTypeLine(reversible)).toBe('Land — Island Mountain')
    expect(isLandCard(reversible)).toBe(true)
  })
})
