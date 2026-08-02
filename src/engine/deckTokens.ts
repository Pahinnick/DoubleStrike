import type { RelatedCard } from '../api/scryfallTypes'
import type { CardSnapshot } from '../storage/cardCache'

/** A token the deck can make, plus how many distinct cards make it (shown as context in the picker). */
export type DeckToken = {
  id: string
  name: string
  type_line: string
  /** Number of distinct deck cards that list this token in their `related_tokens`. */
  sourceCount: number
}

/**
 * Collects the distinct tokens a deck can make from its cards' cached `related_tokens`, deduped by
 * Scryfall id (many cards make the same Soldier/Treasure). Sorted by descending source count, then
 * name, so the tokens the deck leans on most surface first. Snapshots cached before `related_tokens`
 * existed simply contribute nothing until they're refreshed.
 */
export function collectDeckTokens(snapshots: Iterable<CardSnapshot>): DeckToken[] {
  const byId = new Map<string, DeckToken>()
  for (const snapshot of snapshots) {
    const parts: RelatedCard[] = snapshot.related_tokens ?? []
    // A card could theoretically list the same token twice; only count it once per card.
    const seenThisCard = new Set<string>()
    for (const part of parts) {
      if (seenThisCard.has(part.id)) continue
      seenThisCard.add(part.id)
      const existing = byId.get(part.id)
      if (existing) {
        existing.sourceCount += 1
      } else {
        byId.set(part.id, { id: part.id, name: part.name, type_line: part.type_line, sourceCount: 1 })
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.sourceCount - a.sourceCount || a.name.localeCompare(b.name))
}
