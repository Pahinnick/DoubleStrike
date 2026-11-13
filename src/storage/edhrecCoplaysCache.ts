import { getMany, set } from 'idb-keyval'
import type { Coplay } from '../engine/deckSynergy'
import { edhrecCoplaysStore } from './db'

// Same week-long freshness as the other EDHREC caches (saltCache.ts, edhrecRecommendationsCache.ts):
// a card's most-played-with lists barely move week to week, and a failed lookup (`null`) heals itself.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** Keyed by EDHREC card slug, so every printing of a card shares one entry. Only the trimmed
 *  Coplay list is kept — a raw card page is ~150 KB, the list is a fraction of that. */
export type EdhrecCoplaysSnapshot = {
  slug: string
  /** null is a real, cached answer ("EDHREC has no page for this card"), not "never fetched". */
  coplays: Coplay[] | null
  cachedAt: string
}

export function isEdhrecCoplaysStale(snapshot: EdhrecCoplaysSnapshot): boolean {
  return Date.now() - new Date(snapshot.cachedAt).getTime() > STALE_AFTER_MS
}

/** Batched: a deck opens 60–100 of these at once. */
export async function getEdhrecCoplaysSnapshots(slugs: string[]): Promise<(EdhrecCoplaysSnapshot | undefined)[]> {
  if (slugs.length === 0) return []
  return getMany<EdhrecCoplaysSnapshot>(slugs, edhrecCoplaysStore)
}

export async function saveEdhrecCoplaysSnapshot(snapshot: EdhrecCoplaysSnapshot): Promise<void> {
  await set(snapshot.slug, snapshot, edhrecCoplaysStore)
}
