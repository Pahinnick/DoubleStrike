import type { Seat } from '../net/protocol'

/** One card in a cube, by count — a cube intentionally allows duplicates of staples, unlike a
 *  singleton Commander deck. */
export type CubeCard = { scryfallId: string; quantity: number }

export type Cube = {
  id: string
  name: string
  cards: CubeCard[]
  createdAt: string
  updatedAt: string
}

export type CubeSummary = { id: string; name: string; cardCount: number; updatedAt: string }

/** Which physical booster a set's packs imitate — see draft/boosters.ts for each one's slot layout.
 *  - `play`: Play Boosters (Murders at Karlov Manor, Feb 2024, onward) — 14 cards.
 *  - `draft`: Draft Boosters (Shards of Alara, Oct 2008, through 2023) — 15 cards incl. a basic land.
 *  - `classic`: pre-mythic boosters (before Shards of Alara) — 15 cards, no mythics, no land slot. */
export type BoosterType = 'play' | 'draft' | 'classic'

/** Where a draft's packs come from. A cube is shuffled and split evenly; a set opens real-style
 *  boosters slot by slot (rarities, land slot, foils, bonus sheets). */
export type DraftSource =
  | { kind: 'cube'; cubeId: string; name: string }
  | { kind: 'set'; setCode: string; name: string; boosterType: BoosterType }

/** One pack as it's dealt or passed — `holderSeat` is whoever currently has it, updated as it's
 *  passed around the table. `cards` are draft card keys (see draft/draftCard.ts): a Scryfall id,
 *  optionally marked foil. */
export type DraftPackState = {
  packId: string
  round: number
  cards: string[]
  holderSeat: Seat
}

export type DraftConfig = {
  source: DraftSource
  /** Cards per pack. Fixed by the booster type for a set draft; host-chosen for a cube. */
  packSize: number
  packsPerPlayer: number
}
