import { useEffect, useState } from 'react'
import { getCardsByIdentifiers } from '../api/scryfall'
import { getSnapshots, isSnapshotStale, saveSnapshots, toSnapshot, type CardSnapshot } from '../storage/cardCache'

// Module-level so a stale or missing card is only (re-)fetched once per session, even
// though multiple components (DeckPanel, DeckStatsPanel, PlaytestView) call this hook.
const refreshedIds = new Set<string>()

export function useCardSnapshots(ids: string[]): [Map<string, CardSnapshot>, () => Promise<void>] {
  const [snapshots, setSnapshots] = useState<Map<string, CardSnapshot>>(new Map())
  const idsKey = ids.join(',')

  useEffect(() => {
    let cancelled = false
    if (ids.length === 0) {
      setSnapshots(new Map())
      return
    }

    getSnapshots(ids).then((results) => {
      if (cancelled) return
      const map = new Map<string, CardSnapshot>()
      const idsToFetch: string[] = []
      results.forEach((snapshot, index) => {
        const id = ids[index]
        if (snapshot) {
          map.set(id, snapshot)
          if (isSnapshotStale(snapshot) && !refreshedIds.has(id)) idsToFetch.push(id)
        } else if (!refreshedIds.has(id)) {
          // Never cached locally at all — e.g. an opponent's battlefield/graveyard/exile card
          // in a multiplayer pod that isn't in your own deck, so your client has never seen it
          // before. Previously this was silently dropped forever (never fetched, never
          // retried), rendering as a placeholder showing the raw scryfallId instead of art.
          idsToFetch.push(id)
        }
      })
      setSnapshots(map)

      if (idsToFetch.length === 0) return

      // Fetch stale refreshes and never-cached ids together. Silently update the cache and
      // re-render only if the fetch succeeds. `refreshedIds` is only populated on success
      // (below) — marking it upfront meant a single transient failure (network blip, a
      // momentary Scryfall rate-limit) permanently blacklisted that id from ever being
      // fetched again this session, since nothing here ever retried it. That's how an
      // opponent's card could end up with no art for the rest of a multiplayer game.
      void getCardsByIdentifiers(idsToFetch.map((id) => ({ id }))).then(
        async (cards) => {
          if (cancelled) return
          idsToFetch.forEach((id) => refreshedIds.add(id))
          if (cards.length === 0) return
          await saveSnapshots(cards)
          if (cancelled) return
          setSnapshots((prev) => {
            const next = new Map(prev)
            // Unconditional set: unlike the old stale-only refresh, a never-cached id has no
            // existing entry to gate on — every id here was explicitly requested in idsToFetch.
            for (const card of cards) {
              next.set(card.id, toSnapshot(card))
            }
            return next
          })
        },
        () => {
          // Fetch failed outright (network error, rate limit, etc.) — leave `refreshedIds`
          // untouched so the next render's staleness/never-cached check retries these ids
          // instead of giving up on them for the rest of the session.
        },
      )
    })

    return () => {
      cancelled = true
    }
    // idsKey is a stable serialization of `ids` used intentionally in place
    // of the array reference, which changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  /** Unconditionally re-fetches every id from Scryfall, bypassing both the 7-day staleness gate
   *  and the in-memory `cardCache` in api/scryfall.ts (a card touched earlier this session would
   *  otherwise come back unchanged) — for an explicit user-triggered "refresh card data" action,
   *  as opposed to the passive staleness-driven refresh above. Deliberately a plain function
   *  (recreated each render, not memoized) so it always closes over the current `ids`. */
  async function refresh() {
    if (ids.length === 0) return
    const cards = await getCardsByIdentifiers(
      ids.map((id) => ({ id })),
      { force: true },
    )
    if (cards.length === 0) return
    await saveSnapshots(cards)
    setSnapshots((prev) => {
      const next = new Map(prev)
      for (const card of cards) next.set(card.id, toSnapshot(card))
      return next
    })
  }

  return [snapshots, refresh]
}
