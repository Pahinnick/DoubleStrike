import { useMemo, useState } from 'react'
import { getDisplayImage } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { useCardSearch } from '../../hooks/useCardSearch'
import { useCommanderPopularity } from '../../hooks/useCommanderPopularity'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import { useSimilarCardsTrigger } from '../../hooks/useSimilarCardsTrigger'
import { useDeck } from '../../state/DeckContext'
import { EMPTY_FILTERS } from '../../utils/scryfallQuery'
import { formatUsd, getCardUsdPrice } from '../../utils/price'
import '../shared/similarCards.css'
import '../search/search.css'
import './commanderBrowser.css'

type Props = {
  onClose: () => void
}

const SEARCH_FILTERS = { ...EMPTY_FILTERS, sort: 'edhrec' as const }

/** Browse every card Scryfall considers commander-eligible, ranked by EDHREC popularity (most-played
 *  first) — a quick-start path into a Commander deck without already knowing who you want to build
 *  around. Only surfaced from the header when the active deck's format is 'commander' (see AppShell). */
function CommanderBrowserModal({ onClose }: Props) {
  const { deck, dispatch, addCard } = useDeck()
  const [search, setSearch] = useState('')

  // `is:commander` is always the base filter; anything the user types narrows it further by name,
  // same as a normal Scryfall search — so "is:commander goblin" still only returns commanders.
  const query = ['is:commander', search.trim()].filter(Boolean).join(' ')
  const { results, status, error, hasMore, loadingMore, loadMore } = useCardSearch(query, SEARCH_FILTERS)
  const deckCounts = useCommanderPopularity(results.map((card) => card.name))

  // Re-ranks Scryfall's edhrec-rank order by the actual EDHREC "decks with this commander" count
  // once it's loaded. Sort is stable, and cards with no count yet (undefined) or no commander page
  // at all (null) both fall to -1, so they sink to the bottom in their original relative order
  // instead of jumping around as counts trickle in.
  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => (deckCounts.get(b.name) ?? -1) - (deckCounts.get(a.name) ?? -1))
  }, [results, deckCounts])

  const commanderIds = new Set(deck.cards.filter((c) => c.isCommander).map((c) => c.scryfallId))

  function toggleCommander(card: ScryfallCard) {
    if (commanderIds.has(card.id)) {
      dispatch({ type: 'SET_COMMANDER', scryfallId: card.id, board: 'mainboard', isCommander: false })
      return
    }
    addCard(card, 'mainboard')
    dispatch({ type: 'SET_COMMANDER', scryfallId: card.id, board: 'mainboard', isCommander: true })
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Choose a commander" onClick={onClose}>
      <div className="modal-content commander-browser" onClick={(event) => event.stopPropagation()}>
        <h2>Choose a Commander</h2>
        <p className="search-status">
          Every commander-eligible card, ranked by number of decks on EDHREC. Click one to add it to your deck as
          the commander — click again to unset it.
        </p>
        <input
          type="text"
          placeholder="Search commanders…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
        />
        <div className="commander-browser__list">
          {status === 'loading' && <p className="search-status">Searching…</p>}
          {status === 'error' && <p className="search-status search-status--error">{error}</p>}
          {status === 'done' && results.length === 0 && <p className="search-status">No commanders found.</p>}
          <div className="similar-cards-panel__list">
            {sortedResults.map((card) => (
              <CommanderBrowserTile
                key={card.id}
                card={card}
                isCommander={commanderIds.has(card.id)}
                deckCount={deckCounts.get(card.name)}
                onPick={() => toggleCommander(card)}
              />
            ))}
          </div>
        </div>
        {hasMore && (
          <button type="button" className="search-load-more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function CommanderBrowserTile({
  card,
  isCommander,
  deckCount,
  onPick,
}: {
  card: ScryfallCard
  isCommander: boolean
  /** undefined = not loaded yet, null = EDHREC has no commander page for this card. */
  deckCount: number | null | undefined
  onPick: () => void
}) {
  const onContextMenu = useSimilarCardsTrigger(card)
  const [hoverHandlers] = useHoverPreview(card)
  const image = getDisplayImage(card)
  const price = getCardUsdPrice(card)

  return (
    <button
      type="button"
      className={`similar-card-tile commander-browser-tile ${isCommander ? 'is-commander' : ''}`}
      onClick={onPick}
      onContextMenu={onContextMenu}
      {...hoverHandlers}
    >
      {image ? (
        <img src={image.normal ?? image.small} alt={card.name} loading="lazy" />
      ) : (
        <div className="similar-card-tile__placeholder">{card.name}</div>
      )}
      {isCommander && <span className="commander-browser-tile__badge">★ Commander</span>}
      <div className="similar-card-tile__caption">
        <span className="similar-card-tile__name">{card.name}</span>
        {typeof deckCount === 'number' && (
          <span className="commander-browser-tile__decks" title="Decks on EDHREC with this commander">
            {deckCount.toLocaleString()} decks
          </span>
        )}
        <span className="similar-card-tile__count">
          {card.type_line}
          {price !== undefined && ` · ${formatUsd(price)}`}
        </span>
      </div>
    </button>
  )
}

export default CommanderBrowserModal
