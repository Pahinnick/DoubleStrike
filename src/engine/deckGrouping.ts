import type { CardSnapshot } from '../storage/cardCache'
import type { DeckCard } from '../state/types'

const PRIMARY_TYPES = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'] as const

export function getPrimaryTypeGroup(typeLine: string): string {
  for (const type of PRIMARY_TYPES) {
    if (typeLine.includes(type)) return type
  }
  return 'Other'
}

export type DeckCardEntry = { deckCard: DeckCard; snapshot: CardSnapshot | undefined }

export type CardGroup = { label: string; entries: DeckCardEntry[] }

export const COMMANDERS_LABEL = 'Commanders'
export const UNCATEGORIZED_LABEL = 'Uncategorized'
/** The pinned-last section imported token *reference cards* (the generated tokens themselves,
 *  e.g. "Soldier" or "Astartes Warrior") land in — routed there by the `isToken` flag, not by
 *  category name. Deliberately not called "Tokens": that's a common Archidekt category name for
 *  real synergy cards (Anointed Procession, Kaya, Geist Hunter) that make/care about tokens, which
 *  must stay grouped with the deck's other real categories, not lumped in with the tokens
 *  themselves. */
export const TOKEN_CARDS_LABEL = 'Token Cards'

function bucket(entries: DeckCardEntry[], labelFor: (entry: DeckCardEntry) => string, order: string[]): CardGroup[] {
  const buckets = new Map<string, DeckCardEntry[]>()
  for (const entry of entries) {
    const label = labelFor(entry)
    const existing = buckets.get(label)
    if (existing) existing.push(entry)
    else buckets.set(label, [entry])
  }
  return order.filter((label) => buckets.has(label)).map((label) => ({ label, entries: buckets.get(label)! }))
}

/** Pulls commanders into their own group so they always render as a distinct section, separate
 *  from however the rest of the deck is grouped. */
function splitCommanders(entries: DeckCardEntry[]): { commanderGroups: CardGroup[]; rest: DeckCardEntry[] } {
  const commanders = entries.filter((entry) => entry.deckCard.isCommander)
  const rest = entries.filter((entry) => !entry.deckCard.isCommander)
  return { commanderGroups: commanders.length > 0 ? [{ label: COMMANDERS_LABEL, entries: commanders }] : [], rest }
}

/** Pulls imported token reference cards into their own pinned-last group by the `isToken` flag —
 *  not by category name, so a real card that happens to share a category name with the token
 *  section (most commonly a user's own "Tokens" synergy category) is never misrouted here. */
function splitTokenCards(entries: DeckCardEntry[]): { tokenGroups: CardGroup[]; rest: DeckCardEntry[] } {
  const tokens = entries.filter((entry) => entry.deckCard.isToken)
  const rest = entries.filter((entry) => !entry.deckCard.isToken)
  return { tokenGroups: tokens.length > 0 ? [{ label: TOKEN_CARDS_LABEL, entries: tokens }] : [], rest }
}

export function groupByType(entries: DeckCardEntry[]): CardGroup[] {
  const { commanderGroups, rest: afterCommanders } = splitCommanders(entries)
  const { tokenGroups, rest } = splitTokenCards(afterCommanders)
  return [
    ...commanderGroups,
    ...bucket(rest, (entry) => (entry.snapshot ? getPrimaryTypeGroup(entry.snapshot.type_line) : 'Other'), [...PRIMARY_TYPES, 'Other']),
    ...tokenGroups,
  ]
}

export function groupByCategory(entries: DeckCardEntry[], categories: string[]): CardGroup[] {
  const { commanderGroups, rest: afterCommanders } = splitCommanders(entries)
  // Token reference cards are pulled out before category-bucketing (see splitTokenCards) and
  // pinned last as their own section — never mixed into the category-string bucketing below, so a
  // same-named real category (e.g. a user's own "Tokens" synergy category) is unaffected.
  const { tokenGroups, rest } = splitTokenCards(afterCommanders)
  // Uncategorized leads the remaining groups: new cards land there, and it's a pain to scroll to
  // the bottom of a long list to find what you just added. The rest sort alphabetically rather
  // than `categories`' own manual/creation order (e.g. import order, or whatever order they were
  // clicked into existence) — a reader shouldn't have to learn/remember an arbitrary category
  // ordering to find one in a long list.
  const order = [UNCATEGORIZED_LABEL, ...[...categories].sort((a, b) => a.localeCompare(b))]
  return [
    ...commanderGroups,
    ...bucket(
      rest,
      (entry) =>
        entry.deckCard.category && categories.includes(entry.deckCard.category) ? entry.deckCard.category : UNCATEGORIZED_LABEL,
      order,
    ),
    ...tokenGroups,
  ]
}
