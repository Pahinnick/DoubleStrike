/**
 * Card data + art for everything on screen during a draft (packs, pools, the post-draft builder).
 *
 * Why draft needs its own hook rather than useCardSnapshots: a pack is full of cards this player
 * has never seen — only the host's machine cached them when the cube/set was loaded. The original
 * draft pack view only ever *read* the local cache, so every guest saw "Loading…" placeholders
 * forever. This hook:
 *   1. reads the local cache first (instant for anything already seen),
 *   2. fetches anything missing from Scryfall right away,
 *   3. re-checks on an interval (ART_CHECK_INTERVAL_MS) for any card that still has no data or no
 *      image — so a card that failed to load during a network blip fixes itself within seconds
 *      instead of staying blank for the rest of the draft,
 *   4. and when an <img> itself fails to load (reportImageError), re-fetches that card's data and
 *      retries the image with a cache-busting query, up to MAX_IMAGE_RETRIES times.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCardsByIdentifiers } from '../api/scryfall'
import type { ImageUris } from '../api/scryfallTypes'
import { getSnapshotImage, getSnapshots, saveSnapshots, toSnapshot, type CardSnapshot } from '../storage/cardCache'
import { useProfileSettings } from './useProfileSettings'

export const ART_CHECK_INTERVAL_MS = 5000
export const MAX_IMAGE_RETRIES = 4

export type DraftCardArt = {
  snapshotFor: (scryfallId: string) => CardSnapshot | undefined
  /** The card's front-face image URL at `size`, or undefined while it's still loading (or once its
   *  image has failed MAX_IMAGE_RETRIES times — render the name instead). */
  imageFor: (scryfallId: string, size: keyof Pick<ImageUris, 'small' | 'normal' | 'large'>) => string | undefined
  /** Wire to an <img>'s onError: schedules a data refetch + image retry for that card. */
  reportImageError: (scryfallId: string) => void
  /** How many requested cards still have no usable art — for a small "loading N cards" hint. */
  missingCount: number
}

/** Appends a retry marker so the browser doesn't just serve the same failed response from cache. */
export function withRetryParam(url: string, attempt: number): string {
  if (attempt <= 0) return url
  return `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`
}

export function useDraftCardArt(scryfallIds: readonly string[]): DraftCardArt {
  const { cardCacheEnabled } = useProfileSettings()
  const [snapshots, setSnapshots] = useState<Map<string, CardSnapshot>>(new Map())
  const snapshotsRef = useRef(snapshots)
  snapshotsRef.current = snapshots
  // Image retry bookkeeping: how many times each card's image has failed, and which cards have
  // failed since the last check (their data gets force-refetched — the image URL may have moved).
  const imageAttemptsRef = useRef<Map<string, number>>(new Map())
  const brokenRef = useRef<Set<string>>(new Set())
  const [, setImageVersion] = useState(0)
  const checkingRef = useRef(false)
  const cacheReadRef = useRef<Set<string>>(new Set())

  const idsKey = [...new Set(scryfallIds)].sort().join(',')
  const idsRef = useRef<string[]>([])
  idsRef.current = idsKey ? idsKey.split(',') : []

  const check = useCallback(async () => {
    if (checkingRef.current) return
    const ids = idsRef.current
    if (ids.length === 0) return
    checkingRef.current = true
    try {
      // Step 1: anything we haven't looked for locally yet — read the on-disk cache first.
      const unread = ids.filter((id) => !snapshotsRef.current.has(id) && !cacheReadRef.current.has(id))
      if (unread.length > 0) {
        for (const id of unread) cacheReadRef.current.add(id)
        const cached = await getSnapshots(unread)
        const found = cached.filter((s): s is CardSnapshot => s !== undefined && getSnapshotImage(s) !== undefined)
        if (found.length > 0) {
          setSnapshots((prev) => {
            const next = new Map(prev)
            for (const snapshot of found) next.set(snapshot.id, snapshot)
            snapshotsRef.current = next
            return next
          })
        }
      }

      // Step 2: anything still without usable art, or whose image just failed, comes from Scryfall.
      const broken = new Set(brokenRef.current)
      const needed = ids.filter((id) => {
        if (broken.has(id)) return true
        const snapshot = snapshotsRef.current.get(id)
        return !snapshot || getSnapshotImage(snapshot) === undefined
      })
      if (needed.length === 0) return
      const cards = await getCardsByIdentifiers(
        needed.map((id) => ({ id })),
        { force: needed.some((id) => broken.has(id)) },
      )
      for (const id of broken) brokenRef.current.delete(id)
      if (cards.length > 0) {
        if (cardCacheEnabled) void saveSnapshots(cards)
        setSnapshots((prev) => {
          const next = new Map(prev)
          for (const card of cards) next.set(card.id, toSnapshot(card))
          snapshotsRef.current = next
          return next
        })
      }
      // Bumped even when the data came back identical, so a retried <img> picks up its new
      // cache-busting URL and actually tries the network again.
      if (broken.size > 0) setImageVersion((v) => v + 1)
    } finally {
      checkingRef.current = false
    }
  }, [cardCacheEnabled])

  // Immediately whenever the set of cards changes (a new pack arrives), then periodically.
  useEffect(() => {
    void check()
  }, [idsKey, check])

  useEffect(() => {
    const timer = window.setInterval(() => void check(), ART_CHECK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [check])

  const reportImageError = useCallback(
    (scryfallId: string) => {
      const attempts = (imageAttemptsRef.current.get(scryfallId) ?? 0) + 1
      imageAttemptsRef.current.set(scryfallId, attempts)
      if (attempts > MAX_IMAGE_RETRIES) {
        setImageVersion((v) => v + 1) // fall back to the name tile
        return
      }
      brokenRef.current.add(scryfallId)
      // Spread retries out a little (1s, 2s, 3s…) rather than hammering a failing image host.
      window.setTimeout(() => void check(), attempts * 1000)
    },
    [check],
  )

  const snapshotFor = useCallback((scryfallId: string) => snapshots.get(scryfallId), [snapshots])

  const imageFor = useCallback(
    (scryfallId: string, size: 'small' | 'normal' | 'large') => {
      const snapshot = snapshots.get(scryfallId)
      const image = snapshot ? getSnapshotImage(snapshot) : undefined
      if (!image) return undefined
      const attempts = imageAttemptsRef.current.get(scryfallId) ?? 0
      if (attempts > MAX_IMAGE_RETRIES) return undefined
      return withRetryParam(image[size] ?? image.small, attempts)
    },
    [snapshots],
  )

  const missingCount = idsRef.current.filter((id) => imageFor(id, 'small') === undefined).length

  return { snapshotFor, imageFor, reportImageError, missingCount }
}
