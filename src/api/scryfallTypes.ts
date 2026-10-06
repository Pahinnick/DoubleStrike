export type LegalityStatus = 'legal' | 'not_legal' | 'restricted' | 'banned'

export type ImageUris = {
  small: string
  normal: string
  large: string
  png?: string
  art_crop?: string
  border_crop?: string
}

export type CardFace = {
  name: string
  mana_cost: string
  cmc?: number
  type_line?: string
  colors?: string[]
  image_uris?: ImageUris
}

/** An entry in Scryfall's `all_parts` — a card related to this one (its tokens, meld halves, combo
 *  pieces, etc.). `id` is a real, resolvable Scryfall card id. We only care about `'token'` and
 *  `'meld_result'` (see CardSnapshot.related_tokens) — both are cards you're never expected to own
 *  a literal deck-slot copy of. */
export type RelatedCard = {
  object: 'related_card'
  id: string
  component: 'token' | 'meld_part' | 'meld_result' | 'combo_piece'
  name: string
  type_line: string
  uri: string
}

/** Scryfall's per-printing market prices. Each field is a decimal string (e.g. "12.34") or null
 *  when no listing exists for that finish/currency — never a number, per Scryfall's own API. */
export type CardPrices = {
  usd?: string | null
  usd_foil?: string | null
  usd_etched?: string | null
  eur?: string | null
  eur_foil?: string | null
  tix?: string | null
}

export type ScryfallCard = {
  id: string
  oracle_id: string
  name: string
  layout: string
  mana_cost?: string
  cmc: number
  type_line: string
  colors?: string[]
  color_identity: string[]
  produced_mana?: string[]
  image_uris?: ImageUris
  card_faces?: CardFace[]
  legalities: Record<string, LegalityStatus>
  set?: string
  set_name?: string
  collector_number?: string
  released_at?: string
  /** EDHREC popularity rank across all Commander decks — 1 is the single most-played card
   *  (Sol Ring), so LOWER is more popular. Absent for cards EDHREC has no data on (many
   *  Un-set/Alchemy/non-EDH-legal cards), which is a real answer, not a zero. */
  edhrec_rank?: number
  /** Related cards (tokens, meld halves, combo pieces). Present only when the card has any. */
  all_parts?: RelatedCard[]
  prices?: CardPrices
}

export type ScryfallList<T> = {
  object: 'list'
  data: T[]
  has_more: boolean
  next_page?: string
  total_cards?: number
}

export type ScryfallError = {
  object: 'error'
  status: number
  code: string
  details: string
}

/** Response shape for both `/cards/autocomplete` (name suggestions) and `/catalog/*` (e.g.
 *  card-types, creature-types — the full vocabulary of type-line words). */
export type ScryfallCatalog = {
  object: 'catalog'
  data: string[]
}

export type CardIdentifier = { id: string } | { oracle_id: string } | { name: string; set?: string } | { set: string; collector_number: string }

/** Minimal shape needed to open the Similar Cards view — satisfied by both ScryfallCard and CardSnapshot. */
export type TaggableCard = {
  id: string
  oracle_id: string
  name: string
  image_uris?: ImageUris
  card_faces?: CardFace[]
  prices?: CardPrices
}

export type BulkDataInfo = {
  object: 'bulk_data'
  id: string
  type: string
  name: string
  /** Gzipped JSONL (one JSON object per line), NOT a plain JSON array — see fetchOracleTagsRaw.
   *  Scryfall previously exposed a `download_uri` serving uncompressed JSON; that field no longer
   *  exists on any bulk type, which is what silently broke the tag index (fetch(undefined)). */
  jsonl_download_uri: string
  updated_at: string
}
