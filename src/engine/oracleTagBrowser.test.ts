import { describe, expect, it } from 'vitest'
import { buildTagIndex, type RawOracleTag } from '../storage/tagIndex'
import { buildOracleTagQuery, mostPopularTagForCard, tagsByPopularity } from './oracleTagBrowser'

function rawTag(slug: string, label: string, oracleIds: string[]): RawOracleTag {
  return { object: 'tag', slug, label, type: 'oracle', taggings: oracleIds.map((oracle_id) => ({ oracle_id, weight: 'median' })) }
}

describe('tagsByPopularity', () => {
  it('sorts tags by number of tagged cards, descending', () => {
    const index = buildTagIndex([
      rawTag('ramp', 'Ramp', ['a', 'b', 'c']),
      rawTag('removal', 'Removal', ['a', 'b', 'c', 'd', 'e']),
      rawTag('tutor', 'Tutor', ['a']),
    ])
    expect(tagsByPopularity(index).map((t) => t.slug)).toEqual(['removal', 'ramp', 'tutor'])
  })

  it('breaks ties alphabetically by label for a deterministic order', () => {
    const index = buildTagIndex([rawTag('zeta', 'Zeta', ['a']), rawTag('alpha', 'Alpha', ['a'])])
    expect(tagsByPopularity(index).map((t) => t.slug)).toEqual(['alpha', 'zeta'])
  })

  it('reports the count alongside each tag', () => {
    const index = buildTagIndex([rawTag('ramp', 'Ramp', ['a', 'b'])])
    expect(tagsByPopularity(index)).toEqual([{ slug: 'ramp', label: 'Ramp', count: 2 }])
  })
})

describe('mostPopularTagForCard', () => {
  it('is undefined for an untagged card', () => {
    const index = buildTagIndex([rawTag('ramp', 'Ramp', ['a'])])
    expect(mostPopularTagForCard(index, 'untagged-card')).toBeUndefined()
  })

  it('picks the tag with the most tagged cards overall, not the first tag applied', () => {
    // "removal" (3 cards) is more broadly used than "spot-removal" (1 card), even though card
    // "x" only carries the narrower tag directly alongside the broader one.
    const index = buildTagIndex([
      rawTag('spot-removal', 'Spot Removal', ['x']),
      rawTag('removal', 'Removal', ['x', 'y', 'z']),
    ])
    expect(mostPopularTagForCard(index, 'x')?.slug).toBe('removal')
  })

  it('breaks a popularity tie alphabetically by slug', () => {
    const index = buildTagIndex([rawTag('zeta', 'Zeta', ['x']), rawTag('alpha', 'Alpha', ['x'])])
    expect(mostPopularTagForCard(index, 'x')?.slug).toBe('alpha')
  })
})

describe('buildOracleTagQuery', () => {
  it('falls back to an unfiltered "every real card" query when nothing is selected', () => {
    expect(buildOracleTagQuery([])).toBe('game:paper')
  })

  it('builds a single otag clause for one selected tag', () => {
    expect(buildOracleTagQuery(['ramp'])).toBe('(otag:ramp)')
  })

  it('ORs multiple selected tags together', () => {
    expect(buildOracleTagQuery(['ramp', 'removal'])).toBe('(otag:ramp or otag:removal)')
  })
})
