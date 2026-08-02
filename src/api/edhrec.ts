// EDHREC publishes a "salt score" per card from their annual salt survey — higher means more
// players voted the card unfun to play against. There's no documented public API for it, so this
// hits the same JSON endpoint edhrec.com's own card pages consume.
//
// Salt lives on the *oracle* card, not on a specific printing, so callers should dedupe by card
// name before invoking this. Double-faced cards use the front face's slug (EDHREC drops the back).

const EDHREC_JSON_BASE = 'https://json.edhrec.com/pages/cards'
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
  return front
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
  const slug = edhrecSlug(cardName)
  return scheduleRequest(async () => {
    // EDHREC returns 404 for unknown slugs and 403 for cards it refuses to serve (some Secret
    // Lair crossovers). Neither is retryable — both just mean "no salt score exists."
    const res = await fetch(`${EDHREC_JSON_BASE}/${slug}.json`)
    if (!res.ok) return null
    const body = (await res.json()) as EdhrecPage
    const raw = body.container?.json_dict?.card?.salt
    return typeof raw === 'number' ? raw : null
  })
}
