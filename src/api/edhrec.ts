// EDHREC publishes a "salt score" per card from their annual salt survey — higher means more
// players voted the card unfun to play against. There's no documented public API for it, so this
// hits the same JSON endpoint edhrec.com's own card pages consume.
//
// Salt lives on the *oracle* card, not on a specific printing, so callers should dedupe by card
// name before invoking this. Double-faced cards use the front face's slug (EDHREC drops the back).

const EDHREC_JSON_BASE = 'https://json.edhrec.com/pages/cards'
const EDHREC_COMMANDER_JSON_BASE = 'https://json.edhrec.com/pages/commanders'
// EDHREC re-runs the salt survey annually, so there's no etiquette doc to follow like Scryfall's —
// this spacing just keeps a full deck's worth of lookups (~100 cards) from firing as one burst.
const MIN_REQUEST_INTERVAL_MS = 150

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
  requestQueue = scheduled.then(
    () => undefined,
    () => undefined,
  )
  return scheduled
}

export function edhrecSlug(cardName: string): string {
  // Double-faced cards come through as "Front // Back"; EDHREC only indexes the front.
  const front = cardName.split(' // ')[0]
  // Apostrophes (straight + curly) are elided, not hyphenated — EDHREC slugs "Umezawa's Jitte"
  // as `umezawas-jitte`, not `umezawa-s-jitte`.
  // Accented letters are transliterated, not dropped: EDHREC slugs "Éomer, King of Rohan" as
  // `eomer-king-of-rohan` and "Lim-Dûl's Vault" as `lim-duls-vault`. Decomposing first splits
  // each into its base letter plus a combining mark, which is then stripped.
  return front
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

type EdhrecPage = {
  container?: {
    json_dict?: {
      card?: {
        salt?: number
      }
    }
  }
}

/** Raw network fetch only, rate-limited — no persistence. See storage/saltCache.ts +
 *  hooks/useSaltScores.ts for the cached layer components should actually use. */
export async function fetchEdhrecSalt(cardName: string): Promise<number | null> {
  // EDHREC returns 404 for unknown slugs and 403 for cards it refuses to serve (some Secret
  // Lair crossovers). Neither is retryable — both just mean "no salt score exists."
  const body = (await fetchEdhrecPage(EDHREC_JSON_BASE, edhrecSlug(cardName))) as EdhrecPage | null
  const raw = body?.container?.json_dict?.card?.salt
  return typeof raw === 'number' ? raw : null
}

/** A card's whole EDHREC page — its co-played card lists are what engine/deckSynergy.ts ranks.
 *  Raw network fetch only, on the shared rate-limited queue; null for a card EDHREC has no page
 *  for. See storage/edhrecCoplaysCache.ts + hooks/useDeckSynergy.ts for the cached layer. */
export async function fetchEdhrecCardPage(cardName: string): Promise<unknown | null> {
  return fetchEdhrecPage(EDHREC_JSON_BASE, edhrecSlug(cardName))
}

type EdhrecCommanderPage = {
  container?: {
    json_dict?: {
      card?: {
        num_decks?: number
      }
    }
  }
}

/**
 * EDHREC's "Top Commanders (Past Year)" page — 100 commanders with their deck counts in a single
 * request, in the same `cardlists` shape as a commander page (so engine/edhrecRecommendations.ts
 * parses it with parseCommanderPage).
 *
 * This exists because the per-commander endpoint costs one request each: ranking a 175-card
 * commander search that way takes minutes of serialized fetches. One request covers the
 * commanders anyone browsing is realistically choosing between.
 */
export async function fetchEdhrecTopCommanders(page = 1): Promise<unknown | null> {
  // Page 1 is `year.json`; subsequent pages are `year-2.json`, `year-3.json`, … Verified to run at
  // least 30 pages deep with 100 commanders each and counts descending monotonically, so this
  // reaches well past the point anyone is still browsing rather than searching.
  const slug = page <= 1 ? 'year' : `year-${page}`
  return scheduleRequest(async () => {
    const res = await fetch(`${EDHREC_COMMANDER_JSON_BASE}/${slug}.json`)
    if (!res.ok) return null
    return (await res.json()) as unknown
  })
}

/** A partner pair's page lives under one canonical slug ordering. Asking for the other ordering
 *  returns `{"redirect": "/commanders/<canonical>"}` instead of page data, so one hop is enough —
 *  the cap is only there so a server-side redirect loop can't hang the request queue. */
const MAX_COMMANDER_REDIRECTS = 2

function readRedirectSlug(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const redirect = (body as { redirect?: unknown }).redirect
  if (typeof redirect !== 'string' || redirect.length === 0) return null
  const slug = redirect.split('/').filter(Boolean).pop()
  return slug ?? null
}

/**
 * The raw commander page JSON — the same payload `fetchEdhrecCommanderDecks` reads one field
 * from, returned whole so engine/edhrecRecommendations.ts can parse the recommendation lists out
 * of it. Follows EDHREC's own `redirect` response rather than trying to guess the canonical slug
 * ordering for partners, Backgrounds and the like.
 *
 * Raw network fetch only, rate-limited on the shared queue — no persistence. See
 * storage/edhrecRecommendationsCache.ts + hooks/useCommanderRecommendations.ts for the cached
 * layer components should actually use.
 */
export async function fetchEdhrecCommanderPage(slug: string): Promise<unknown | null> {
  return fetchEdhrecPage(EDHREC_COMMANDER_JSON_BASE, slug)
}

/** One page of EDHREC JSON, following its `redirect` responses. Card pages redirect too, not just
 *  partner pairs: a split card's front-half slug (`fire`) answers 200 with
 *  `{"redirect": "/cards/fire-ice"}` rather than page data. */
async function fetchEdhrecPage(base: string, slug: string): Promise<unknown | null> {
  let currentSlug = slug
  const seen = new Set<string>()

  for (let hop = 0; hop <= MAX_COMMANDER_REDIRECTS; hop += 1) {
    if (seen.has(currentSlug)) return null
    seen.add(currentSlug)
    const requestedSlug = currentSlug
    const body = await scheduleRequest(async () => {
      // Same contract as the other two fetchers: 404/403 means "no such commander page", which is
      // a real answer rather than a retryable failure.
      const res = await fetch(`${base}/${requestedSlug}.json`)
      if (!res.ok) return null
      return (await res.json()) as unknown
    })
    if (body === null) return null
    const redirect = readRedirectSlug(body)
    if (redirect === null) return body
    currentSlug = redirect
  }

  return null
}

/** How many decks on EDHREC have this card as their commander — separate from (and always ≤) the
 *  plain card page's `num_decks`, which counts every deck the card appears in at all. Raw network
 *  fetch only, rate-limited, shares the same request queue as fetchEdhrecSalt — no persistence.
 *  See storage/commanderPopularityCache.ts + hooks/useCommanderPopularity.ts for the cached layer
 *  components should actually use. */
export async function fetchEdhrecCommanderDecks(cardName: string): Promise<number | null> {
  // Cards that have never been anyone's commander 403 here (EDHREC only serves genuine
  // commander pages under this path) — not retryable, just means "not a commander."
  const body = (await fetchEdhrecPage(EDHREC_COMMANDER_JSON_BASE, edhrecSlug(cardName))) as EdhrecCommanderPage | null
  const raw = body?.container?.json_dict?.card?.num_decks
  return typeof raw === 'number' ? raw : null
}
