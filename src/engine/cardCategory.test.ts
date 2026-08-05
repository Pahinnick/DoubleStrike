import { describe, expect, it } from 'vitest'
import type { TagIndexData } from '../storage/tagIndex'
import { getAutoCategory } from './cardCategory'

function tagIndex(cardTags: TagIndexData['cardTags']): TagIndexData {
  return { builtAt: new Date().toISOString(), cardTags, tagCards: {}, tagLabels: {} }
}

describe('getAutoCategory', () => {
  it('buckets any land by type, regardless of tags', () => {
    const index = tagIndex({ 'oracle-1': [{ slug: 'ramp', weight: 'median' }] })
    expect(getAutoCategory({ type_line: 'Land', oracle_id: 'oracle-1' }, index)).toBe('Lands')
  })

  it('maps a tagged nonland card to its function category', () => {
    const index = tagIndex({ sol: [{ slug: 'mana-rock', weight: 'median' }] })
    expect(getAutoCategory({ type_line: 'Artifact', oracle_id: 'sol' }, index)).toBe('Ramp')
  })

  it('picks the higher-priority category when a card carries tags from more than one', () => {
    const index = tagIndex({
      card: [
        { slug: 'removal', weight: 'median' },
        { slug: 'burn-creature', weight: 'median' },
      ],
    })
    expect(getAutoCategory({ type_line: 'Instant', oracle_id: 'card' }, index)).toBe('Burn')
  })

  it('falls back to the primary type when the card has no matched tags', () => {
    const index = tagIndex({ card: [{ slug: 'flavor-text-joke', weight: 'median' }] })
    expect(getAutoCategory({ type_line: 'Creature — Bear', oracle_id: 'card' }, index)).toBe('Creature')
  })

  it('falls back to the primary type when the tag index is not loaded yet', () => {
    expect(getAutoCategory({ type_line: 'Instant', oracle_id: 'card' }, undefined)).toBe('Instant')
  })

  it('falls back to Other for an untagged, untyped card', () => {
    expect(getAutoCategory({ type_line: 'Scheme', oracle_id: 'card' }, undefined)).toBe('Other')
  })
})
