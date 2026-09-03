import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { getCardsByIdentifiers } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import {
  EDHREC_SORT_OPTIONS,
  inclusionRate,
  sortEdhrecMatches,
  type EdhrecCardRec,
  type EdhrecMatch,
  type EdhrecSort,
} from '../../engine/edhrecRecommendations'
import { useCommanderNames } from '../../hooks/useCommanderNames'
import { useCommanderRecommendations } from '../../hooks/useCommanderRecommendations'
import { useDeckMembership } from '../../hooks/useDeckMembership'
import { useDeck } from '../../state/DeckContext'
import { useCommanderRecommendationsContext } from '../shared/CommanderRecommendationsContext'
import SimilarCardRow from '../shared/SimilarCardRow'
import '../shared/similarCards.css'
import './oracleTagBrowser.css'

type HydrationStatus = 'idle' | 'loading' | 'ready' | 'error'

function captionFor(rec: EdhrecCardRec): string[] {
  const rate = inclusionRate(rec)
  const pct = rate >= 0.01 ? `${Math.round(rate * 100)}% of decks` : '<1% of decks'
  // Synergy is signed on purpose: a negative number is meaningful here ("popular everywhere, not
  // especially at home with this commander"), so it gets an explicit + rather than being hidden.
  const synergy = `${rec.synergy >= 0 ? '+' : ''}${rec.synergy.toFixed(2)} synergy`
  return [pct, synergy]
}

function CommanderRecommendationsModal() {
  const { open, setOpen } = useCommanderRecommendationsContext()
  const onClose = () => setOpen(false)
  const commanderNames = useCommanderNames()
  const { addCard } = useDeck()
  const membership = useDeckMembership()
  const recommendations = useCommanderRecommendations(commanderNames, open)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [sort, setSort] = useState<EdhrecSort>('inclusion')
  const [cards, setCards] = useState<Map<string, ScryfallCard>>(new Map())
  const [hydration, setHydration] = useState<HydrationStatus>('idle')
  const [hideOwned, setHideOwned] = useState(true)

  const lists = useMemo(() => recommendations.data?.lists ?? [], [recommendations.data])
  const activeList = useMemo(() => lists.find((list) => list.tag === selectedTag) ?? lists[0], [lists, selectedTag])

  // A freshly opened modal starts on the default ranking and the first list, rather than inheriting
  // whatever was left selected for a different commander.
  useEffect(() => {
    if (!open) return
    setSelectedTag(null)
    setSort('inclusion')
  }, [open])

  // EDHREC gives Scryfall card ids directly, so this resolves through the same batched,
  // cache-aware collection endpoint the rest of the app uses — 75 per request, and already-seen
  // cards cost no network at all.
  useEffect(() => {
    const recs = activeList?.cards
    if (!open || !recs || recs.length === 0) {
      setHydration('idle')
      return
    }
    let cancelled = false
    setHydration('loading')
    getCardsByIdentifiers(recs.map((rec) => ({ id: rec.scryfallId })))
      .then((resolved) => {
        if (cancelled) return
        setCards(new Map(resolved.map((card) => [card.id, card])))
        setHydration('ready')
      })
      .catch(() => {
        if (!cancelled) setHydration('error')
      })
    return () => {
      cancelled = true
    }
  }, [open, activeList])

  const visibleMatches = useMemo(() => {
    if (!activeList) return []
    const matches: EdhrecMatch[] = []
    for (const rec of activeList.cards) {
      const card = cards.get(rec.scryfallId)
      // A card that didn't resolve is simply left out — getCardsByIdentifiers returns partial
      // results by design, so a dropped batch shouldn't blank the whole list.
      if (!card) continue
      if (hideOwned && membership.has(card.oracle_id)) continue
      matches.push({ rec, card })
    }
    return sortEdhrecMatches(matches, sort)
  }, [activeList, cards, sort, hideOwned, membership])

  const ownedCount = useMemo(() => {
    if (!activeList) return 0
    return activeList.cards.filter((rec) => {
      const card = cards.get(rec.scryfallId)
      return card ? membership.has(card.oracle_id) : false
    }).length
  }, [activeList, cards, membership])

  if (!open) return null

  return createPortal(
    <div className="similar-cards-overlay" onClick={onClose}>
      <div className="similar-cards-panel otag-browser-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="similar-cards-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="otag-browser-header">
          <h2>{commanderNames.length > 0 ? `Recommended for ${commanderNames.join(' + ')}` : 'Recommended cards'}</h2>
          <p className="similar-cards-panel__price-salt">
            What other players actually run with this commander, from EDHREC.
          </p>
          {commanderNames.length === 0 && (
            <p className="search-status">Designate a commander first — EDHREC only publishes recommendations per commander.</p>
          )}
          {recommendations.status === 'loading' && <p className="search-status">Loading recommendations…</p>}
          {recommendations.status === 'empty' && (
            <p className="search-status">EDHREC has no recommendations for this commander.</p>
          )}
        </div>

        <div className="otag-browser-columns">
          <div className="otag-browser-tags">
            <div className="otag-browser-tag-list">
              {lists.map((list) => (
                <label key={list.tag} className="otag-browser-tag-row">
                  <input
                    type="radio"
                    name="edhrec-list"
                    checked={activeList?.tag === list.tag}
                    onChange={() => setSelectedTag(list.tag)}
                  />
                  <span className="otag-browser-tag-row__label">{list.header}</span>
                  <span className="otag-browser-tag-row__count">{list.cards.length}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="otag-browser-results">
            <div className="similar-cards-panel__suggestions-header">
              <label className="similar-cards-panel__sort">
                <input type="checkbox" checked={hideOwned} onChange={(event) => setHideOwned(event.target.checked)} />
                Hide cards already in the deck{ownedCount > 0 ? ` (${ownedCount})` : ''}
              </label>
              {visibleMatches.length > 1 && (
                <label className="similar-cards-panel__sort">
                  Sort by
                  <select value={sort} onChange={(event) => setSort(event.target.value as EdhrecSort)}>
                    {EDHREC_SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {hydration === 'loading' && <p className="search-status">Loading cards…</p>}
            {hydration === 'error' && <p className="search-status search-status--error">Couldn't load these cards.</p>}
            {hydration === 'ready' && visibleMatches.length === 0 && (
              <p className="search-status">
                {hideOwned && ownedCount > 0
                  ? 'You already run every card on this list.'
                  : 'No cards to show for this list.'}
              </p>
            )}
            <div className="similar-cards-panel__list">
              {visibleMatches.map(({ rec, card }) => (
                <SimilarCardRow
                  key={card.id}
                  card={card}
                  matchCount={0}
                  captionLines={captionFor(rec)}
                  onAdd={() => addCard(card)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default CommanderRecommendationsModal
