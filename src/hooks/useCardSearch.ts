import { useEffect, useMemo, useRef, useState } from 'react'
import { ScryfallApiError, searchCards } from '../api/scryfall'
import type { ScryfallCard } from '../api/scryfallTypes'
import { buildScryfallQuery, type SearchFilters, type SortOrder } from '../utils/scryfallQuery'
import { useDebouncedValue } from './useDebouncedValue'

export type CardSearchStatus = 'idle' | 'loading' | 'error' | 'done'

export type CardSearchResult = {
  results: ScryfallCard[]
  status: CardSearchStatus
  error: string | null
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
}

// Scryfall's `order` param has no "type" sort — its valid values are name, set, released,
// rarity, color, usd, tix, eur, cmc, power, toughness, edhrec, artist, review, penny. A bogus
// order value doesn't error, it silently falls back to the default (name), which is why "type"
// must be handled as a client-side sort over the fetched page(s) instead of a server param.
function scryfallOrderFor(sort: SortOrder | undefined): SortOrder | undefined {
  return sort === 'type' ? undefined : sort
}

function sortByType(cards: ScryfallCard[]): ScryfallCard[] {
  return [...cards].sort((a, b) => a.type_line.localeCompare(b.type_line) || a.name.localeCompare(b.name))
}

export type CardSearchOptions = {
  /** When false the hook stays idle and issues no request. Callers can't express "don't search"
   *  by passing empty text: with a format and a commander's color identity in play,
   *  buildScryfallQuery('', filters) still yields something like `f:commander id<=WUBG`, which
   *  would fire a broad, expensive search. The rules-text fallback in SearchPanel needs a real
   *  off switch — it only runs once the primary name search has come back empty. */
  enabled?: boolean
}

export function useCardSearch(text: string, filters: SearchFilters, options?: CardSearchOptions): CardSearchResult {
  const enabled = options?.enabled ?? true
  const [rawResults, setRawResults] = useState<ScryfallCard[]>([])
  const [status, setStatus] = useState<CardSearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const debouncedText = useDebouncedValue(text, 300)
  const filtersKey = JSON.stringify(filters)

  // Mirrors the active query/page/order outside state so loadMore() can read them without
  // being recreated (and without re-running the search effect) on every render.
  const queryRef = useRef('')
  const pageRef = useRef(1)
  const orderRef = useRef<SortOrder | undefined>(undefined)

  useEffect(() => {
    const query = enabled ? buildScryfallQuery(debouncedText, filters) : ''
    const order = scryfallOrderFor(filters.sort)
    queryRef.current = query
    orderRef.current = order
    pageRef.current = 1
    if (query.length === 0) {
      setRawResults([])
      setStatus('idle')
      setError(null)
      setHasMore(false)
      return
    }

    const controller = new AbortController()
    setStatus('loading')
    setError(null)
    setHasMore(false)

    searchCards(query, 1, order, controller.signal)
      .then((response) => {
        setRawResults(response.data)
        setHasMore(response.has_more)
        setStatus('done')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof ScryfallApiError && err.code === 'not_found') {
          setRawResults([])
          setHasMore(false)
          setStatus('done')
          return
        }
        setError(err instanceof Error ? err.message : 'Search failed')
        setStatus('error')
      })

    return () => controller.abort()
    // filtersKey is a stable serialization of `filters` used intentionally in
    // place of the object reference, which changes every render unless the
    // caller memoizes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedText, filtersKey, enabled])

  function loadMore() {
    if (!hasMore || loadingMore) return
    const query = queryRef.current
    const nextPage = pageRef.current + 1
    setLoadingMore(true)
    searchCards(query, nextPage, orderRef.current)
      .then((response) => {
        pageRef.current = nextPage
        setRawResults((prev) => [...prev, ...response.data])
        setHasMore(response.has_more)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load more cards')
      })
      .finally(() => setLoadingMore(false))
  }

  const results = useMemo(
    () => (filters.sort === 'type' ? sortByType(rawResults) : rawResults),
    [rawResults, filters.sort],
  )

  return { results, status, error, hasMore, loadingMore, loadMore }
}
