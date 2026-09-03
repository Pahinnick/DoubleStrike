import { useMemo } from 'react'
import { useDeck } from '../state/DeckContext'
import { useCardSnapshots } from './useCardSnapshots'

/**
 * Names of the deck's designated commanders — one, or several for partners and Backgrounds.
 * Empty for a non-Commander deck, or one with no commander picked yet, which is what gates every
 * EDHREC surface (that data only exists per-commander).
 *
 * Derived here rather than passed around so both entry points into the recommendations modal — the
 * search pane's button and the deck list's Commanders header — agree without threading props
 * across the app.
 */
export function useCommanderNames(): string[] {
  const { deck } = useDeck()
  const commanderIds = useMemo(
    () => (deck.format === 'commander' ? deck.cards.filter((card) => card.isCommander).map((card) => card.scryfallId) : []),
    [deck.format, deck.cards],
  )
  const [snapshots] = useCardSnapshots(commanderIds)

  return useMemo(
    () => commanderIds.map((id) => snapshots.get(id)?.name).filter((name): name is string => Boolean(name)),
    [commanderIds, snapshots],
  )
}
