import type { TagIndexData, TagRef } from '../storage/tagIndex'
import { getTagsForCard } from './similarCards'

export type TagPopularity = { slug: string; label: string; count: number }

/** Every oracle tag in the index, most-tagged-card-count first — what the OTags browser's left
 *  column lists so players see the broadly useful tags (removal, ramp, ...) before obscure ones. */
export function tagsByPopularity(index: TagIndexData): TagPopularity[] {
  return Object.entries(index.tagCards)
    .map(([slug, oracleIds]) => ({ slug, label: index.tagLabels[slug] ?? slug, count: oracleIds.length }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * Among a card's own oracle tags, the one tagged onto the most cards overall — used to caption a
 * search result with the single tag that best explains "what this card does" without listing its
 * whole (sometimes dozens-long) tag set. Ties fall back to alphabetical slug order for a
 * deterministic result.
 */
export function mostPopularTagForCard(index: TagIndexData, oracleId: string): TagRef | undefined {
  const tags = getTagsForCard(index, oracleId)
  if (tags.length === 0) return undefined
  return tags.reduce((best, tag) => {
    const bestCount = index.tagCards[best.slug]?.length ?? 0
    const count = index.tagCards[tag.slug]?.length ?? 0
    if (count > bestCount) return tag
    if (count === bestCount && tag.slug < best.slug) return tag
    return best
  })
}

/**
 * Scryfall search query for the OTags browser's right column. With no tags toggled on, "game:paper"
 * stands in for "every real card" (Scryfall has no bare match-everything term) so the default view
 * is a genuine, unfiltered EDHREC-rank browse rather than an empty state. With tags toggled on, an
 * `otag:` OR-clause per tag — verified live against api.scryfall.com, oracle tags are searchable
 * through the public API with no auth, so this reuses the existing search/pagination
 * infrastructure (useCardSearch + searchCards) instead of resolving oracle_ids locally and
 * batch-fetching them, which would need hundreds of /cards/collection round trips for a popular tag.
 */
export function buildOracleTagQuery(selectedSlugs: string[]): string {
  if (selectedSlugs.length === 0) return 'game:paper'
  return `(${selectedSlugs.map((slug) => `otag:${slug}`).join(' or ')})`
}
