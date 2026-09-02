import type { SortOrder } from '../utils/scryfallQuery'
import type { BulkDataInfo, CardIdentifier, ImageUris, ScryfallCard, ScryfallCatalog, ScryfallError, ScryfallList } from './scryfallTypes'

const API_BASE = 'https://api.scryfall.com'
// Scryfall asks integrations to stay under ~10 req/sec; spacing requests by
// 100ms keeps every caller (search, collection batches, etc.) well under that
// without needing per-caller throttling logic.
const MIN_REQUEST_INTERVAL_MS = 100
const COLLECTION_BATCH_SIZE = 75
const QUERY_CACHE_TTL_MS = 10 * 60 * 1000
const QUERY_CACHE_MAX_ENTRIES = 50

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let lastRequestStartedAt = 0
let requestQueue: Promise<void> = Promise.resolve()

function scheduleRequest<T>(fn: () => Promise<T>): Promise<T> {
  const scheduled = requestQueue.then(async () => {
    const wait = Math.max(0, lastRequestStartedAt + MIN_REQUEST_INTERVAL_MS - Date.now())
    if (wait > 0) await sleep(wait)
    lastRequestStartedAt = Date.now()
    return fn()
  })
  // Keep the queue alive even if this request fails, but don't let the
  // rejection propagate through the chain to unrelated callers.
  requestQueue = scheduled.then(
    () => undefined,
    () => undefined,
  )
  return scheduled
}

export class ScryfallApiError extends Error {
  code: string
  status: number

  constructor(details: ScryfallError) {
    super(details.details)
    this.name = 'ScryfallApiError'
    this.code = details.code
    this.status = details.status
  }
}

async function scryfallFetch<T>(url: string, init?: RequestInit): Promise<T> {
  return scheduleRequest(async () => {
    const response = await fetch(url, init)
    const body = await response.json()
    if (!response.ok) {
      throw new ScryfallApiError(body as ScryfallError)
    }
    return body as T
  })
}

type CachedEntry<T> = { value: T; cachedAt: number }

const searchCache = new Map<string, CachedEntry<ScryfallList<ScryfallCard>>>()
const printsCache = new Map<string, CachedEntry<ScryfallCard[]>>()
const cardCache = new Map<string, ScryfallCard>()

function cacheCards(cards: ScryfallCard[]): void {
  for (const card of cards) {
    cardCache.set(card.id, card)
  }
}

function evictOldestIfFull(cache: Map<string, unknown>, maxEntries: number): void {
  if (cache.size < maxEntries) return
  const oldestKey = cache.keys().next().value
  if (oldestKey !== undefined) cache.delete(oldestKey)
}

export function getCachedCard(id: string): ScryfallCard | undefined {
  return cardCache.get(id)
}

/** Clears every in-memory Scryfall cache (single-card lookups, search results, print lists).
 *  Paired with storage/cardCache.ts's clearCardCache() (the persisted IndexedDB side) for the
 *  Settings "Clear cached card data" button — without this, a just-cleared IndexedDB entry would
 *  immediately get re-served from here for the rest of the session instead of actually refetching. */
export function resetInMemoryCardCache(): void {
  cardCache.clear()
  searchCache.clear()
  printsCache.clear()
}

/**
 * Resolves a full ScryfallCard by printing id, serving the in-memory cache when a prior search/
 * lookup already populated it, otherwise a single rate-limited `GET /cards/:id`. Needed because
 * the trimmed-down `CardSnapshot` this app persists to IndexedDB (see storage/cardCache.ts)
 * deliberately drops `set`/`collector_number` — fine for rendering, but not enough to link out to
 * the card's Scryfall page (see PlaytestView's "Look up rulings" context menu action).
 */
export async function getCardById(id: string): Promise<ScryfallCard> {
  const cached = getCachedCard(id)
  if (cached) return cached
  const card = await scryfallFetch<ScryfallCard>(`${API_BASE}/cards/${id}`)
  cacheCards([card])
  return card
}

export async function searchCards(
  query: string,
  page = 1,
  order?: SortOrder,
  signal?: AbortSignal,
): Promise<ScryfallList<ScryfallCard>> {
  const cacheKey = `${query}|${page}|${order ?? ''}`
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < QUERY_CACHE_TTL_MS) {
    return cached.value
  }

  const orderParam = order ? `&order=${order}` : ''
  const url = `${API_BASE}/cards/search?q=${encodeURIComponent(query)}&page=${page}${orderParam}`
  const result = await scryfallFetch<ScryfallList<ScryfallCard>>(url, { signal })
  cacheCards(result.data)
  evictOldestIfFull(searchCache, QUERY_CACHE_MAX_ENTRIES)
  searchCache.set(cacheKey, { value: result, cachedAt: Date.now() })
  return result
}

/** Card-name suggestions for the search box's autocomplete dropdown — thin wrapper around
 *  Scryfall's own `/cards/autocomplete`, which does the prefix matching server-side. */
export async function autocompleteCardNames(query: string, signal?: AbortSignal): Promise<string[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const result = await scryfallFetch<ScryfallCatalog>(`${API_BASE}/cards/autocomplete?q=${encodeURIComponent(trimmed)}`, { signal })
  return result.data
}

// Every catalog that can contribute a word to a type-line clause: the high-level card types,
// the supertypes (Legendary, Snow, etc.), and every card type's own subtype list. Fetched once
// per session and merged into one flat, deduped vocabulary for the type-line autocomplete.
const TYPE_CATALOGS = [
  'card-types',
  'supertypes',
  'creature-types',
  'planeswalker-types',
  'land-types',
  'artifact-types',
  'enchantment-types',
  'spell-types',
] as const

let typeWordsPromise: Promise<string[]> | null = null

/** The full vocabulary of type-line words (Creature, Legendary, Human, Equipment, ...), merged
 *  from every relevant Scryfall catalog and cached for the life of the page — this list changes
 *  only when new sets add new subtypes, so a session-long cache (rather than the TTL'd caches
 *  above) is the right lifetime. Resets on failure so a dropped request doesn't wedge every
 *  future caller into a permanently-rejected promise. */
export function getTypeWords(): Promise<string[]> {
  if (!typeWordsPromise) {
    typeWordsPromise = Promise.all(TYPE_CATALOGS.map((catalog) => scryfallFetch<ScryfallCatalog>(`${API_BASE}/catalog/${catalog}`)))
      .then((catalogs) => {
        const words = new Set<string>()
        for (const catalog of catalogs) {
          for (const word of catalog.data) words.add(word)
        }
        return [...words].sort((a, b) => a.localeCompare(b))
      })
      .catch((err: unknown) => {
        typeWordsPromise = null
        throw err
      })
  }
  return typeWordsPromise
}

/**
 * Every printing of a card, newest first — the "unique=prints" search mode combined with the
 * `oracleid:` filter is Scryfall's documented way to list all prints sharing one Oracle card.
 * Only the first results page (up to 175) is fetched; even the most-reprinted staples don't come
 * close to that count, so a second page is never worth the extra round trip.
 */
export async function getCardPrints(oracleId: string, signal?: AbortSignal): Promise<ScryfallCard[]> {
  const cached = printsCache.get(oracleId)
  if (cached && Date.now() - cached.cachedAt < QUERY_CACHE_TTL_MS) {
    return cached.value
  }

  const url = `${API_BASE}/cards/search?q=${encodeURIComponent(`oracleid:${oracleId}`)}&unique=prints&order=released&dir=desc`
  const result = await scryfallFetch<ScryfallList<ScryfallCard>>(url, { signal })
  cacheCards(result.data)
  evictOldestIfFull(printsCache, QUERY_CACHE_MAX_ENTRIES)
  printsCache.set(oracleId, { value: result.data, cachedAt: Date.now() })
  return result.data
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Bulk-resolves cards by id, used to re-fetch a saved deck's cards.
 * Already-cached cards are served without a network call, unless `force` is set (a genuine
 * "refresh from Scryfall" request — e.g. a card whose price/legality looked stale — needs to
 * bypass this in-memory cache too, not just the IndexedDB-level staleness check in
 * hooks/useCardSnapshots.ts, or a card touched earlier this session would just come back unchanged).
 */
export async function getCardsByIdentifiers(identifiers: CardIdentifier[], options?: { force?: boolean }): Promise<ScryfallCard[]> {
  const resolved: ScryfallCard[] = []
  const toFetch: CardIdentifier[] = []

  for (const identifier of identifiers) {
    const cached = !options?.force && 'id' in identifier ? cardCache.get(identifier.id) : undefined
    if (cached) {
      resolved.push(cached)
    } else {
      toFetch.push(identifier)
    }
  }

  // Each chunk is caught independently: a large pod/deck can span several 75-card batches, and
  // one batch failing (a rate-limit blip, a dropped connection) used to reject the whole call,
  // throwing away every other batch's results even though they'd already succeeded. Callers
  // (e.g. hooks/useCardSnapshots.ts) now get back whatever did resolve instead of nothing.
  for (const batch of chunk(toFetch, COLLECTION_BATCH_SIZE)) {
    try {
      const result = await scryfallFetch<ScryfallList<ScryfallCard> & { not_found: CardIdentifier[] }>(
        `${API_BASE}/cards/collection`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: batch }),
        },
      )
      cacheCards(result.data)
      resolved.push(...result.data)
    } catch {
      // Leave this batch's cards out of `resolved` — the caller sees a partial result and can
      // decide to retry just the still-missing ids, rather than the whole request failing.
    }
  }

  return resolved
}

/**
 * Looks up metadata (incl. the current download URL) for a Scryfall bulk
 * data file, e.g. type "oracle_tags". This is a small, rate-limited
 * api.scryfall.com call — the actual bulk file download happens separately,
 * directly against data.scryfall.io, since that CDN isn't subject to the
 * same request-rate etiquette as the JSON API.
 */
export async function getBulkDataInfo(type: string): Promise<BulkDataInfo> {
  return scryfallFetch<BulkDataInfo>(`${API_BASE}/bulk-data/${type}`)
}

/** Returns the mana cost string to parse for casting purposes, resolving DFC front faces. */
export function getCastingManaCost(card: ScryfallCard): string {
  // Split/adventure/flip/transform cards expose a per-face mana_cost on
  // card_faces[0]. Their top-level mana_cost is a combined display string
  // (e.g. "{1}{R} // {1}{U}" for a split card) that is NOT a single parseable
  // cost, so card_faces must take priority whenever present.
  const frontFaceCost = card.card_faces?.[0]?.mana_cost
  if (frontFaceCost && frontFaceCost.length > 0) return frontFaceCost
  return card.mana_cost ?? ''
}

export type ImageBearing = { image_uris?: ImageUris; card_faces?: { image_uris?: ImageUris }[] }

/** Returns the image to display for a card, preferring the front face for DFCs. Works for any card-shaped snapshot. */
export function getDisplayImage(card: ImageBearing, face: 'front' | 'back' = 'front'): ImageUris | undefined {
  if (card.image_uris) return card.image_uris
  if (!card.card_faces || card.card_faces.length === 0) return undefined
  const index = face === 'back' ? Math.min(1, card.card_faces.length - 1) : 0
  return card.card_faces[index]?.image_uris
}
