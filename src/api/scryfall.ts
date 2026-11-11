import type { SortOrder } from '../utils/scryfallQuery'
import type { BulkDataInfo, CardIdentifier, ImageUris, ScryfallCard, ScryfallCatalog, ScryfallError, ScryfallList, ScryfallSet } from './scryfallTypes'

const API_BASE = 'https://api.scryfall.com'
// Scryfall asks integrations to stay under ~10 req/sec; spacing requests by
// 100ms keeps every caller (search, collection batches, etc.) well under that
// without needing per-caller throttling logic.
const MIN_REQUEST_INTERVAL_MS = 100
const COLLECTION_BATCH_SIZE = 75
const QUERY_CACHE_TTL_MS = 10 * 60 * 1000
const QUERY_CACHE_MAX_ENTRIES = 50
const PRINTS_MAX_PAGES = 8

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

/** Every fetched card passes through here (see cacheCards), so this is where Scryfall's one gap in
 *  `type_line` gets filled: reversible cards (e.g. Lorwyn Eclipsed's and Tarkir: Dragonstorm's
 *  reversible shocklands) carry it only on their faces, and code all over the app reads the
 *  top-level field. Same fallback toSnapshot uses. Mutates in place so callers' arrays agree. */
function normalizeCard(card: ScryfallCard): void {
  if (typeof card.type_line !== 'string') card.type_line = card.card_faces?.[0]?.type_line ?? ''
}

function cacheCards(cards: ScryfallCard[]): void {
  for (const card of cards) {
    normalizeCard(card)
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
  // Encoded like every other interpolated value in this module: ids are UUIDs in practice, but
  // this one is reachable from card data that originated off-device, so it shouldn't be the one
  // call site trusted to be URL-safe.
  const card = await scryfallFetch<ScryfallCard>(`${API_BASE}/cards/${encodeURIComponent(id)}`)
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
 * Follows `has_more` up to PRINTS_MAX_PAGES: a results page holds 175 printings, which covers
 * nearly every card in one request, but the basics run to several hundred each.
 */
export async function getCardPrints(oracleId: string, signal?: AbortSignal): Promise<ScryfallCard[]> {
  const cached = printsCache.get(oracleId)
  if (cached && Date.now() - cached.cachedAt < QUERY_CACHE_TTL_MS) {
    return cached.value
  }

  const prints: ScryfallCard[] = []
  let url: string | undefined =
    `${API_BASE}/cards/search?q=${encodeURIComponent(`oracleid:${oracleId}`)}&unique=prints&order=released&dir=desc`
  for (let page = 0; url && page < PRINTS_MAX_PAGES; page++) {
    const result: ScryfallList<ScryfallCard> = await scryfallFetch<ScryfallList<ScryfallCard>>(url, { signal })
    prints.push(...result.data)
    url = result.has_more ? result.next_page : undefined
  }
  cacheCards(prints)
  evictOldestIfFull(printsCache, QUERY_CACHE_MAX_ENTRIES)
  printsCache.set(oracleId, { value: prints, cachedAt: Date.now() })
  return prints
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
  return (await resolveCardsByIdentifiers(identifiers, options)).cards
}

/**
 * Same lookup as getCardsByIdentifiers, but also reports which identifiers were never answered
 * because their batch's request failed (offline, rate-limited). That is a different thing from a
 * card Scryfall looked up and didn't find, and a caller that turns the result into something the
 * user keeps — an imported deck, an export, a drafted pool — has to be able to tell the two apart
 * rather than treat a network failure as "those cards don't exist".
 */
export async function resolveCardsByIdentifiers(
  identifiers: CardIdentifier[],
  options?: { force?: boolean },
): Promise<{ cards: ScryfallCard[]; failed: CardIdentifier[] }> {
  const resolved: ScryfallCard[] = []
  const failed: CardIdentifier[] = []
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
      failed.push(...batch)
    }
  }

  return { cards: resolved, failed }
}

let setsPromise: Promise<ScryfallSet[]> | null = null

/** Every set Scryfall knows about (one request, ~1000 entries), fetched once per session. A failed
 *  request isn't cached, so the next call retries. */
export function getAllSets(): Promise<ScryfallSet[]> {
  if (!setsPromise) {
    setsPromise = scryfallFetch<ScryfallList<ScryfallSet>>(`${API_BASE}/sets`)
      .then((list) => list.data)
      .catch((err: unknown) => {
        setsPromise = null
        throw err
      })
  }
  return setsPromise
}

/** Upper bound on pages for searchAllPrints — a booster pool is ~2-5 pages of 175; this only stops
 *  a runaway query from paging forever. */
const MAX_SEARCH_PAGES = 12

/** Every printing matching `query`, following Scryfall's pagination to the end. Unlike searchCards
 *  (one page, oracle-deduped, for the search panel), this asks for `unique=prints` — a booster is
 *  made of specific printings, and basic lands in particular are all one oracle card. A query that
 *  matches nothing resolves to [] rather than throwing (Scryfall answers 404 for "no cards"). */
export async function searchAllPrints(query: string): Promise<ScryfallCard[]> {
  const cards: ScryfallCard[] = []
  let url: string | undefined = `${API_BASE}/cards/search?q=${encodeURIComponent(query)}&unique=prints`
  for (let page = 0; url && page < MAX_SEARCH_PAGES; page++) {
    let result: ScryfallList<ScryfallCard>
    try {
      result = await scryfallFetch<ScryfallList<ScryfallCard>>(url)
    } catch (err) {
      if (err instanceof ScryfallApiError && err.status === 404) break
      throw err
    }
    cards.push(...result.data)
    url = result.has_more ? result.next_page : undefined
  }
  cacheCards(cards)
  return cards
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
