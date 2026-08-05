import { useMemo } from 'react'
import { useDeck } from '../state/DeckContext'
import { WUBRG, type Color } from '../utils/colors'
import { useCardSnapshots } from './useCardSnapshots'

/**
 * The active commander deck's color identity — the union of every designated commander's own
 * identity, so partner commanders (or a commander + Background) aren't limited to just whichever
 * one happened to be first in the list. `null` outside commander format, or while a commander's
 * own snapshot hasn't loaded yet (so a caller filtering by it doesn't briefly show an
 * over-restrictive identity missing a not-yet-loaded partner's colors).
 */
export function useCommanderColorIdentity(): Set<Color> | null {
  const { deck } = useDeck()
  const commanderIds = useMemo(
    () => (deck.format === 'commander' ? deck.cards.filter((c) => c.isCommander).map((c) => c.scryfallId) : []),
    [deck.format, deck.cards],
  )
  const [commanderSnapshots] = useCardSnapshots(commanderIds)
  return useMemo(() => {
    if (commanderIds.length === 0) return null
    if (!commanderIds.every((id) => commanderSnapshots.has(id))) return null
    const identity = commanderIds.flatMap((id) => commanderSnapshots.get(id)?.color_identity ?? [])
    return new Set(identity.filter((c): c is Color => (WUBRG as readonly string[]).includes(c)))
  }, [commanderIds, commanderSnapshots])
}
