import { useEffect, useMemo, useState } from 'react'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { useCardSearch } from '../../hooks/useCardSearch'
import { useCardSnapshots } from '../../hooks/useCardSnapshots'
import CardSizeToggle from '../shared/CardSizeToggle'
import { useDeck } from '../../state/DeckContext'
import type { CardSizeKey } from '../../utils/cardSize'
import { COLOR_NAMES, WUBRG, type Color } from '../../utils/colors'
import { EMPTY_FILTERS, type SearchFilters } from '../../utils/scryfallQuery'
import AdvancedSearchPanel from './AdvancedSearchPanel'
import CardResultGrid from './CardResultGrid'
import './search.css'

type Props = {
  onAddCard: (card: ScryfallCard) => void
  text: string
  onTextChange: (text: string) => void
  expanded: boolean
  onExpand: () => void
  onCollapse: () => void
  cardSize: CardSizeKey
  onCardSizeChange: (size: CardSizeKey) => void
}

function SearchPanel({ onAddCard, text, onTextChange, expanded, onExpand, onCollapse, cardSize, onCardSizeChange }: Props) {
  const { deck } = useDeck()
  const [localFilters, setLocalFilters] = useState<Omit<SearchFilters, 'format'>>(EMPTY_FILTERS)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const filters = useMemo<SearchFilters>(() => ({ ...localFilters, format: deck.format }), [localFilters, deck.format])
  const { results, status, error, hasMore, loadingMore, loadMore } = useCardSearch(text, filters)

  // When a commander is designated, the Color identity filter defaults to its color identity
  // (with the "at most these" default match, that means "cards this deck could actually play").
  // Partner commanders (or a commander + Background) union their identities together — a deck
  // isn't limited to just whichever commander card happened to be first in the list.
  const commanderIds = useMemo(
    () => (deck.format === 'commander' ? deck.cards.filter((c) => c.isCommander).map((c) => c.scryfallId) : []),
    [deck.format, deck.cards],
  )
  const [commanderSnapshots] = useCardSnapshots(commanderIds)
  const commanderIdentity = useMemo(() => {
    const identity = commanderIds.flatMap((id) => commanderSnapshots.get(id)?.color_identity ?? [])
    return [...new Set(identity.filter((c): c is Color => (WUBRG as readonly string[]).includes(c)))]
  }, [commanderIds, commanderSnapshots])
  const identityKey = commanderIdentity.join('')

  // Re-applied whenever the commander (identity) changes; manual edits persist until then.
  useEffect(() => {
    setLocalFilters((prev) => ({ ...prev, colorIdentity: commanderIdentity }))
    // identityKey is a stable serialization of commanderIdentity, same pattern as filtersKey above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey])

  function toggleColor(color: Color) {
    setLocalFilters((prev) => ({
      ...prev,
      colors: prev.colors.includes(color) ? prev.colors.filter((c) => c !== color) : [...prev.colors, color],
    }))
  }

  if (!expanded) {
    return (
      <section className="app-pane search-pane is-collapsed" aria-label="Card search">
        <button type="button" className="search-pane__tab" data-tutorial-id="search-tab" onClick={onExpand} aria-expanded={false}>
          <span className="search-pane__tab-icon" aria-hidden="true">
            🔍
          </span>
          <span className="search-pane__tab-label">Search</span>
        </button>
      </section>
    )
  }

  return (
    <section className="app-pane search-pane" data-tutorial-id="search-pane" aria-label="Card search">
      <div className="search-pane__header">
        <h2>Search</h2>
        <button type="button" className="search-collapse-toggle" onClick={onCollapse} aria-label="Collapse search panel">
          Collapse
        </button>
      </div>
      <input
        type="text"
        data-tutorial-id="search-input"
        placeholder="Search cards..."
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        aria-label="Card name or text search"
      />

      <div className="search-filters">
        {deck.format && <span className="search-format-badge">Filtering to {deck.format}</span>}
        {!advancedOpen && (
          <input
            type="text"
            placeholder="Type (e.g. creature)"
            value={localFilters.type}
            onChange={(event) => setLocalFilters((prev) => ({ ...prev, type: event.target.value }))}
            aria-label="Card type"
          />
        )}
        {!advancedOpen && (
          <div className="color-filter" role="group" aria-label="Colors">
            {WUBRG.map((color) => (
              <button
                key={color}
                type="button"
                aria-pressed={filters.colors.includes(color)}
                title={COLOR_NAMES[color]}
                className={`color-swatch color-swatch--${color.toLowerCase()} ${
                  filters.colors.includes(color) ? 'is-active' : ''
                }`}
                onClick={() => toggleColor(color)}
              >
                {color}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className={`search-advanced-toggle ${advancedOpen ? 'is-active' : ''}`}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          Advanced
        </button>
      </div>

      {advancedOpen && (
        <>
          <AdvancedSearchPanel filters={localFilters} onChange={(updater) => setLocalFilters(updater)} />
          <button type="button" className="search-advanced-clear" onClick={() => setLocalFilters(EMPTY_FILTERS)}>
            Clear filters
          </button>
        </>
      )}

      {status === 'loading' && <p className="search-status">Searching…</p>}
      {status === 'error' && <p className="search-status search-status--error">{error}</p>}
      {status === 'done' && results.length === 0 && <p className="search-status">No cards found.</p>}
      {results.length > 0 && (
        <div className="search-results-header">
          <span className="search-status">
            {results.length} card{results.length > 1 ? 's' : ''}
          </span>
          <CardSizeToggle value={cardSize} onChange={onCardSizeChange} />
        </div>
      )}

      <CardResultGrid cards={results} onAdd={onAddCard} cardSize={cardSize} />

      {hasMore && (
        <button type="button" className="search-load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  )
}

export default SearchPanel
