import { useEffect, useState } from 'react'
import { edhrecSlug, fetchEdhrecCommanderDecks } from '../api/edhrec'
import {
  getCommanderPopularitySnapshots,
  isCommanderPopularityStale,
  saveCommanderPopularitySnapshots,
  type CommanderPopularitySnapshot,
} from '../storage/commanderPopularityCache'

// Module-level so a slug is only (re-)fetched once per session, even if multiple components end
// up asking about overlapping commanders — mirrors useSaltScores.ts's refreshedSlugs.
const refreshedSlugs = new Set<string>()

/** EDHREC's "decks with this commander" count per card name (see api/edhrec.ts). Keyed by name,
 *  not scryfallId — the count lives on the oracle card, so every printing shares one. A missing
 *  map entry means "not loaded yet"; a `null` value means "EDHREC has no commander page for this
 *  card" (a real answer — most cards have never been anyone's commander). */
export function useCommanderPopularity(names: string[]): Map<string, number | null> {
  const [counts, setCounts] = useState<Map<string, number | null>>(new Map())
  const namesKey = [...new Set(names)].sort().join('|')

  useEffect(() => {
    let cancelled = false
    const uniqueNames = [...new Set(names)]
    if (uniqueNames.length === 0) {
      setCounts(new Map())
      return
    }

    const slugByName = new Map(uniqueNames.map((name) => [name, edhrecSlug(name)]))

    getCommanderPopularitySnapshots(uniqueNames.map((name) => slugByName.get(name)!)).then((results) => {
      if (cancelled) return
      const map = new Map<string, number | null>()
      const namesToFetch: string[] = []
      results.forEach((snapshot, index) => {
        const name = uniqueNames[index]
        const slug = slugByName.get(name)!
        if (snapshot) {
          map.set(name, snapshot.numDecks)
          if (isCommanderPopularityStale(snapshot) && !refreshedSlugs.has(slug)) namesToFetch.push(name)
        } else if (!refreshedSlugs.has(slug)) {
          namesToFetch.push(name)
        }
      })
      setCounts(map)

      if (namesToFetch.length === 0) return
      namesToFetch.forEach((name) => refreshedSlugs.add(slugByName.get(name)!))

      void Promise.all(
        namesToFetch.map(async (name) => ({ name, slug: slugByName.get(name)!, numDecks: await fetchEdhrecCommanderDecks(name) })),
      ).then((fetched) => {
        if (cancelled) return
        const snapshots: CommanderPopularitySnapshot[] = fetched.map(({ slug, numDecks }) => ({
          slug,
          numDecks,
          cachedAt: new Date().toISOString(),
        }))
        void saveCommanderPopularitySnapshots(snapshots)
        setCounts((prev) => {
          const next = new Map(prev)
          for (const { name, numDecks } of fetched) next.set(name, numDecks)
          return next
        })
      })
    })

    return () => {
      cancelled = true
    }
    // namesKey is a stable serialization of `names` used intentionally in place of the array
    // reference, which changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey])

  return counts
}
