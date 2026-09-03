import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchEdhrecTopCommanders } from '../api/edhrec'
import {
  parseCommanderPage,
  topCommanderDeckCounts,
  topCommandersRanked,
  type EdhrecCardRec,
} from '../engine/edhrecRecommendations'
import {
  getEdhrecRecommendationsSnapshot,
  isEdhrecRecommendationsStale,
  saveEdhrecRecommendationsSnapshot,
} from '../storage/edhrecRecommendationsCache'

/** EDHREC serves the top-commanders list 100 at a time; a short page means we've reached the end. */
const PAGE_SIZE = 100

/** Reserved keys in the recommendations store — not real commander slugs, and EDHREC has no
 *  commander whose slug could collide with them. */
const pageKey = (page: number) => `__top-commanders-year-${page}__`

// Module-level so a stale page is refreshed at most once per session, however often the browser is
// opened and closed — mirrors the refreshedSlugs pattern used by the other EDHREC hooks.
const refreshedPages = new Set<number>()

// Concurrent callers for the same page share one request, the way loadOrBuildTagIndex does. This
// is what makes StrictMode's double-invoked effect safe: both runs await the same promise and get
// the same data, rather than the second being turned away empty-handed by the refresh guard.
const inFlight = new Map<number, Promise<EdhrecCardRec[]>>()

async function fetchTopCommanderPage(page: number): Promise<EdhrecCardRec[]> {
  const snapshot = await getEdhrecRecommendationsSnapshot(pageKey(page))
  const cached = snapshot?.data ? topCommandersRanked(snapshot.data) : null
  if (cached && (!isEdhrecRecommendationsStale(snapshot!) || refreshedPages.has(page))) return cached

  refreshedPages.add(page)
  const data = parseCommanderPage(await fetchEdhrecTopCommanders(page))
  void saveEdhrecRecommendationsSnapshot({ slug: pageKey(page), data, cachedAt: new Date().toISOString() })
  // A failed refresh falls back to whatever was cached rather than blanking the list.
  return data ? topCommandersRanked(data) : (cached ?? [])
}

/** Cache-then-network for one page. Returns [] for a page EDHREC has nothing for, which the caller
 *  reads as "no more pages". */
function loadTopCommanderPage(page: number): Promise<EdhrecCardRec[]> {
  const existing = inFlight.get(page)
  if (existing) return existing
  const request = fetchTopCommanderPage(page).finally(() => inFlight.delete(page))
  inFlight.set(page, request)
  return request
}

export type TopCommanders = {
  /** Most-commanded first, across every page loaded so far. */
  ranked: EdhrecCardRec[]
  /** Deck counts keyed by lowercased card name, for annotating cards from elsewhere. */
  countsByName: Map<string, number>
  hasMore: boolean
  loading: boolean
  loadMore: () => void
}

/**
 * EDHREC's most-commanded cards, 100 per page, cached for a week.
 *
 * The count is decks *commanded by* the card, matching what the per-commander page reports (spot
 * checked: Krenko 43,650, Atraxa 44,044, Edgar Markov 50,203 on both). It is NOT the card page's
 * `num_decks`, which counts every deck the card appears in — for Krenko that's 95,395, and for
 * Atraxa it's *lower* at 20,562, since only four-colour decks can play it but anyone can command it.
 *
 * `ranked` exists because sorting is not enough on its own: the commander browser used to page
 * through Scryfall's `is:commander order=edhrec`, which ranks by *card* popularity, and the top 175
 * of those miss Atraxa (286th) and Edgar Markov (424th) entirely — the #1 commander by deck count
 * is barely played as a 99 card. No amount of re-sorting a page can surface a card that isn't on it,
 * so browsing is driven from this list directly.
 */
export function useTopCommanders(enabled: boolean): TopCommanders {
  const [ranked, setRanked] = useState<EdhrecCardRec[]>([])
  const [wantedPages, setWantedPages] = useState(1)
  const [loadedPages, setLoadedPages] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || loadedPages >= wantedPages) return
    const page = loadedPages + 1
    let cancelled = false
    setLoading(true)

    void loadTopCommanderPage(page)
      .then((pageRecs) => {
        if (cancelled) return
        setRanked((prev) => {
          // Dedupe by name: EDHREC pages don't overlap in practice, but a list that silently
          // doubled an entry would also double it in the rendered grid.
          const seen = new Set(prev.map((rec) => rec.name))
          return [...prev, ...pageRecs.filter((rec) => !seen.has(rec.name))]
        })
        setLoadedPages(page)
        setHasMore(pageRecs.length >= PAGE_SIZE)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        // Leave loadedPages where it is so a retry re-attempts the same page rather than skipping it.
        setHasMore(false)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [enabled, wantedPages, loadedPages])

  const countsByName = useMemo(() => topCommanderDeckCounts(ranked), [ranked])
  const loadMore = useCallback(() => setWantedPages((pages) => pages + 1), [])

  return { ranked, countsByName, hasMore, loading, loadMore }
}
