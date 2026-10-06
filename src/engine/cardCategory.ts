import type { TagIndexData } from '../storage/tagIndex'
import { FUNCTION_CATEGORY_PRIORITY, TAG_SLUG_TO_CATEGORY } from '../data/tagCategories'
import { isLandCard, resolveTypeLine, type TypedCard } from './cardTypes'
import { getPrimaryTypeGroup } from './deckGrouping'

// oracle_id is optional for the same reason type_line is (see resolveTypeLine): a reversible-
// layout printing has neither at the top level.
export type CategorizableCard = TypedCard & { oracle_id?: string }

/**
 * Picks a default category for a newly-added card: Lands by type (checked first, so a utility
 * land with e.g. a ramp-like ability still lands in Lands, not Ramp); otherwise the highest-
 * priority Scryfall function tag the card carries (see FUNCTION_CATEGORY_PRIORITY); otherwise,
 * when no function tag matched (or the tag index isn't loaded yet), falls back to the card's
 * primary type the same way the "group by type" view already does.
 */
export function getAutoCategory(card: CategorizableCard, tagIndex: TagIndexData | undefined): string {
  if (isLandCard(card)) return 'Lands'

  if (tagIndex && card.oracle_id) {
    const tags = tagIndex.cardTags[card.oracle_id] ?? []
    const matchedCategories = new Set(tags.map((t) => TAG_SLUG_TO_CATEGORY[t.slug]).filter((c): c is string => c !== undefined))
    for (const category of FUNCTION_CATEGORY_PRIORITY) {
      if (matchedCategories.has(category)) return category
    }
  }

  return getPrimaryTypeGroup(resolveTypeLine(card))
}
