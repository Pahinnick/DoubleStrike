import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { getCardsByIdentifiers } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { findCardsForCategory } from '../../engine/similarCards'
import { SIMILAR_SORT_OPTIONS, sortSimilarMatches, type SimilarSort } from '../../engine/similarCardSort'
import { useCardSnapshots } from '../../hooks/useCardSnapshots'
import { useCommanderColorIdentity } from '../../hooks/useCommanderColorIdentity'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'
import { useDeck } from '../../state/DeckContext'
import { loadOrBuildTagIndex, type TagIndexData } from '../../storage/tagIndex'
import type { Color } from '../../utils/colors'
import { useCategoryRecommendationsContext } from './CategoryRecommendationsContext'
import SimilarCardRow from './SimilarCardRow'
import './similarCards.css'

type Status = 'idle' | 'loading' | 'error' | 'ready'
type Match = { card: ScryfallCard; matchCount: number; matchedTags: string[] }

const MAX_MATCHES = 75

/** Right-click a category header to get here — same "otag" machinery as SimilarCardsView's
 *  suggestions list, but the query is the union of tags already on the category's own cards
 *  instead of one card's tags, via engine/similarCards' findCardsForCategory. */
function CategoryRecommendationsView() {
  const { openCategory, setOpenCategory } = useCategoryRecommendationsContext()
  const { deck, addCard } = useDeck()
  const commanderIdentity = useCommanderColorIdentity()

  const categoryScryfallIds = useMemo(
    () => (openCategory ? [...new Set(deck.cards.filter((c) => c.category === openCategory).map((c) => c.scryfallId))] : []),
    [deck.cards, openCategory],
  )
  const [categorySnapshots] = useCardSnapshots(categoryScryfallIds)
  const categoryOracleIds = useMemo(
    () => categoryScryfallIds.map((id) => categorySnapshots.get(id)?.oracle_id).filter((id): id is string => id !== undefined),
    [categoryScryfallIds, categorySnapshots],
  )

  const [tagIndex, setTagIndex] = useState<TagIndexData | null>(null)
  const [indexStatus, setIndexStatus] = useState<Status>('idle')
  const [matches, setMatches] = useState<Match[]>([])
  const [matchesStatus, setMatchesStatus] = useState<Status>('idle')
  const [sort, setSort] = useState<SimilarSort>('match')

  useEffect(() => {
    if (!openCategory || tagIndex) return
    let cancelled = false
    setIndexStatus('loading')
    loadOrBuildTagIndex()
      .then((index) => {
        if (cancelled) return
        setTagIndex(index)
        setIndexStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setIndexStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [openCategory, tagIndex])

  // Waits for every card in the category to have a resolved snapshot (oracle_id) before ranking —
  // otherwise a category whose snapshots haven't loaded yet would briefly rank as if it had no
  // cards at all, same reasoning as useCommanderColorIdentity waiting on partner commanders.
  const categoryReady = categoryScryfallIds.length > 0 && categoryScryfallIds.every((id) => categorySnapshots.has(id))

  useEffect(() => {
    if (!openCategory || !tagIndex || !categoryReady) {
      setMatches([])
      setMatchesStatus('idle')
      return
    }
    let cancelled = false
    const ranked = findCardsForCategory(tagIndex, categoryOracleIds, MAX_MATCHES)
    if (ranked.length === 0) {
      setMatches([])
      setMatchesStatus('ready')
      return
    }

    setMatchesStatus('loading')
    getCardsByIdentifiers(ranked.map((r) => ({ oracle_id: r.oracleId })))
      .then((cards) => {
        if (cancelled) return
        const byOracleId = new Map(cards.map((card) => [card.oracle_id, card]))
        const ordered = ranked
          .map((r) => {
            const card = byOracleId.get(r.oracleId)
            return card ? { card, matchCount: r.matchCount, matchedTags: r.matchedTags } : undefined
          })
          .filter((entry): entry is Match => entry !== undefined)
        setMatches(ordered)
        setMatchesStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setMatchesStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [openCategory, tagIndex, categoryReady, categoryOracleIds])

  // A newly-opened category starts back on the default ranking — leftover from a previously
  // opened category wouldn't make sense here.
  useEffect(() => {
    setSort('match')
  }, [openCategory])

  useEscapeToClose(() => setOpenCategory(null), Boolean(openCategory))

  if (!openCategory) return null

  const identityMatches = commanderIdentity
    ? matches.filter((m) => m.card.color_identity.every((c) => commanderIdentity.has(c as Color)))
    : matches
  const visibleMatches = sortSimilarMatches(identityMatches, sort)

  return createPortal(
    <div className="similar-cards-overlay" onClick={() => setOpenCategory(null)}>
      <div className="similar-cards-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="similar-cards-panel__close" onClick={() => setOpenCategory(null)} aria-label="Close">
          ×
        </button>

        <div className="similar-cards-panel__header-info">
          <h2>{openCategory}</h2>
          <p className="similar-cards-panel__price-salt">
            Recommendations based on {categoryScryfallIds.length} card{categoryScryfallIds.length === 1 ? '' : 's'} already in this category
          </p>
          {indexStatus === 'loading' && <p className="search-status">Loading tag data (first time only, a few seconds)…</p>}
          {indexStatus === 'error' && <p className="search-status search-status--error">Couldn't load tag data.</p>}
        </div>

        <div className="similar-cards-panel__suggestions">
          <div className="similar-cards-panel__suggestions-header">
            <h3>Suggested cards</h3>
            {visibleMatches.length > 1 && (
              <label className="similar-cards-panel__sort">
                Sort by
                <select value={sort} onChange={(event) => setSort(event.target.value as SimilarSort)}>
                  {SIMILAR_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="similar-cards-panel__list">
            {matchesStatus === 'loading' && <p className="search-status">Finding recommended cards…</p>}
            {matchesStatus === 'error' && <p className="search-status search-status--error">Couldn't load recommended cards.</p>}
            {matchesStatus === 'ready' && visibleMatches.length === 0 && (
              <p className="search-status">
                {matches.length > 0 && identityMatches.length === 0
                  ? "No matching cards fit your commander's color identity."
                  : "No tagged cards in this category yet — add a few and recommendations will show up here."}
              </p>
            )}
            {visibleMatches.map(({ card, matchCount }) => (
              <SimilarCardRow key={card.id} card={card} matchCount={matchCount} onAdd={() => addCard(card, 'mainboard', openCategory)} />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default CategoryRecommendationsView
