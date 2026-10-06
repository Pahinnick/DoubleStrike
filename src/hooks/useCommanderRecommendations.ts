import { useEffect, useState } from 'react'
import { fetchEdhrecCommanderPage } from '../api/edhrec'
import { commanderSlugCandidate, parseCommanderPage, type EdhrecCommanderData } from '../engine/edhrecRecommendations'
import {
  getEdhrecRecommendationsSnapshot,
  isEdhrecRecommendationsStale,
  saveEdhrecRecommendationsSnapshot,
} from '../storage/edhrecRecommendationsCache'

// Module-level so a commander's page is only (re-)fetched once per session, however many times the
// modal is opened and closed — mirrors useCommanderPopularity.ts's refreshedSlugs.
const refreshedSlugs = new Set<string>()

export type CommanderRecommendationsState = {
  status: 'idle' | 'loading' | 'ready' | 'empty'
  data: EdhrecCommanderData | null
}

/**
 * EDHREC's recommended cards for a commander (or partner pair), cached for a week in IndexedDB.
 *
 * Stale-while-revalidate: a cached page renders immediately and any refresh lands behind it.
 * `status: 'empty'` is a real answer — EDHREC has no usable page for this commander — rather than
 * a failure, matching how the other EDHREC hooks treat a 404.
 *
 * Pass an empty `names` array (or call with the modal closed) to stay idle and issue no request.
 */
export function useCommanderRecommendations(names: string[], enabled: boolean): CommanderRecommendationsState {
  const [state, setState] = useState<CommanderRecommendationsState>({ status: 'idle', data: null })
  const namesKey = [...new Set(names)].sort().join('|')

  useEffect(() => {
    let cancelled = false
    const slug = commanderSlugCandidate([...new Set(names)])
    if (!enabled || slug.length === 0) {
      setState({ status: 'idle', data: null })
      return
    }

    setState({ status: 'loading', data: null })

    void getEdhrecRecommendationsSnapshot(slug).then((snapshot) => {
      if (cancelled) return

      if (snapshot) {
        setState({ status: snapshot.data ? 'ready' : 'empty', data: snapshot.data })
        if (!isEdhrecRecommendationsStale(snapshot) || refreshedSlugs.has(slug)) return
      } else if (refreshedSlugs.has(slug)) {
        // Fetched this session and it came back unusable; don't hammer it again on reopen.
        setState({ status: 'empty', data: null })
        return
      }

      // Saved and marked done when the page actually arrives, whether or not this modal is
      // still open to show it. Marking it before the request meant closing the modal mid-load
      // threw the result away and then refused to ask again: every reopen said "no
      // recommendations" until the app restarted.
      void fetchEdhrecCommanderPage(slug).then(
        (payload) => {
          const data = parseCommanderPage(payload)
          refreshedSlugs.add(slug)
          void saveEdhrecRecommendationsSnapshot({ slug, data, cachedAt: new Date().toISOString() })
          if (!cancelled) setState({ status: data ? 'ready' : 'empty', data })
        },
        () => {
          // Offline or the request failed: not an answer, so nothing is cached and the next
          // open tries again. Whatever the cache already showed stays on screen.
          if (!cancelled) setState((prev) => (prev.status === 'loading' ? { status: 'empty', data: null } : prev))
        },
      )
    })

    return () => {
      cancelled = true
    }
    // namesKey is a stable serialization of `names` used intentionally in place of the array
    // reference, which changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, enabled])

  return state
}
