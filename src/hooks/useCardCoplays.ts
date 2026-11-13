import { useEffect, useState } from 'react'
import { edhrecSlug, fetchEdhrecCardPage } from '../api/edhrec'
import { parseCardPageCoplays, type Coplay } from '../engine/deckSynergy'
import { getEdhrecCoplaysSnapshots, isEdhrecCoplaysStale, saveEdhrecCoplaysSnapshot } from '../storage/edhrecCoplaysCache'

// Module-level so each card's page is fetched at most once per session, however often it's opened
// — same pattern as useCommanderRecommendations' refreshedSlugs.
const refreshedSlugs = new Set<string>()
// Requests already on their way, shared so reopening a card mid-load doesn't queue it twice.
const inFlight = new Map<string, Promise<Coplay[] | null>>()

function loadCoplays(slug: string, name: string): Promise<Coplay[] | null> {
  let pending = inFlight.get(slug)
  if (!pending) {
    pending = fetchEdhrecCardPage(name)
      .then((payload) => {
        const coplays = parseCardPageCoplays(payload)
        refreshedSlugs.add(slug)
        // Saved whether or not the card is still open, so closing it mid-load loses nothing.
        void saveEdhrecCoplaysSnapshot({ slug, coplays, cachedAt: new Date().toISOString() })
        return coplays
      })
      .finally(() => inFlight.delete(slug))
    inFlight.set(slug, pending)
  }
  return pending
}

export type CardCoplaysState = {
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  coplays: Coplay[]
}

/**
 * The cards EDHREC sees played alongside one card — the right-click panel's "Highest synergy" and
 * "Most played with this card" tabs (ranked by engine/deckSynergy.ts). Cached a week per card in
 * IndexedDB, stale-while-revalidate. Idle, with no request, until `enabled` and named.
 */
export function useCardCoplays(name: string | null, enabled: boolean): CardCoplaysState {
  const [state, setState] = useState<CardCoplaysState>({ status: 'idle', coplays: [] })

  useEffect(() => {
    if (!enabled || !name) {
      setState({ status: 'idle', coplays: [] })
      return
    }
    let cancelled = false
    const slug = edhrecSlug(name)
    setState({ status: 'loading', coplays: [] })
    const show = (coplays: Coplay[] | null) => {
      if (!cancelled) setState(coplays && coplays.length > 0 ? { status: 'ready', coplays } : { status: 'empty', coplays: [] })
    }

    void getEdhrecCoplaysSnapshots([slug]).then(([snapshot]) => {
      if (cancelled) return
      if (snapshot) {
        show(snapshot.coplays)
        if (!isEdhrecCoplaysStale(snapshot) || refreshedSlugs.has(slug)) return
      } else if (refreshedSlugs.has(slug)) {
        show(null) // fetched this session and came back empty
        return
      }
      loadCoplays(slug, name).then(
        (coplays) => show(coplays),
        () => {
          // Offline or a failed request: nothing cached, so the next open retries. A cached list
          // already on screen stays.
          if (!cancelled) setState((prev) => (prev.status === 'loading' ? { status: 'error', coplays: [] } : prev))
        },
      )
    })

    return () => {
      cancelled = true
    }
  }, [name, enabled])

  return state
}
