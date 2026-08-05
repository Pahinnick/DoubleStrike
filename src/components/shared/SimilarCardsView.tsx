import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { getCardPrints, getCardsByIdentifiers, getDisplayImage, ScryfallApiError } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { findSimilarCards, getTagsForCard } from '../../engine/similarCards'
import { SIMILAR_SORT_OPTIONS, sortSimilarMatches, type SimilarSort } from '../../engine/similarCardSort'
import { useCommanderColorIdentity } from '../../hooks/useCommanderColorIdentity'
import { useSaltScores } from '../../hooks/useSaltScores'
import { useDeck } from '../../state/DeckContext'
import type { FoilKind } from '../../state/types'
import { loadOrBuildTagIndex, type TagIndexData } from '../../storage/tagIndex'
import type { Color } from '../../utils/colors'
import { FOIL_OPTIONS } from '../../utils/foil'
import { formatUsd, getCardUsdPrice } from '../../utils/price'
import FoilShine from './FoilShine'
import { useSimilarCardsContext } from './SimilarCardsContext'
import SimilarCardRow from './SimilarCardRow'
import './similarCards.css'

type Status = 'idle' | 'loading' | 'error' | 'ready'
type Match = { card: ScryfallCard; matchCount: number; matchedTags: string[] }

const MAX_MATCHES = 75

type Props = {
  onAddTagToSearch: (slug: string) => void
}

function SimilarCardsView({ onAddTagToSearch }: Props) {
  const { openCard, setOpenCard } = useSimilarCardsContext()
  const { deck, dispatch, addCard, setCardPrinting } = useDeck()

  // Suggestions stay within the commander's color identity ("at most", same default as the
  // advanced search Color identity filter), so they're actually castable in this deck.
  const commanderIdentity = useCommanderColorIdentity()

  const [tagIndex, setTagIndex] = useState<TagIndexData | null>(null)
  const [indexStatus, setIndexStatus] = useState<Status>('idle')
  const [matches, setMatches] = useState<Match[]>([])
  const [matchesStatus, setMatchesStatus] = useState<Status>('idle')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [sort, setSort] = useState<SimilarSort>('match')
  const [prints, setPrints] = useState<ScryfallCard[]>([])
  const [printsStatus, setPrintsStatus] = useState<Status>('idle')
  const [selectedPrint, setSelectedPrint] = useState<ScryfallCard | null>(null)

  const saltLookupNames = useMemo(() => (openCard ? [openCard.name] : []), [openCard])
  const [saltScores] = useSaltScores(saltLookupNames)

  // Load (or reuse) the tag index once — cached after the first open, even across drilling into other cards.
  useEffect(() => {
    if (!openCard || tagIndex) return
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
  }, [openCard, tagIndex])

  // Whenever the open card changes (including drilling into a match), recompute + fetch its similar cards.
  useEffect(() => {
    if (!openCard || !tagIndex) {
      setMatches([])
      setMatchesStatus('idle')
      return
    }
    let cancelled = false
    const ranked = findSimilarCards(tagIndex, openCard.oracle_id, MAX_MATCHES)
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
  }, [openCard, tagIndex])

  // A newly-opened card starts with no tag filter, no picked-art override, and back on the
  // default ranking — drilling into a suggestion is a fresh question, so a price sort left over
  // from the previous card would silently reframe the new one's results.
  useEffect(() => {
    setActiveTag(null)
    setSelectedPrint(null)
    setSort('match')
  }, [openCard])

  // Every printing of the open card, for the art-selection row.
  useEffect(() => {
    if (!openCard) {
      setPrints([])
      setPrintsStatus('idle')
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setPrintsStatus('loading')
    getCardPrints(openCard.oracle_id, controller.signal)
      .then((result) => {
        if (cancelled) return
        setPrints(result)
        setPrintsStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return
        if (err instanceof ScryfallApiError && err.code === 'not_found') {
          setPrints([])
          setPrintsStatus('ready')
          return
        }
        setPrintsStatus('error')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [openCard])

  useEffect(() => {
    if (!openCard) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenCard(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [openCard, setOpenCard])

  // Deck entries (any board) currently using some printing of this Oracle card — used both to
  // highlight the active art and to decide whether picking an art swaps those entries' printing
  // versus adding the card to the deck fresh.
  const printIds = useMemo(() => new Set(prints.map((p) => p.id)), [prints])
  const deckMatches = useMemo(() => deck.cards.filter((c) => printIds.has(c.scryfallId)), [deck.cards, printIds])

  function handleSelectPrint(printCard: ScryfallCard) {
    setSelectedPrint(printCard)
    if (deckMatches.length > 0) {
      for (const match of deckMatches) {
        if (match.scryfallId !== printCard.id) setCardPrinting(printCard, match.scryfallId, match.board)
      }
      return
    }
    addCard(printCard)
  }

  // Applies to every copy of this card currently in the deck (any board/printing) — same
  // "all matches" behavior as handleSelectPrint, just setting a cosmetic flag instead of swapping
  // scryfallId. Survives a later art swap since SET_PRINTING only ever touches scryfallId.
  function handleSelectFoil(foil: FoilKind | undefined) {
    for (const match of deckMatches) {
      dispatch({ type: 'SET_CARD_FOIL', scryfallId: match.scryfallId, board: match.board, foil })
    }
  }

  if (!openCard) return null

  const heroImage = getDisplayImage(selectedPrint ?? openCard)
  const heroPrice = getCardUsdPrice(selectedPrint ?? openCard)
  // All matches share one foil setting in practice (handleSelectFoil always sets every one of
  // them together) — the first is as good a source of truth as any.
  const currentFoil = deckMatches[0]?.foil
  const saltScore = saltScores.get(openCard.name)
  const cardTags = tagIndex ? getTagsForCard(tagIndex, openCard.oracle_id) : []
  const identityMatches = commanderIdentity
    ? matches.filter((m) => m.card.color_identity.every((c) => commanderIdentity.has(c as Color)))
    : matches
  const filteredMatches = activeTag ? identityMatches.filter((m) => m.matchedTags.includes(activeTag)) : identityMatches
  // Capped at MAX_MATCHES (75) upstream, so re-sorting on every render is cheap enough not to
  // need memoizing — and it can't be memoized here anyway, below the `if (!openCard)` return.
  const visibleMatches = sortSimilarMatches(filteredMatches, sort)

  return createPortal(
    <div className="similar-cards-overlay" onClick={() => setOpenCard(null)}>
      <div className="similar-cards-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="similar-cards-panel__close" onClick={() => setOpenCard(null)} aria-label="Close">
          ×
        </button>

        <div className="similar-cards-panel__header">
          {heroImage && (
            <img className="similar-cards-panel__hero" src={heroImage.large ?? heroImage.normal} alt={openCard.name} />
          )}
          <div className="similar-cards-panel__header-info">
            <h2>{openCard.name}</h2>
            {(heroPrice !== undefined || typeof saltScore === 'number') && (
              <p className="similar-cards-panel__price-salt">
                {heroPrice !== undefined && <span>{formatUsd(heroPrice)}</span>}
                {typeof saltScore === 'number' && <span title="EDHREC salt score">🧂 {saltScore.toFixed(1)} salt</span>}
              </p>
            )}

            {indexStatus === 'loading' && (
              <p className="search-status">Loading tag data (first time only, a few seconds)…</p>
            )}
            {indexStatus === 'error' && <p className="search-status search-status--error">Couldn't load tag data.</p>}

            {tagIndex && (
              <div className="similar-cards-panel__tags">
                {cardTags.length === 0 && <p className="search-status">No tags found for this card.</p>}
                {cardTags.map((tag) => {
                  const label = tagIndex.tagLabels[tag.slug] ?? tag.slug
                  return (
                    <span key={tag.slug} className={`tag-chip ${activeTag === tag.slug ? 'is-active' : ''}`}>
                      <button
                        type="button"
                        className="tag-chip__label"
                        title="Filter the list below to this tag"
                        onClick={() => setActiveTag((current) => (current === tag.slug ? null : tag.slug))}
                      >
                        {label}
                      </button>
                      <button
                        type="button"
                        className="tag-chip__add"
                        title="Add to search"
                        aria-label={`Add ${label} to search`}
                        onClick={() => onAddTagToSearch(tag.slug)}
                      >
                        +
                      </button>
                    </span>
                  )
                })}
              </div>
            )}

            {deckMatches.length > 0 && (
              <div className="similar-cards-panel__foil-selection">
                <h3>Foil</h3>
                <div className="foil-swatches">
                  <button
                    type="button"
                    className={`foil-swatch ${!currentFoil ? 'is-selected' : ''}`}
                    onClick={() => handleSelectFoil(undefined)}
                  >
                    <span className="foil-swatch__none">None</span>
                  </button>
                  {FOIL_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={`foil-swatch ${currentFoil === option.id ? 'is-selected' : ''}`}
                      onClick={() => handleSelectFoil(option.id)}
                    >
                      <span className="foil-swatch__art">
                        <FoilShine foil={option.id} preview />
                      </span>
                      <span className="foil-swatch__label">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {printsStatus === 'error' && <p className="search-status search-status--error">Couldn't load other printings.</p>}
            {prints.length > 1 && (
              <div className="similar-cards-panel__art-selection">
                <h3>Choose art{deckMatches.length > 0 ? ' (updates the copy in your deck)' : ''}</h3>
                <div className="art-swatches">
                  {prints.map((print) => {
                    const art = getDisplayImage(print)
                    const isSelected = deckMatches.some((m) => m.scryfallId === print.id)
                    const year = print.released_at?.slice(0, 4)
                    return (
                      <button
                        type="button"
                        key={print.id}
                        className={`art-swatch ${isSelected ? 'is-selected' : ''}`}
                        title={`${print.set_name ?? print.set ?? ''}${year ? ` (${year})` : ''}`}
                        onClick={() => handleSelectPrint(print)}
                      >
                        {art && <img src={art.art_crop ?? art.normal} alt={`${openCard.name} — ${print.set_name ?? print.set}`} />}
                        <span className="art-swatch__label">
                          {print.set?.toUpperCase()}
                          {year ? ` · ${year}` : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
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
            {matchesStatus === 'loading' && <p className="search-status">Finding similar cards…</p>}
            {matchesStatus === 'error' && <p className="search-status search-status--error">Couldn't load similar cards.</p>}
            {matchesStatus === 'ready' && visibleMatches.length === 0 && cardTags.length > 0 && (
              <p className="search-status">
                {matches.length > 0 && identityMatches.length === 0
                  ? "No matching cards fit your commander's color identity."
                  : activeTag
                    ? 'No other cards share this tag.'
                    : 'No other cards share these tags yet.'}
              </p>
            )}
            {visibleMatches.map(({ card, matchCount }) => (
              <SimilarCardRow key={card.id} card={card} matchCount={matchCount} onAdd={() => addCard(card)} />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default SimilarCardsView
