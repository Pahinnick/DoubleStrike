import { describe, expect, it } from 'vitest'
import { findOrphanedProfileIds } from './indexedDbAdapter'

describe('findOrphanedProfileIds', () => {
  it('finds ids with data that are missing from the known profile list', () => {
    const found = findOrphanedProfileIds(['a', 'b', 'c'], new Set(['a']), new Set())
    expect(found.sort()).toEqual(['b', 'c'])
  })

  it('never recovers a deliberately-deleted profile even though its data still exists', () => {
    const found = findOrphanedProfileIds(['a', 'b'], new Set(), new Set(['b']))
    expect(found).toEqual(['a'])
  })

  it('is empty when every candidate is already known or deliberately deleted', () => {
    expect(findOrphanedProfileIds(['a', 'b'], new Set(['a']), new Set(['b']))).toEqual([])
  })

  it('dedupes repeated candidate ids', () => {
    expect(findOrphanedProfileIds(['a', 'a', 'a'], new Set(), new Set())).toEqual(['a'])
  })

  it('is empty for no candidates', () => {
    expect(findOrphanedProfileIds([], new Set(), new Set())).toEqual([])
  })
})
