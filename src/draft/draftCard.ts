/**
 * A card inside a draft pack or pool is identified by a plain string "key" rather than an object,
 * so the engine, the wire messages and the pick bookkeeping can all keep treating cards as opaque
 * strings. A key is just the Scryfall id, with a suffix when that copy was opened foil (a real
 * booster's foil slot) — so the foil travels with the card from pack, to pool, to the built deck.
 */
const FOIL_SUFFIX = '~foil'

export type DraftCard = { scryfallId: string; foil: boolean }

export function draftCardKey(scryfallId: string, foil = false): string {
  return foil ? `${scryfallId}${FOIL_SUFFIX}` : scryfallId
}

export function parseDraftCardKey(key: string): DraftCard {
  if (key.endsWith(FOIL_SUFFIX)) return { scryfallId: key.slice(0, -FOIL_SUFFIX.length), foil: true }
  return { scryfallId: key, foil: false }
}

/** The distinct Scryfall ids behind a list of draft card keys — what art/snapshot lookups need. */
export function scryfallIdsOf(keys: readonly string[]): string[] {
  return [...new Set(keys.map((key) => parseDraftCardKey(key).scryfallId))]
}
