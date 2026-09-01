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

/** One pack as it's dealt or passed — `holderSeat` is whoever currently has it, updated as it's
 *  passed around the table. `cards` are Scryfall ids. */
export type DraftPackState = {
  packId: string
  round: number
  cards: string[]
  holderSeat: Seat
}

export type DraftConfig = {
  cubeId: string
  cubeName: string
  packSize: number
  packsPerPlayer: number
}
