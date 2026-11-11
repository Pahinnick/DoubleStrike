import { useEffect, useMemo, useState } from 'react'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { useCardSearch } from '../../hooks/useCardSearch'
import { useCardSnapshots } from '../../hooks/useCardSnapshots'
import { useCommanderNames } from '../../hooks/useCommanderNames'
import { useDeckMembership } from '../../hooks/useDeckMembership'
import { useNameAutocomplete } from '../../hooks/useNameAutocomplete'
import Autocomplete from '../shared/Autocomplete'
import CardSizeToggle from '../shared/CardSizeToggle'
import { useDeck } from '../../state/DeckContext'
import type { CardSizeKey } from '../../utils/cardSize'
import { COLOR_NAMES, WUBRG, type Color } from '../../utils/colors'
import { EMPTY_FILTERS, SORT_ORDERS, type SearchFilters, type SortOrder, scryfallFormatOf } from '../../utils/scryfallQuery'
import AdvancedSearchPanel from './AdvancedSearchPanel'
import { useCommanderRecommendationsContext } from '../shared/CommanderRecommendationsContext'
import CardResultGrid from './CardResultGrid'
import TypeMultiSelect from './TypeMultiSelect'
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
  // The modal itself is mounted once in App.tsx — the deck list's Commanders header raises it too.
  const { setOpen: setRecommendationsOpen } = useCommanderRecommendationsContext()
  // A Limited deck has no Scryfall format to filter by (you play whatever you drafted).
  const searchFormat = scryfallFormatOf(deck.format)
  const filters = useMemo<SearchFilters>(() => ({ ...localFilters, format: searchFormat }), [localFilters, searchFormat])
  const { results, status, error, hasMore, loadingMore, loadMore } = useCardSearch(text, filters)
  const nameSuggestions = useNameAutocomplete(text)
  const membership = useDeckMembership()

  // The main box searches card *names* only — Scryfall's unprefixed search never looks at rules
  // text (see utils/scryfallQuery.ts). So the most natural query a deckbuilder can type, "draw a
  // card", matches nothing at all. When a name search comes back empty we re-run it as a rules-text
  // search instead of leaving the user at a dead end. Gated on the primary search being *done* and
  // empty, so it costs nothing whenever searching by name worked.
  const trimmedText = text.trim()
  const fallbackWanted = status === 'done' && results.length === 0 && trimmedText.length > 0
  const fallbackFilters = useMemo<SearchFilters>(() => ({ ...filters, cardText: trimmedText }), [filters, trimmedText])
  const fallback = useCardSearch('', fallbackFilters, { enabled: fallbackWanted })

  /** Moves what's in the name box into the rules-text filter — the manual version of the fallback
   *  above, for a query like "flying" that *does* match a card name and so never triggers it, while
   *  the user almost certainly wanted the thousands of cards with the keyword instead. */
  function searchRulesTextInstead() {
    setLocalFilters((prev) => ({ ...prev, cardText: trimmedText }))
    onTextChange('')
    // Open Advanced so the filter this just set is visible. Card text sticks around like every
    // other filter, and an invisible one silently ANDs itself into the next search — type a new
    // name afterwards and you'd get a baffling "no results" with nothing on screen explaining why.
    setAdvancedOpen(true)
  }

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

  // EDHREC only publishes per-commander data, so the Recommended button appears only once there's
  // a commander to ask about.
  const commanderNames = useCommanderNames()

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
      <Autocomplete
        tutorialId="search-input"
        placeholder="Search cards..."
        value={text}
        onChange={onTextChange}
        onCommit={onTextChange}
        suggestions={nameSuggestions}
        ariaLabel="Card name or text search"
      />

      <div className="search-filters">
        {searchFormat && <span className="search-format-badge">Filtering to {searchFormat}</span>}
        {!advancedOpen && (
          <TypeMultiSelect
            types={localFilters.types}
            onChange={(types) => setLocalFilters((prev) => ({ ...prev, types }))}
            ariaLabel="Card type"
            className="search-filters__type"
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
        <select
          aria-label="Sort by"
          value={localFilters.sort ?? ''}
          onChange={(event) =>
            setLocalFilters((prev) => ({ ...prev, sort: (event.target.value || undefined) as SortOrder | undefined }))
          }
        >
          <option value="">Sort: Relevance</option>
          {SORT_ORDERS.map((order) => (
            <option key={order.value} value={order.value}>
              Sort: {order.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`search-advanced-toggle ${advancedOpen ? 'is-active' : ''}`}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          Advanced
        </button>
        {commanderNames.length > 0 && (
          <button
            type="button"
            className="search-advanced-toggle"
            title="EDHREC's most-played cards for this commander"
            onClick={() => setRecommendationsOpen(true)}
          >
            Recommended
          </button>
        )}
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
      {results.length > 0 && (
        <div className="search-results-header">
          <span className="search-status">
            {results.length} card{results.length > 1 ? 's' : ''}
          </span>
          <CardSizeToggle value={cardSize} onChange={onCardSizeChange} />
        </div>
      )}
      {results.length > 0 && trimmedText.length > 0 && (
        <button type="button" className="search-text-fallback__switch" onClick={searchRulesTextInstead}>
          Search rules text for “{trimmedText}” instead
        </button>
      )}

      <CardResultGrid cards={results} onAdd={onAddCard} cardSize={cardSize} membership={membership} />

      {hasMore && (
        <button type="button" className="search-load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

      {fallbackWanted && (
        <div className="search-text-fallback">
          <p className="search-status">
            No cards named “{trimmedText}”.
            {fallback.status === 'loading' && ' Looking for cards that say it…'}
            {fallback.status === 'done' &&
              (fallback.results.length > 0
                ? ` Showing ${fallback.results.length} card${fallback.results.length > 1 ? 's' : ''} that say it.`
                : ' No cards say it either.')}
          </p>
          {fallback.status === 'error' && <p className="search-status search-status--error">{fallback.error}</p>}
          <CardResultGrid cards={fallback.results} onAdd={onAddCard} cardSize={cardSize} membership={membership} />
          {fallback.hasMore && (
            <button type="button" className="search-load-more" onClick={fallback.loadMore} disabled={fallback.loadingMore}>
              {fallback.loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export default SearchPanel
