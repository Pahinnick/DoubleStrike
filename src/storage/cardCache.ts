import { clear, getMany, set, setMany } from 'idb-keyval'
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
  /** The `component: 'token'` OR `'meld_result'` subset of Scryfall's `all_parts` — every card this
   *  card can turn into without being its own separate deck slot: a real token (component: 'token'),
   *  or what it melds into (e.g. Bruna/Gisela → Brisela, Voice of Nightmares — you never own a
   *  literal copy of the meld result, same as a token). Plain combo pieces (e.g. a checklist card)
   *  are still excluded — those genuinely are just other real cards, not a "this doesn't take a deck
   *  slot" reference. Optional/omitted when the card makes none; also absent on snapshots cached
   *  before this field existed, until they're refreshed (like `layout`). */
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
    // Reversible cards (layout "reversible_card" — e.g. the ECL "Steam Vents" or SLD "Dragonlord
    // Atarka") have no top-level cmc/type_line/colors at all; each face is really its own full
    // card, so these only exist per-face. Fall back to the front face's, the same "prefer
    // card_faces[0]" resolution getCastingManaCost already does for mana_cost.
    cmc: card.cmc ?? card.card_faces?.[0]?.cmc ?? 0,
    type_line: card.type_line ?? card.card_faces?.[0]?.type_line ?? '',
    colors: card.colors ?? card.card_faces?.[0]?.colors ?? [],
    color_identity: card.color_identity,
    produced_mana: card.produced_mana,
    image_uris: card.image_uris,
    card_faces: card.card_faces,
    layout: card.layout,
    related_tokens: card.all_parts?.filter((part) => part.component === 'token' || part.component === 'meld_result'),
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

// The "Cache fetched card data locally" setting, applied here rather than at each call site:
// several places save snapshots (adding a card, swapping a printing, importing a deck) and the
// ones that didn't check the setting for themselves kept writing with it switched off.
let persistenceEnabled = true

export function setCardCachePersistence(enabled: boolean): void {
  persistenceEnabled = enabled
}

export async function saveSnapshot(card: ScryfallCard): Promise<void> {
  if (!persistenceEnabled) return
  await set(card.id, toSnapshot(card), cardSnapshotsStore)
}

export async function saveSnapshots(cards: ScryfallCard[]): Promise<void> {
  if (cards.length === 0 || !persistenceEnabled) return
  const entries: [string, CardSnapshot][] = cards.map((card) => [card.id, toSnapshot(card)])
  await setMany(entries, cardSnapshotsStore)
}

/** Wipes every persisted card snapshot — the Settings "Clear cached card data" button. Pair with
 *  api/scryfall.ts's resetInMemoryCardCache() so the in-memory layer doesn't just re-serve what
 *  was just cleared here for the rest of the session. */
export async function clearCardCache(): Promise<void> {
  await clear(cardSnapshotsStore)
}
