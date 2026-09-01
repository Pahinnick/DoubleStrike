import { getMany, setMany } from 'idb-keyval'
import { commanderPopularityStore } from './db'

// EDHREC's deck counts creep up gradually as new decklists get submitted — a week-long cache
// (matching saltCache.ts) is nowhere close to stale in practice, it just lets a one-off fetch
// error (`null`) self-heal instead of getting stuck forever.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** Keyed by EDHREC slug (see api/edhrec.ts#edhrecSlug), not scryfallId — this lives on the oracle
 *  card, so every printing of a commander shares one entry. */
export type CommanderPopularitySnapshot = {
  slug: string
  /** null is a real, cached answer ("EDHREC has no commander page for this card"), distinct from "never fetched". */
  numDecks: number | null
  cachedAt: string
}

export function isCommanderPopularityStale(snapshot: CommanderPopularitySnapshot): boolean {
  return Date.now() - new Date(snapshot.cachedAt).getTime() > STALE_AFTER_MS
}

export async function getCommanderPopularitySnapshots(slugs: string[]): Promise<(CommanderPopularitySnapshot | undefined)[]> {
  if (slugs.length === 0) return []
  return getMany<CommanderPopularitySnapshot>(slugs, commanderPopularityStore)
}

export async function saveCommanderPopularitySnapshots(snapshots: CommanderPopularitySnapshot[]): Promise<void> {
  if (snapshots.length === 0) return
  await setMany(
    snapshots.map((snapshot): [string, CommanderPopularitySnapshot] => [snapshot.slug, snapshot]),
    commanderPopularityStore,
  )
}
