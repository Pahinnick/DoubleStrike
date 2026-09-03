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

      refreshedSlugs.add(slug)
      void fetchEdhrecCommanderPage(slug).then((payload) => {
        if (cancelled) return
        const data = parseCommanderPage(payload)
        void saveEdhrecRecommendationsSnapshot({ slug, data, cachedAt: new Date().toISOString() })
        setState({ status: data ? 'ready' : 'empty', data })
      })
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
