import { get, set } from 'idb-keyval'
import type { EdhrecCommanderData } from '../engine/edhrecRecommendations'
import { edhrecRecommendationsStore } from './db'

// EDHREC recomputes these lists as new decklists come in, but the top of a commander's list barely
// moves week to week — a week-long cache (matching commanderPopularityCache.ts and saltCache.ts)
// costs nothing in freshness and lets a one-off fetch failure (`null`) self-heal instead of
// getting stuck forever.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** Keyed by EDHREC commander slug — for a partner pair that's the joined canonical slug, so a pod
 *  of partners shares one entry the same way every printing of a commander does. */
export type EdhrecRecommendationsSnapshot = {
  slug: string
  /** null is a real, cached answer ("EDHREC has no usable page for this commander"), distinct from
   *  "never fetched". */
  data: EdhrecCommanderData | null
  cachedAt: string
}

export function isEdhrecRecommendationsStale(snapshot: EdhrecRecommendationsSnapshot): boolean {
  return Date.now() - new Date(snapshot.cachedAt).getTime() > STALE_AFTER_MS
}

/** Single-slug get/save rather than the batched getMany/setMany the popularity cache uses: only one
 *  commander (or partner pair) is ever open at a time, and each payload is far larger than a deck
 *  count, so there's nothing to batch. */
export async function getEdhrecRecommendationsSnapshot(slug: string): Promise<EdhrecRecommendationsSnapshot | undefined> {
  if (slug.length === 0) return undefined
  return get<EdhrecRecommendationsSnapshot>(slug, edhrecRecommendationsStore)
}

export async function saveEdhrecRecommendationsSnapshot(snapshot: EdhrecRecommendationsSnapshot): Promise<void> {
  await set(snapshot.slug, snapshot, edhrecRecommendationsStore)
}
