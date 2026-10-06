import { useEffect, useMemo, useState } from 'react'
import { getCardsByIdentifiers, getDisplayImage } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { useCardSearch } from '../../hooks/useCardSearch'
import { useCardSnapshots } from '../../hooks/useCardSnapshots'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'
import { useTopCommanders } from '../../hooks/useTopCommanders'
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

/** Browse every card Scryfall considers commander-eligible, ranked by how many EDHREC decks are
 *  *commanded by* it — a quick-start path into a Commander deck without already knowing who you want
 *  to build around. That count is deliberately not the card page's `num_decks`, which counts every
 *  deck the card appears in at all: the two diverge sharply (Atraxa commands ~44k decks but is played
 *  as a card in ~21k, since only four-colour decks can run it). Only surfaced from the header when
 *  the active deck's format is 'commander' (see AppShell). */
function CommanderBrowserModal({ onClose }: Props) {
  useEscapeToClose(onClose)
  const { deck, dispatch, addCard } = useDeck()
  const [search, setSearch] = useState('')

  // `is:commander` is always the base filter; anything the user types narrows it further by name,
  // same as a normal Scryfall search — so "is:commander goblin" still only returns commanders.
  const query = ['is:commander', search.trim()].filter(Boolean).join(' ')
  // Browsing (no search text) and searching are two different sources. Browsing is driven straight
  // from EDHREC's top-commanders list, because Scryfall's `is:commander order=edhrec` ranks by how
  // often a card is *played*, not how often it's *commanded* — its first page misses Atraxa and
  // Edgar Markov outright (see useTopCommanders). Typing a name falls back to the Scryfall search,
  // which is the only thing that can find the other ~2,000 commanders.
  const isBrowsing = search.trim().length === 0
  const { ranked, countsByName, hasMore: hasMoreTop, loading: loadingTop, loadMore: loadMoreTop } = useTopCommanders(true)
  const { results, status, error, hasMore, loadingMore, loadMore } = useCardSearch(query, SEARCH_FILTERS, {
    enabled: !isBrowsing,
  })

  const [topCards, setTopCards] = useState<ScryfallCard[]>([])
  const [topStatus, setTopStatus] = useState<'idle' | 'loading' | 'ready'>('idle')

  // EDHREC hands back Scryfall card ids, so the ranked list hydrates through the same batched,
  // cache-aware collection endpoint everything else uses — two requests for all 100.
  useEffect(() => {
    if (ranked.length === 0) return
    let cancelled = false
    setTopStatus('loading')
    getCardsByIdentifiers(ranked.map((rec) => ({ id: rec.scryfallId })))
      .then((cards) => {
        if (cancelled) return
        const byId = new Map(cards.map((card) => [card.id, card]))
        // Re-applied in EDHREC's order; anything that failed to resolve just drops out.
        setTopCards(ranked.map((rec) => byId.get(rec.scryfallId)).filter((c): c is ScryfallCard => c !== undefined))
        setTopStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setTopStatus('ready')
      })
    return () => {
      cancelled = true
    }
  }, [ranked])

  // Search results still get ranked by commander deck count where it's known; anything outside the
  // top-commanders list falls to -1 and sinks in its original relative order.
  const sortedResults = useMemo(() => {
    return [...results].sort(
      (a, b) => (countsByName.get(b.name.toLowerCase()) ?? -1) - (countsByName.get(a.name.toLowerCase()) ?? -1),
    )
  }, [results, countsByName])

  const visibleCards = isBrowsing ? topCards : sortedResults

  // The deck's copy of a card is matched by Oracle card, not by printing: the tile shown here is
  // whichever printing EDHREC or the search returned, which is rarely the one already in the
  // deck. Matching on the printing id alone added a second copy of a card the deck already ran
  // and never showed the badge for a commander held in a different printing.
  const deckCardIds = useMemo(() => [...new Set(deck.cards.map((c) => c.scryfallId))], [deck.cards])
  const [deckSnapshots] = useCardSnapshots(deckCardIds)

  function mainboardEntryFor(card: ScryfallCard) {
    const sameCard = (c: (typeof deck.cards)[number]) =>
      c.scryfallId === card.id || (Boolean(card.oracle_id) && deckSnapshots.get(c.scryfallId)?.oracle_id === card.oracle_id)
    const candidates = deck.cards.filter((c) => c.board === 'mainboard' && !c.isToken && sameCard(c))
    return candidates.find((c) => c.isCommander) ?? candidates.find((c) => c.scryfallId === card.id) ?? candidates[0]
  }

  function toggleCommander(card: ScryfallCard) {
    const existing = mainboardEntryFor(card)
    if (existing) {
      dispatch({ type: 'SET_COMMANDER', scryfallId: existing.scryfallId, board: 'mainboard', isCommander: !existing.isCommander })
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
          EDHREC's most-commanded cards — ranked by how many decks run each as their commander, not by how many
          play it as a card. Search to reach any other commander. Click one to add it to your deck as the
          commander — click again to unset it.
        </p>
        <input
          type="text"
          placeholder="Search commanders…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
        />
        <div className="commander-browser__list">
          {isBrowsing && topCards.length === 0 && topStatus !== 'ready' && (
            <p className="search-status">Loading top commanders…</p>
          )}
          {isBrowsing && topStatus === 'ready' && topCards.length === 0 && !loadingTop && (
            <p className="search-status">Couldn't load EDHREC's commander rankings — search by name instead.</p>
          )}
          {!isBrowsing && status === 'loading' && <p className="search-status">Searching…</p>}
          {!isBrowsing && status === 'error' && <p className="search-status search-status--error">{error}</p>}
          {!isBrowsing && status === 'done' && results.length === 0 && (
            <p className="search-status">No commanders found.</p>
          )}
          <div className="similar-cards-panel__list">
            {visibleCards.map((card) => (
              <CommanderBrowserTile
                key={card.id}
                card={card}
                isCommander={mainboardEntryFor(card)?.isCommander === true}
                deckCount={countsByName.get(card.name.toLowerCase())}
                onPick={() => toggleCommander(card)}
              />
            ))}
          </div>
        </div>
        {/* Both paths page, from different sources: EDHREC's ranking when browsing, Scryfall's
            when searching by name. */}
        {isBrowsing
          ? hasMoreTop && (
              <button type="button" className="search-load-more" onClick={loadMoreTop} disabled={loadingTop}>
                {loadingTop ? 'Loading…' : 'Load more'}
              </button>
            )
          : hasMore && (
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
  /** undefined = not among EDHREC's top commanders (or the list hasn't loaded yet). */
  deckCount: number | undefined
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
          <span className="commander-browser-tile__decks" title="EDHREC decks with this card as their commander — not decks that merely include it">
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
