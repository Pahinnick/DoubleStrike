import { useState } from 'react'
import { resolveCardsByIdentifiers } from '../../api/scryfall'
import { useDeck } from '../../state/DeckContext'
import { useDeckList } from '../../state/DeckListContext'
import { saveSnapshots } from '../../storage/cardCache'

type Props = {
  cubeName: string
  myPool: string[]
  onDone: () => void
}

/** Converts the finished pool into a real, profile-scoped Deck and hands off to the existing
 *  deckbuilder wholesale — same createDeck + repeated ADD_CARD pattern ImportDeckModal.tsx
 *  already uses at the end of an import. Deliberately leaves `format` unset (already-supported
 *  "No format" state, createEmptyDeck's default) rather than inventing a new format — sidesteps
 *  legality.ts/FORMATS entirely. The actual 45-ish-to-40 cut happens afterward in the regular
 *  deckbuilder (search/stats/drag/categories), not a parallel UI here. */
function DraftDeckBuildingView({ cubeName, myPool, onDone }: Props) {
  const { dispatch } = useDeck()
  const { createDeck } = useDeckList()
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleBuildDeck() {
    setBuilding(true)
    setError(null)
    try {
      // A lookup that failed comes back as `failed`, not as a rejection. Building anyway made an
      // empty or partial deck, and finishing then cleared the pool — the draft's picks were
      // gone with nothing to show for it. Stop here instead; the pool is untouched and Build
      // Deck can simply be pressed again.
      const { cards, failed } = await resolveCardsByIdentifiers([...new Set(myPool)].map((id) => ({ id })))
      if (failed.length > 0) throw new Error('lookup failed')
      const quantities = new Map<string, number>()
      for (const id of myPool) quantities.set(id, (quantities.get(id) ?? 0) + 1)

      const deckName = `Draft — ${cubeName} — ${new Date().toLocaleDateString()}`
      await createDeck(deckName)

      for (const card of cards) {
        dispatch({ type: 'ADD_CARD', scryfallId: card.id, board: 'mainboard' })
        const quantity = quantities.get(card.id) ?? 1
        if (quantity > 1) dispatch({ type: 'SET_QUANTITY', scryfallId: card.id, board: 'mainboard', quantity })
      }
      await saveSnapshots(cards)
      onDone()
    } catch {
      setError("Couldn't build the deck — check your connection and try again.")
      setBuilding(false)
    }
  }

  return (
    <div className="draft-view__complete">
      <h2>Draft complete — {myPool.length} cards picked</h2>
      <p>Build a deck from your pool, then cut it down to a playable size (roughly 40 cards) in the regular deckbuilder.</p>
      {error && <p className="search-status search-status--error">{error}</p>}
      <button type="button" onClick={handleBuildDeck} disabled={building}>
        {building ? 'Building…' : 'Build Deck'}
      </button>
    </div>
  )
}

export default DraftDeckBuildingView
