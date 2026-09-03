import type { Board } from '../state/types'

/** How many copies of one Oracle card the deck runs, split by board. */
export type MembershipCount = { mainboard: number; sideboard: number }

/** Minimal shape needed from a deck entry — satisfied by DeckCard. */
export type MembershipEntry = { scryfallId: string; quantity: number; board: Board; isToken?: boolean }

/** Minimal shape needed to resolve a printing to its Oracle card — satisfied by CardSnapshot. */
export type MembershipSnapshot = { oracle_id: string }

/**
 * Maps oracle_id -> copies held, so a search result can say "you already run this".
 *
 * Keyed on the *Oracle* card rather than the scryfallId deliberately: a deck entry is one
 * specific printing, so an id-keyed lookup would report "not in deck" for a search result
 * showing a different art of a card you already run — exactly backwards for the singleton
 * formats where this badge matters most.
 *
 * Token reference cards are skipped: they're pinned deck-list scaffolding rather than real deck
 * slots (see engine/deckTokens.ts), so counting them would mark a card as owned that the deck
 * doesn't actually play.
 */
export function buildDeckMembership(
  entries: MembershipEntry[],
  snapshots: Map<string, MembershipSnapshot>,
): Map<string, MembershipCount> {
  const membership = new Map<string, MembershipCount>()

  for (const entry of entries) {
    if (entry.isToken) continue
    const oracleId = snapshots.get(entry.scryfallId)?.oracle_id
    // A snapshot that hasn't resolved yet simply doesn't count toward the badge. Showing nothing
    // beats guessing: the badge reappears on its own once useCardSnapshots fills the map in.
    if (!oracleId) continue
    const existing = membership.get(oracleId) ?? { mainboard: 0, sideboard: 0 }
    existing[entry.board] += entry.quantity
    membership.set(oracleId, existing)
  }

  return membership
}
