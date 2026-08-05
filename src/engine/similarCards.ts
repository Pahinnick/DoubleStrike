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

/**
 * Ranks cards to recommend for a category, based on the tags already present on the cards it
 * contains — e.g. right-clicking a "Ramp" category full of mana rocks and land-ramp spells
 * surfaces more cards tagged the same way. A candidate's score is the summed frequency (across
 * the category's own cards) of every tag it shares, so a candidate matching the category's most
 * common tag ranks above one matching a tag only one card in the category happens to have.
 * Cards already in `categoryOracleIds` are excluded from the results.
 */
export function findCardsForCategory(index: TagIndexData, categoryOracleIds: string[], limit = 100): SimilarCardMatch[] {
  const source = new Set(categoryOracleIds)

  const tagFrequency = new Map<string, number>()
  for (const oracleId of source) {
    for (const tag of getTagsForCard(index, oracleId)) {
      tagFrequency.set(tag.slug, (tagFrequency.get(tag.slug) ?? 0) + 1)
    }
  }
  if (tagFrequency.size === 0) return []

  const scores = new Map<string, { score: number; tags: string[] }>()
  for (const [slug, frequency] of tagFrequency) {
    for (const candidateId of index.tagCards[slug] ?? []) {
      if (source.has(candidateId)) continue
      const entry = scores.get(candidateId)
      if (entry) {
        entry.score += frequency
        entry.tags.push(slug)
      } else {
        scores.set(candidateId, { score: frequency, tags: [slug] })
      }
    }
  }

  const results: SimilarCardMatch[] = [...scores.entries()].map(([oracleId, value]) => ({
    oracleId,
    matchCount: value.score,
    matchedTags: value.tags,
  }))

  results.sort((a, b) => b.matchCount - a.matchCount)
  return results.slice(0, limit)
}
