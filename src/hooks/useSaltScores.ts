import { useEffect, useState } from 'react'
import { edhrecSlug, fetchEdhrecSalt } from '../api/edhrec'
import { getSaltSnapshots, isSaltSnapshotStale, saveSaltSnapshots, type SaltSnapshot } from '../storage/saltCache'

// Module-level so a slug is only (re-)fetched once per session, even though multiple components
// (DeckPanel, DeckStatsPanel, SimilarCardsView) can call this hook for overlapping cards.
const refreshedSlugs = new Set<string>()

// Requests currently in the air, by slug. DeckPanel and DeckStatsPanel both ask for the same
// deck's scores at the same moment; the second one joins the first one's request here instead of
// being told "already handled" and left with an empty map.
const inFlight = new Map<string, Promise<number | null>>()

/**
 * Fetches one card's salt score, saving it and marking the slug done only once the answer is
 * actually in. Marking it up front (as this used to) meant a request that was abandoned midway —
 * the deck changed while a 100-card batch was loading — or that failed outright left the slug
 * blacklisted for the rest of the session with nothing saved.
 *
 * Never rejects: a failed request resolves to undefined ("still unknown"), distinct from null
 * ("EDHREC has no score").
 */
function loadSalt(name: string, slug: string): Promise<number | null | undefined> {
  let request = inFlight.get(slug)
  if (!request) {
    request = fetchEdhrecSalt(name)
      .then((salt) => {
        refreshedSlugs.add(slug)
        void saveSaltSnapshots([{ slug, salt, cachedAt: new Date().toISOString() }])
        return salt
      })
      .finally(() => inFlight.delete(slug))
    inFlight.set(slug, request)
  }
  return request.catch(() => undefined)
}

/** EDHREC salt score per card name (see api/edhrec.ts). Keyed by name, not scryfallId — salt
 *  lives on the oracle card, so every printing shares one score. A missing map entry means "not
 *  loaded yet"; a `null` value means "EDHREC has no score for this card" (a real answer). */
export function useSaltScores(names: string[]): [Map<string, number | null>, () => Promise<void>] {
  const [scores, setScores] = useState<Map<string, number | null>>(new Map())
  const namesKey = [...new Set(names)].sort().join('|')

  useEffect(() => {
    let cancelled = false
    const uniqueNames = [...new Set(names)]
    if (uniqueNames.length === 0) {
      setScores(new Map())
      return
    }

    const slugByName = new Map(uniqueNames.map((name) => [name, edhrecSlug(name)]))

    getSaltSnapshots(uniqueNames.map((name) => slugByName.get(name)!)).then((results) => {
      if (cancelled) return
      const map = new Map<string, number | null>()
      const namesToFetch: string[] = []
      results.forEach((snapshot, index) => {
        const name = uniqueNames[index]
        const slug = slugByName.get(name)!
        if (snapshot) {
          map.set(name, snapshot.salt)
          if (isSaltSnapshotStale(snapshot) && !refreshedSlugs.has(slug)) namesToFetch.push(name)
        } else if (!refreshedSlugs.has(slug)) {
          namesToFetch.push(name)
        }
      })
      setScores(map)

      if (namesToFetch.length === 0) return

      void Promise.all(namesToFetch.map(async (name) => ({ name, salt: await loadSalt(name, slugByName.get(name)!) }))).then(
        (fetched) => {
          if (cancelled) return
          setScores((prev) => {
            const next = new Map(prev)
            for (const { name, salt } of fetched) if (salt !== undefined) next.set(name, salt)
            return next
          })
        },
      )
    })

    return () => {
      cancelled = true
    }
    // namesKey is a stable serialization of `names` used intentionally in place of the array
    // reference, which changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey])

  /** Unconditionally re-fetches every name from EDHREC, bypassing the staleness gate — for an
   *  explicit user-triggered "refresh card data" action. fetchEdhrecSalt has no in-memory cache
   *  of its own (unlike Scryfall's), so there's nothing else to bypass here. Deliberately a plain
   *  function (recreated each render, not memoized) so it always closes over the current `names`. */
  async function refresh() {
    const uniqueNames = [...new Set(names)]
    if (uniqueNames.length === 0) return
    const fetched = await Promise.all(
      uniqueNames.map(async (name) => ({ name, slug: edhrecSlug(name), salt: await fetchEdhrecSalt(name) })),
    )
    const snapshots: SaltSnapshot[] = fetched.map(({ slug, salt }) => ({ slug, salt, cachedAt: new Date().toISOString() }))
    await saveSaltSnapshots(snapshots)
    setScores((prev) => {
      const next = new Map(prev)
      for (const { name, salt } of fetched) next.set(name, salt)
      return next
    })
  }

  return [scores, refresh]
}
