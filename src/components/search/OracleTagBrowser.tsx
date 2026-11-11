import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { mostPopularTagForCard, tagsByPopularity, buildOracleTagQuery } from '../../engine/oracleTagBrowser'
import { useCardSearch } from '../../hooks/useCardSearch'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'
import { useDeck } from '../../state/DeckContext'
import { loadOrBuildTagIndex, type TagIndexData } from '../../storage/tagIndex'
import { EMPTY_FILTERS } from '../../utils/scryfallQuery'
import OracleTagCardRow from './OracleTagCardRow'
import '../shared/similarCards.css'
import './oracleTagBrowser.css'

type Status = 'idle' | 'loading' | 'error' | 'ready'

type Props = {
  open: boolean
  onClose: () => void
}

const SEARCH_FILTERS = { ...EMPTY_FILTERS, sort: 'edhrec' as const }

function OracleTagBrowser({ open, onClose }: Props) {
  useEscapeToClose(onClose, open)
  const { addCard } = useDeck()
  const [tagIndex, setTagIndex] = useState<TagIndexData | null>(null)
  const [indexStatus, setIndexStatus] = useState<Status>('idle')
  const [tagFilter, setTagFilter] = useState('')
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([])

  useEffect(() => {
    if (!open || tagIndex) return
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
  }, [open, tagIndex])

  const allTags = useMemo(() => (tagIndex ? tagsByPopularity(tagIndex) : []), [tagIndex])
  const visibleTags = useMemo(() => {
    const needle = tagFilter.trim().toLowerCase()
    if (needle.length === 0) return allTags
    return allTags.filter((tag) => tag.label.toLowerCase().includes(needle) || tag.slug.includes(needle))
  }, [allTags, tagFilter])

  const query = useMemo(() => buildOracleTagQuery(selectedSlugs), [selectedSlugs])
  const { results, status, error, hasMore, loadingMore, loadMore } = useCardSearch(query, SEARCH_FILTERS)

  function toggleTag(slug: string) {
    setSelectedSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]))
  }

  function mostPopularTagLabel(oracleId: string): string | undefined {
    if (!tagIndex) return undefined
    const tag = mostPopularTagForCard(tagIndex, oracleId)
    return tag ? tagIndex.tagLabels[tag.slug] ?? tag.slug : undefined
  }

  if (!open) return null

  return createPortal(
    <div className="similar-cards-overlay" onClick={onClose}>
      <div className="similar-cards-panel otag-browser-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="similar-cards-panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="otag-browser-header">
          <h2>Oracle Tags</h2>
          <p className="similar-cards-panel__price-salt">
            Browse cards by community-tagged function, across all colors — sorted by EDHREC rank.
          </p>
          {indexStatus === 'loading' && <p className="search-status">Loading tag data (first time only, a few seconds)…</p>}
          {indexStatus === 'error' && <p className="search-status search-status--error">Couldn't load tag data.</p>}
        </div>

        <div className="otag-browser-columns">
          <div className="otag-browser-tags">
            <input
              type="text"
              placeholder="Search tags…"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              aria-label="Search oracle tags"
            />
            <div className="otag-browser-tag-list">
              {visibleTags.map((tag) => (
                <label key={tag.slug} className="otag-browser-tag-row">
                  <input type="checkbox" checked={selectedSlugs.includes(tag.slug)} onChange={() => toggleTag(tag.slug)} />
                  <span className="otag-browser-tag-row__label">{tag.label}</span>
                  <span className="otag-browser-tag-row__count">{tag.count}</span>
                </label>
              ))}
              {indexStatus === 'ready' && visibleTags.length === 0 && <p className="search-status">No tags match "{tagFilter}".</p>}
            </div>
          </div>

          <div className="otag-browser-results">
            {status === 'loading' && <p className="search-status">Searching…</p>}
            {status === 'error' && <p className="search-status search-status--error">{error}</p>}
            {status === 'done' && results.length === 0 && <p className="search-status">No cards found.</p>}
            <div className="similar-cards-panel__list">
              {results.map((card) => (
                <OracleTagCardRow key={card.id} card={card} tagLabel={mostPopularTagLabel(card.oracle_id)} onAdd={() => addCard(card)} />
              ))}
            </div>
            {hasMore && (
              <button type="button" className="search-load-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default OracleTagBrowser
