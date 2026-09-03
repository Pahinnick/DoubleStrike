import { useMemo } from 'react'
import { buildDeckMembership, type MembershipCount } from '../engine/deckMembership'
import { useDeck } from '../state/DeckContext'
import { useCardSnapshots } from './useCardSnapshots'

/**
 * oracle_id -> copies the open deck runs, for "you already have this" markers on search results
 * and suggestion lists. See engine/deckMembership.ts for why this is keyed on the Oracle card.
 *
 * The snapshot fetch this triggers is the same id set DeckPanel already requests, so in practice
 * it resolves straight out of cache rather than costing a second round trip.
 */
export function useDeckMembership(): Map<string, MembershipCount> {
  const { deck } = useDeck()
  const uniqueIds = useMemo(() => [...new Set(deck.cards.map((card) => card.scryfallId))], [deck.cards])
  const [snapshots] = useCardSnapshots(uniqueIds)

  return useMemo(() => buildDeckMembership(deck.cards, snapshots), [deck.cards, snapshots])
}
