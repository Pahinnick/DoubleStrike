import type { TagIndexData, TagRef } from '../storage/tagIndex'

export type SimilarCardMatch = { oracleId: string; matchCount: number; matchedTags: string[] }

/** The tags Scryfall's community taggers have applied to this card's Oracle text. */
export function getTagsForCard(index: TagIndexData, oracleId: string): TagRef[] {
  return index.cardTags[oracleId] ?? []
}

/**
 * Ranks every other card that shares at least one tag with `oracleId`, by
 * how many tags they share (descending). Cards with zero shared tags never
 * appear.
 */
export function findSimilarCards(index: TagIndexData, oracleId: string, limit = 100): SimilarCardMatch[] {
  const tags = getTagsForCard(index, oracleId)
  if (tags.length === 0) return []

  const counts = new Map<string, { count: number; tags: string[] }>()
  for (const tag of tags) {
    const candidateIds = index.tagCards[tag.slug] ?? []
    for (const candidateId of candidateIds) {
      if (candidateId === oracleId) continue
      const entry = counts.get(candidateId)
      if (entry) {
        entry.count += 1
        entry.tags.push(tag.slug)
      } else {
        counts.set(candidateId, { count: 1, tags: [tag.slug] })
      }
    }
  }

  const results: SimilarCardMatch[] = [...counts.entries()].map(([candidateOracleId, value]) => ({
    oracleId: candidateOracleId,
    matchCount: value.count,
    matchedTags: value.tags,
  }))

  results.sort((a, b) => b.matchCount - a.matchCount)
  return results.slice(0, limit)
}
