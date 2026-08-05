import type { Dispatch } from 'react'
import { getCardsByIdentifiers } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { saveSnapshots } from '../../storage/cardCache'
import type { DeckAction } from '../../state/deckReducer'
import { TUTORIAL_PRECON_DECK, type PreconDeckCard } from './tutorialPreconDeck'

export type ResolvedPreconEntry = { entry: PreconDeckCard; card: ScryfallCard }

/** Resolves the tutorial's precon list against Scryfall — split from applyTutorialPreconDeck
 *  below so a caller can gate the dispatch on this async fetch still being the latest attempt
 *  (see App.tsx, same shape as PlaytestView's solo-save resume). A name that fails to resolve
 *  (offline, a future Scryfall rename) is just skipped rather than failing the whole load — a
 *  slightly short precon still beats none at all. */
export async function resolveTutorialPreconDeck(): Promise<ResolvedPreconEntry[]> {
  const resolved = await getCardsByIdentifiers(TUTORIAL_PRECON_DECK.map((c) => ({ name: c.name })))
  const byName = new Map(resolved.map((card) => [card.name.toLowerCase(), card]))
  const matched: ResolvedPreconEntry[] = []
  for (const entry of TUTORIAL_PRECON_DECK) {
    const card = byName.get(entry.name.toLowerCase())
    if (card) matched.push({ entry, card })
  }
  return matched
}

/** Dispatches an already-resolved precon into whatever deck `dispatch` targets. Format is set
 *  first — the commander deck-construction rules (singleton/size/color identity) only kick in
 *  once the format is actually 'commander', and the whole point is for those checks to already
 *  be live by the time a card gets added. */
export async function applyTutorialPreconDeck(dispatch: Dispatch<DeckAction>, resolved: ResolvedPreconEntry[]): Promise<void> {
  dispatch({ type: 'SET_FORMAT', format: 'commander' })
  for (const { entry, card } of resolved) {
    dispatch({ type: 'ADD_CARD', scryfallId: card.id, board: 'mainboard' })
    if (entry.quantity > 1) dispatch({ type: 'SET_QUANTITY', scryfallId: card.id, board: 'mainboard', quantity: entry.quantity })
    if (entry.isCommander) dispatch({ type: 'SET_COMMANDER', scryfallId: card.id, board: 'mainboard', isCommander: true })
  }
  await saveSnapshots(resolved.map((r) => r.card))
}
