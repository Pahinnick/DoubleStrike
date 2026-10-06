import { useEffect, useState } from 'react'
import { getCardsByIdentifiers } from '../api/scryfall'
import { notifyWarning } from '../notifications'
import { getSnapshots, isSnapshotStale, saveSnapshots, toSnapshot, type CardSnapshot } from '../storage/cardCache'
import { useProfileSettings } from './useProfileSettings'

// Module-level so a stale or missing card is only (re-)fetched once per session, even
// though multiple components (DeckPanel, DeckStatsPanel, PlaytestView) call this hook.
const refreshedIds = new Set<string>()

// What this session has fetched, kept in memory. `refreshedIds` means "don't fetch this again",
// which is only safe while the card can still be read back from somewhere: with local caching
// switched off (or the cache just cleared) IndexedDB has nothing, and every change to the id list
// rebuilt the map from IndexedDB alone — so the whole deck list degraded to bare ids.
const sessionSnapshots = new Map<string, CardSnapshot>()

function rememberForSession(cards: Awaited<ReturnType<typeof getCardsByIdentifiers>>): void {
  for (const card of cards) sessionSnapshots.set(card.id, toSnapshot(card))
}

/** Forgets everything fetched this session, so the next lookup goes back to Scryfall. Paired with
 *  the Settings "Clear cached card data" button. */
export function resetCardSnapshotSession(): void {
  refreshedIds.clear()
  sessionSnapshots.clear()
}

// A handful of bounded, increasingly spaced-out retry attempts for ids whose fetch didn't come
// back — covers the "app launched before the network/Wi-Fi was actually ready" and "one
// transient Scryfall blip" cases. Without this, nothing ever retried a failed id unless the
// *set* of requested ids changed content (e.g. a new token entered play) — a card that failed
// its very first fetch could go art-less for the rest of a whole session even though the id was
// technically still eligible for a retry that never got triggered. Not unbounded: once these are
// exhausted, a `navigator.onLine` transition or the id list actually changing is what tries again.
const RETRY_DELAYS_MS = [3000, 10000, 30000]

export function useCardSnapshots(ids: string[]): [Map<string, CardSnapshot>, () => Promise<void>] {
  const { cardCacheEnabled } = useProfileSettings()
  const [snapshots, setSnapshots] = useState<Map<string, CardSnapshot>>(new Map())
  const idsKey = ids.join(',')

  useEffect(() => {
    let cancelled = false
    let missing: string[] = []
    const timers: ReturnType<typeof setTimeout>[] = []

    if (ids.length === 0) {
      setSnapshots(new Map())
      return
    }

    function applyFetched(cards: Awaited<ReturnType<typeof getCardsByIdentifiers>>) {
      rememberForSession(cards)
      if (cards.length === 0 || cancelled) return
      const apply = async () => {
        if (cardCacheEnabled) await saveSnapshots(cards)
        if (cancelled) return
        setSnapshots((prev) => {
          const next = new Map(prev)
          for (const card of cards) next.set(card.id, toSnapshot(card))
          return next
        })
      }
      void apply()
    }

    function scheduleRetry(stillMissing: string[], attempt: number) {
      missing = stillMissing
      if (cancelled || stillMissing.length === 0) return
      if (attempt >= RETRY_DELAYS_MS.length) {
        notifyWarning("Couldn't load some card data from Scryfall — check your connection.")
        return
      }
      timers.push(setTimeout(() => attemptFetch(stillMissing, attempt), RETRY_DELAYS_MS[attempt]))
    }

    // Fetch failures are already caught per-chunk inside getCardsByIdentifiers (a partial batch
    // failure still returns whatever succeeded), so this only ever resolves — never rejects.
    // Only the ids actually present in the result count as "fetched"; anything still missing
    // stays eligible for the next retry instead of being blacklisted for the rest of the session.
    function attemptFetch(idsToFetch: string[], attempt: number) {
      missing = idsToFetch
      void getCardsByIdentifiers(idsToFetch.map((id) => ({ id }))).then((cards) => {
        if (cancelled) return
        const fetchedIds = new Set(cards.map((c) => c.id))
        for (const id of idsToFetch) if (fetchedIds.has(id)) refreshedIds.add(id)
        applyFetched(cards)
        scheduleRetry(
          idsToFetch.filter((id) => !fetchedIds.has(id)),
          attempt + 1,
        )
      })
    }

    function onOnline() {
      // Connectivity just came back — jump straight to a fresh attempt instead of waiting out
      // whatever backoff delay was already scheduled (or re-trying if we'd already given up).
      if (missing.length > 0) attemptFetch(missing, 0)
    }
    window.addEventListener('online', onOnline)

    getSnapshots(ids).then((results) => {
      if (cancelled) return
      const map = new Map<string, CardSnapshot>()
      const idsToFetch: string[] = []
      results.forEach((stored, index) => {
        const id = ids[index]
        const snapshot = stored ?? sessionSnapshots.get(id)
        if (snapshot) {
          map.set(id, snapshot)
          if (isSnapshotStale(snapshot) && !refreshedIds.has(id)) idsToFetch.push(id)
        } else if (!refreshedIds.has(id)) {
          // Never cached locally at all — e.g. an opponent's battlefield/graveyard/exile card
          // in a multiplayer pod that isn't in your own deck, so your client has never seen it
          // before.
          idsToFetch.push(id)
        }
      })
      setSnapshots(map)

      if (idsToFetch.length === 0) return
      attemptFetch(idsToFetch, 0)
    })

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
      window.removeEventListener('online', onOnline)
    }
    // idsKey is a stable serialization of `ids` used intentionally in place
    // of the array reference, which changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, cardCacheEnabled])

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
    rememberForSession(cards)
    if (cardCacheEnabled) await saveSnapshots(cards)
    setSnapshots((prev) => {
      const next = new Map(prev)
      for (const card of cards) next.set(card.id, toSnapshot(card))
      return next
    })
  }

  return [snapshots, refresh]
}
