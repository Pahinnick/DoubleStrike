import { getMany, set, setMany } from 'idb-keyval'
import { getCastingManaCost, getDisplayImage } from '../api/scryfall'
import type { CardFace, CardPrices, ImageUris, LegalityStatus, RelatedCard, ScryfallCard } from '../api/scryfallTypes'
import { cardSnapshotsStore } from './db'

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export type CardSnapshot = {
  id: string
  oracle_id: string
  name: string
  mana_cost: string
  cmc: number
  type_line: string
  colors: string[]
  color_identity: string[]
  produced_mana?: string[]
  image_uris?: ImageUris
  card_faces?: CardFace[]
  /** Optional so existing pre-this-field cached snapshots (and hand-built test fixtures) still satisfy the type. */
  layout?: string
  /** The `component: 'token'` subset of Scryfall's `all_parts` — the tokens this card creates. Only
   *  the token parts are kept (not meld/combo pieces). Optional/omitted when the card makes none; also
   *  absent on snapshots cached before this field existed, until they're refreshed (like `layout`). */
  related_tokens?: RelatedCard[]
  legalities: Record<string, LegalityStatus>
  prices?: CardPrices
  cachedAt: string
}

export function toSnapshot(card: ScryfallCard): CardSnapshot {
  return {
    id: card.id,
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: getCastingManaCost(card),
    cmc: card.cmc,
    type_line: card.type_line,
    colors: card.colors ?? [],
    color_identity: card.color_identity,
    produced_mana: card.produced_mana,
    image_uris: card.image_uris,
    card_faces: card.card_faces,
    layout: card.layout,
    related_tokens: card.all_parts?.filter((part) => part.component === 'token'),
    legalities: card.legalities,
    prices: card.prices,
    cachedAt: new Date().toISOString(),
  }
}

export function getSnapshotImage(snapshot: CardSnapshot, face: 'front' | 'back' = 'front'): ImageUris | undefined {
  return getDisplayImage(snapshot, face)
}

// Layouts where the two faces are physically distinct sides of one card (you flip the
// card over to see the other one) — as opposed to split/adventure, where both halves are
// printed on the same face and there's nothing to flip. Only these are offered as a
// "Flip/Transform" action; see PlaytestView.tsx's context menu.
const FLIPPABLE_LAYOUTS = new Set(['transform', 'modal_dfc', 'flip', 'double_faced_token', 'reversible_card'])

export function isFlippableSnapshot(snapshot: CardSnapshot): boolean {
  return (snapshot.card_faces?.length ?? 0) > 1 && !!snapshot.layout && FLIPPABLE_LAYOUTS.has(snapshot.layout)
}

export function isSnapshotStale(snapshot: CardSnapshot): boolean {
  return Date.now() - new Date(snapshot.cachedAt).getTime() > STALE_AFTER_MS
}

export async function getSnapshot(id: string): Promise<CardSnapshot | undefined> {
  const [snapshot] = await getMany<CardSnapshot>([id], cardSnapshotsStore)
  return snapshot
}

export async function getSnapshots(ids: string[]): Promise<(CardSnapshot | undefined)[]> {
  if (ids.length === 0) return []
  return getMany<CardSnapshot>(ids, cardSnapshotsStore)
}

export async function saveSnapshot(card: ScryfallCard): Promise<void> {
  await set(card.id, toSnapshot(card), cardSnapshotsStore)
}

export async function saveSnapshots(cards: ScryfallCard[]): Promise<void> {
  if (cards.length === 0) return
  const entries: [string, CardSnapshot][] = cards.map((card) => [card.id, toSnapshot(card)])
  await setMany(entries, cardSnapshotsStore)
}
