import type { Deck, DeckSummary } from '../state/types'
import { storage } from './storage'

export async function listDecks(profileId: string): Promise<DeckSummary[]> {
  const allDecks = await storage.listDecks(profileId)
  return allDecks
    .map((deck) => ({
      id: deck.id,
      name: deck.name,
      format: deck.format,
      // Token reference cards were never really "in" the deck — excluded the same way they're
      // excluded from legality checks and mana-curve stats.
      cardCount: deck.cards.reduce((sum, c) => (c.isToken ? sum : sum + c.quantity), 0),
      updatedAt: deck.updatedAt,
      commanderIds: deck.cards.filter((c) => c.isCommander).map((c) => c.scryfallId),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function loadDeck(profileId: string, id: string): Promise<Deck | undefined> {
  const deck = await storage.loadDeck(profileId, id)
  // Decks saved before the categories feature shipped won't have this field yet.
  return deck ? { ...deck, categories: deck.categories ?? [] } : undefined
}

export async function saveDeck(profileId: string, deck: Deck): Promise<void> {
  await storage.saveDeck(profileId, deck)
}

export async function deleteDeck(profileId: string, id: string): Promise<void> {
  await storage.deleteDeck(profileId, id)
}
