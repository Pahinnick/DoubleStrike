import { describe, expect, it } from 'vitest'
import { buildTagIndex, type RawOracleTag } from '../storage/tagIndex'
import { findSimilarCards, getTagsForCard } from './similarCards'

function rawTag(slug: string, oracleIds: string[]): RawOracleTag {
  return { object: 'tag', slug, label: slug, type: 'oracle', taggings: oracleIds.map((oracle_id) => ({ oracle_id, weight: 'median' })) }
}

describe('getTagsForCard', () => {
  it('returns the tags on a tagged card', () => {
    const index = buildTagIndex([rawTag('removal', ['a']), rawTag('instant-speed', ['a'])])
    expect(getTagsForCard(index, 'a').map((t) => t.slug).sort()).toEqual(['instant-speed', 'removal'])
  })

  it('returns an empty array for an untagged card', () => {
    const index = buildTagIndex([rawTag('removal', ['a'])])
    expect(getTagsForCard(index, 'untagged')).toEqual([])
  })
})

describe('findSimilarCards', () => {
  it('returns nothing for a card with no tags', () => {
    const index = buildTagIndex([rawTag('removal', ['a'])])
    expect(findSimilarCards(index, 'untagged')).toEqual([])
  })

  it('ranks candidates by number of shared tags, descending', () => {
    // 'a' has tags: removal, instant-speed, exile.
    // 'b' shares all 3 -> should rank first.
    // 'c' shares 2 -> second.
    // 'd' shares 1 -> third.
    const index = buildTagIndex([
      rawTag('removal', ['a', 'b', 'c', 'd']),
      rawTag('instant-speed', ['a', 'b', 'c']),
      rawTag('exile', ['a', 'b']),
    ])
    const results = findSimilarCards(index, 'a')
    expect(results.map((r) => r.oracleId)).toEqual(['b', 'c', 'd'])
    expect(results[0].matchCount).toBe(3)
    expect(results[1].matchCount).toBe(2)
    expect(results[2].matchCount).toBe(1)
  })

  it('never includes the queried card itself', () => {
    const index = buildTagIndex([rawTag('removal', ['a', 'b'])])
    const results = findSimilarCards(index, 'a')
    expect(results.some((r) => r.oracleId === 'a')).toBe(false)
  })

  it('respects the limit parameter', () => {
    const index = buildTagIndex([rawTag('removal', ['a', 'b', 'c', 'd', 'e'])])
    const results = findSimilarCards(index, 'a', 2)
    expect(results).toHaveLength(2)
  })

  it('records which tags were matched for each candidate', () => {
    const index = buildTagIndex([rawTag('removal', ['a', 'b']), rawTag('ramp', ['a', 'b'])])
    const results = findSimilarCards(index, 'a')
    expect(results[0].matchedTags.sort()).toEqual(['ramp', 'removal'])
  })
})
