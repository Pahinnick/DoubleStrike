import { shuffle } from '../state/gameReducer'
import type { CubeCard, DraftPackState } from './types'
import type { Seat } from '../net/protocol'

export type PackBuilderConfig = {
  packSize: number
  packsPerPlayer: number
  playerCount: number
}

/** Expands `quantity` into individual card instances — a cube can run duplicates of staples,
 *  unlike a singleton deck. */
function expandCube(cubeCards: CubeCard[]): string[] {
  const expanded: string[] = []
  for (const card of cubeCards) {
    for (let i = 0; i < card.quantity; i++) expanded.push(card.scryfallId)
  }
  return expanded
}

/** Builds the full set of packs for a draft: shuffles the cube once, then slices it into
 *  `playerCount * packsPerPlayer` packs of `packSize` cards. Returns `[round][seatIndex]` so
 *  round 1's packs are `packs[0]`, dealt one per seat in seat order. Throws if the cube doesn't
 *  have enough cards — a setup-time error, not something that should surface mid-draft. */
export function buildPacks(cubeCards: CubeCard[], config: PackBuilderConfig, random: () => number = Math.random): DraftPackState[][] {
  const { packSize, packsPerPlayer, playerCount } = config
  const totalPacks = packsPerPlayer * playerCount
  const needed = totalPacks * packSize

  const expanded = expandCube(cubeCards)
  if (expanded.length < needed) {
    throw new Error(
      `This cube has ${expanded.length} cards, but ${needed} are needed for ${playerCount} players × ${packsPerPlayer} packs × ${packSize} cards. Add more cards or lower the pack size/count.`,
    )
  }

  const shuffled = shuffle(expanded, random)
  const rounds: DraftPackState[][] = []
  let cursor = 0
  for (let round = 0; round < packsPerPlayer; round++) {
    const roundPacks: DraftPackState[] = []
    for (let seat = 0; seat < playerCount; seat++) {
      const cards = shuffled.slice(cursor, cursor + packSize)
      cursor += packSize
      roundPacks.push({
        packId: `r${round}-s${seat}-${Math.random().toString(36).slice(2, 8)}`,
        round,
        cards,
        holderSeat: seat as Seat,
      })
    }
    rounds.push(roundPacks)
  }
  return rounds
}
