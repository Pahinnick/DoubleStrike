import { getMany, setMany } from 'idb-keyval'
import { saltScoresStore } from './db'

// EDHREC reruns the salt survey annually, so a week-long cache (matching cardCache.ts's
// STALE_AFTER_MS) is nowhere close to stale in practice — it just lets one-off fetch errors
// (`null`) self-heal instead of getting stuck forever.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** Keyed by EDHREC slug (see api/edhrec.ts#edhrecSlug), not scryfallId — salt lives on the
 *  oracle card, so every printing of a card shares one entry. */
export type SaltSnapshot = {
  slug: string
  /** null is a real, cached answer ("EDHREC has no score for this card"), distinct from "never fetched". */
  salt: number | null
  cachedAt: string
}

export function isSaltSnapshotStale(snapshot: SaltSnapshot): boolean {
  return Date.now() - new Date(snapshot.cachedAt).getTime() > STALE_AFTER_MS
}

export async function getSaltSnapshots(slugs: string[]): Promise<(SaltSnapshot | undefined)[]> {
  if (slugs.length === 0) return []
  return getMany<SaltSnapshot>(slugs, saltScoresStore)
}

export async function saveSaltSnapshots(snapshots: SaltSnapshot[]): Promise<void> {
  if (snapshots.length === 0) return
  await setMany(
    snapshots.map((snapshot): [string, SaltSnapshot] => [snapshot.slug, snapshot]),
    saltScoresStore,
  )
}
