import { describe, expect, it } from 'vitest'
import { buildTagIndex, isTagIndexStale, type RawOracleTag } from './tagIndex'

function rawTag(slug: string, label: string, oracleIds: string[], type = 'oracle'): RawOracleTag {
  return {
    object: 'tag',
    slug,
    label,
    type,
    taggings: oracleIds.map((oracle_id) => ({ oracle_id, weight: 'median' })),
  }
}

describe('buildTagIndex', () => {
  it('builds a reverse index (card -> tags) from the raw bulk objects', () => {
    const index = buildTagIndex([rawTag('removal', 'Removal', ['card-a', 'card-b']), rawTag('ramp', 'Ramp', ['card-a'])])
    expect(index.cardTags['card-a']).toEqual([
      { slug: 'removal', weight: 'median' },
      { slug: 'ramp', weight: 'median' },
    ])
    expect(index.cardTags['card-b']).toEqual([{ slug: 'removal', weight: 'median' }])
  })

  it('builds a forward index (tag -> cards) from the raw bulk objects', () => {
    const index = buildTagIndex([rawTag('removal', 'Removal', ['card-a', 'card-b'])])
    expect(index.tagCards.removal).toEqual(['card-a', 'card-b'])
  })

  it('captures human-readable labels per tag slug', () => {
    const index = buildTagIndex([rawTag('board-wipe', 'Board Wipe', ['card-a'])])
    expect(index.tagLabels['board-wipe']).toBe('Board Wipe')
  })

  it('ignores non-oracle tag entries (e.g. illustration tags)', () => {
    const index = buildTagIndex([rawTag('squirrel', 'Squirrel', ['card-a'], 'illustration')])
    expect(index.cardTags['card-a']).toBeUndefined()
    expect(index.tagCards.squirrel).toBeUndefined()
  })

  it('handles a card appearing in zero tags gracefully (absent, not an empty array)', () => {
    const index = buildTagIndex([rawTag('removal', 'Removal', ['card-a'])])
    expect(index.cardTags['card-untagged']).toBeUndefined()
  })
})

describe('isTagIndexStale', () => {
  it('is not stale immediately after being built', () => {
    const index = buildTagIndex([])
    expect(isTagIndexStale(index)).toBe(false)
  })

  it('is stale once builtAt is older than 30 days', () => {
    const oldIndex = { ...buildTagIndex([]), builtAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() }
    expect(isTagIndexStale(oldIndex)).toBe(true)
  })
})
