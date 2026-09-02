import type { Format } from '../utils/scryfallQuery'

export type Board = 'mainboard' | 'sideboard'

/** Cosmetic holographic shader applied to this card's art wherever it renders (deck list,
 *  battlefield, hand, hover preview) — purely visual, no gameplay effect. See components/shared/FoilShine. */
export type FoilKind = 'classic' | 'rainbow' | 'surge'

export type DeckCard = {
  scryfallId: string
  quantity: number
  board: Board
  category?: string
  // Commander doesn't get its own board — it's just a flagged card sitting in
  // the mainboard, same as Archidekt/Moxfield treat it.
  isCommander?: boolean
  /** A token the deck's cards can create, imported for reference alongside the real decklist.
   *  Sits on the mainboard (so it's visible without switching boards) but is excluded from deck
   *  size/singleton/color-identity legality checks, mana curve, and every export format — it was
   *  never a real, ownable card in the 100. See engine/deckTokens.ts. */
  isToken?: boolean
  /** Player-chosen color-coded flag (e.g. "already drawn", "key combo piece"), shown as a small
   *  chip in the deck list and the Playtest deck-scan tray — see components/shared/CardMarkChip.
   *  A free-form hex/CSS color string, not tied to Magic's mana colors. Persists with the deck
   *  (survives between playtest sessions) until manually cleared — user's explicit choice. */
  mark?: string
  /** Holographic shader style, if any — set via the "Choose art" panel's Foil row. Persists with
   *  the deck like `mark`, and survives a printing swap (SET_PRINTING only touches scryfallId). */
  foil?: FoilKind
}

export type ManaBaseOverride = {
  sourceCounts: Record<string, number>
  totalLands: number
}

export type Deck = {
  id: string
  name: string
  format?: Format
  cards: DeckCard[]
  categories: string[]
  manaBaseOverride?: ManaBaseOverride
  /** Target confidence (0-1) for the Mana Base panel's "Total lands" recommendation — the Mana
   *  Base panel's slider. Undefined means the engine's own default (see
   *  engine/manaRecommendation.ts's DEFAULT_LAND_DROP_CONFIDENCE), not "0% confidence". */
  landDropConfidence?: number
  createdAt: string
  updatedAt: string
}

export type DeckSummary = {
  id: string
  name: string
  format?: Format
  cardCount: number
  updatedAt: string
  /** scryfallIds of every card flagged `isCommander`, in deck order — 0 for non-commander formats,
   *  usually 1, or 2 for a partners/background pairing. Used by the deck manager list to show
   *  commander art without loading the full deck. */
  commanderIds: string[]
}

/** Per-profile app preferences (Settings page). Every field optional so older persisted
 *  profiles (saved before a given field existed) still satisfy the type — readers apply their
 *  own default, see hooks/useProfileSettings.ts. Kept structurally primitive (no imports from
 *  hooks/) so this file stays free of any hook-layer dependency. */
export type ProfileSettings = {
  /** One of hooks/useTheme's Theme ids — kept as a bare string here for that reason, validated
   *  back to Theme by the reader. */
  theme?: string
  /** 'alt' gates the shared card hover-preview popup behind holding Alt (so it doesn't fight
   *  Alt+scroll's existing "resize the preview" gesture); 'always' (default) shows it on every
   *  plain hover, matching the app's original behavior. */
  hoverPreviewMode?: 'always' | 'alt'
  /** Multiplier (0-1) on the base volume of Playtest's synthesized UI sound cues (draw, tap,
   *  shuffle, etc.) — 0 is fully muted. Independent of TableRadio's own volume slider. */
  soundVolume?: number
  /** Whether a fresh Playtest session starts with the goldfish practice panel already showing,
   *  instead of requiring the "Show Goldfish Stats" button every time. */
  goldfishStatsDefault?: boolean
  /** Which side of the hand fan a freshly-drawn card lands on (Draw button, the automatic
   *  once-per-turn draw) — 'left' (default) matches the app's original, only-ever behavior. */
  handDrawSide?: 'left' | 'right'
  /** Whether fetched card data (name/mana cost/image URIs/etc., see storage/cardCache.ts) gets
   *  persisted to the local IndexedDB cache — true (default) matches the app's original, always-on
   *  behavior. Turning it off still fetches and displays cards normally for the current session;
   *  it just skips writing them to disk, so nothing carries over to the next launch. */
  cardCacheEnabled?: boolean
}

export type Profile = {
  id: string
  name: string
  createdAt: string
  settings?: ProfileSettings
}

export type AppData = {
  profiles: Profile[]
  defaultProfileId: string | null
  lastActiveProfileId: string | null
  /** Profile ids explicitly deleted by the user. Their on-disk deck data is intentionally left in
   *  place (see `deleteProfile`), so the storage layer's orphan-recovery scan needs this list to
   *  avoid resurrecting a profile someone deliberately removed. Optional so pre-existing AppData
   *  (saved before this field existed) still satisfies the type. */
  deletedProfileIds?: string[]
}
