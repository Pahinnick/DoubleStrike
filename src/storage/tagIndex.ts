import { get, set } from 'idb-keyval'
import { getBulkDataInfo } from '../api/scryfall'
import { tagIndexStore } from './db'

const TAG_INDEX_KEY = 'oracle-tag-index'
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000

export type TagRef = { slug: string; weight: string }

export type TagIndexData = {
  builtAt: string
  /** oracle_id -> tags on that card */
  cardTags: Record<string, TagRef[]>
  /** tag slug -> oracle_ids of cards with that tag */
  tagCards: Record<string, string[]>
  /** tag slug -> human-readable label, e.g. "removal" -> "Removal" */
  tagLabels: Record<string, string>
}

/** Shape of one entry in Scryfall's Oracle Tags bulk data file. */
export type RawOracleTag = {
  object: 'tag'
  slug: string
  label: string
  type: string
  taggings: { oracle_id: string; weight: string }[]
}

/** Builds the two-directional index from the raw bulk tag objects. Pure and independently testable. */
export function buildTagIndex(rawTags: RawOracleTag[]): TagIndexData {
  const cardTags: Record<string, TagRef[]> = {}
  const tagCards: Record<string, string[]> = {}
  const tagLabels: Record<string, string> = {}

  for (const tag of rawTags) {
    if (tag.type !== 'oracle') continue
    tagLabels[tag.slug] = tag.label
    const oracleIds: string[] = []

    for (const tagging of tag.taggings) {
      oracleIds.push(tagging.oracle_id)
      const existing = cardTags[tagging.oracle_id]
      const ref: TagRef = { slug: tag.slug, weight: tagging.weight }
      if (existing) existing.push(ref)
      else cardTags[tagging.oracle_id] = [ref]
    }

    tagCards[tag.slug] = oracleIds
  }

  return { builtAt: new Date().toISOString(), cardTags, tagCards, tagLabels }
}

export function isTagIndexStale(index: TagIndexData): boolean {
  return Date.now() - new Date(index.builtAt).getTime() > STALE_AFTER_MS
}

export async function getCachedTagIndex(): Promise<TagIndexData | undefined> {
  return get<TagIndexData>(TAG_INDEX_KEY, tagIndexStore)
}

async function saveTagIndex(index: TagIndexData): Promise<void> {
  await set(TAG_INDEX_KEY, index, tagIndexStore)
}

/**
 * Downloads Scryfall's Oracle Tags bulk data file directly from its CDN
 * (data.scryfall.io) rather than through the rate-limited api.scryfall.com
 * queue — bulk files are served from unmetered storage and aren't subject
 * to the same request-rate etiquette as the JSON API. Only one
 * api.scryfall.com call is made first, to discover the current download URL.
 *
 * The file is gzipped JSONL — one JSON tag object per line, ~5.9MB over the wire
 * and ~17.5MB decompressed (about 4.5k tags). Two things about that need handling
 * explicitly rather than falling out of `response.json()`:
 *
 *  - It's served as `Content-Type: application/gzip` with NO `Content-Encoding`
 *    header, so the browser treats gzip as the payload rather than as transport
 *    encoding and hands back compressed bytes. We decompress ourselves.
 *  - JSONL is not valid JSON as a whole document, so it's parsed per line.
 *
 * Streamed rather than buffered into one string, since the decompressed file is
 * large enough that an intermediate 17.5MB string is worth avoiding.
 */
async function fetchOracleTagsRaw(): Promise<RawOracleTag[]> {
  const bulkInfo = await getBulkDataInfo('oracle_tags')
  const response = await fetch(bulkInfo.jsonl_download_uri)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Oracle Tags bulk data: ${response.status}`)
  }

  const reader = response.body
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream())
    .getReader()

  const tags: RawOracleTag[] = []
  // Chunk boundaries fall mid-line, so the trailing fragment of each chunk is held
  // back and prepended to the next one instead of being parsed as a whole line.
  let pending = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = (pending + value).split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (line) tags.push(JSON.parse(line))
    }
  }
  // Final line, if the file didn't end on a newline.
  if (pending.trim()) tags.push(JSON.parse(pending))

  return tags
}

let inFlightLoad: Promise<TagIndexData> | undefined

/**
 * Returns a ready-to-use tag index, using the IndexedDB cache when it exists
 * and isn't stale, otherwise downloading and rebuilding it (~18MB, a few
 * seconds). Concurrent callers share a single in-flight fetch.
 */
export async function loadOrBuildTagIndex(): Promise<TagIndexData> {
  const cached = await getCachedTagIndex()
  if (cached && !isTagIndexStale(cached)) return cached

  if (!inFlightLoad) {
    inFlightLoad = (async () => {
      try {
        const rawTags = await fetchOracleTagsRaw()
        const index = buildTagIndex(rawTags)
        await saveTagIndex(index)
        return index
      } finally {
        inFlightLoad = undefined
      }
    })()
  }
  return inFlightLoad
}
