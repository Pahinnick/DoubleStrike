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
  createdAt: string
  updatedAt: string
}

export type DeckSummary = {
  id: string
  name: string
  format?: Format
  cardCount: number
  updatedAt: string
}

export type Profile = {
  id: string
  name: string
  createdAt: string
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
