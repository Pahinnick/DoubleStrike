import { shuffle } from '../state/gameReducer'
import type { CubeCard, DraftPackState } from './types'
import type { Seat } from '../net/protocol'

export type PackBuilderConfig = {
  packSize: number
  packsPerPlayer: number
  /** The seats actually drafting, in table order — pack i of each round is dealt to seats[i]. Seats
   *  needn't be contiguous (a 3-player room is seats 0, 2, 3). */
  seats: readonly Seat[]
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

export function makePackId(round: number, seat: Seat): string {
  return `r${round}-s${seat}-${Math.random().toString(36).slice(2, 8)}`
}

/** Arranges already-opened packs (one list of card keys per pack, `packsPerPlayer × seats.length`
 *  of them, in deal order) into `[round][seatIndex]`, dealing round r's packs one per seat. Shared
 *  by cube and set drafts — they only differ in how each pack's contents are produced. */
export function dealPacks(packs: string[][], packsPerPlayer: number, seats: readonly Seat[]): DraftPackState[][] {
  const rounds: DraftPackState[][] = []
  for (let round = 0; round < packsPerPlayer; round++) {
    rounds.push(
      seats.map((seat, seatIndex) => ({
        packId: makePackId(round, seat),
        round,
        cards: packs[round * seats.length + seatIndex],
        holderSeat: seat,
      })),
    )
  }
  return rounds
}

/** Minimum cube size for a given table — exported so the lobby can warn before starting. A solo
 *  draft also needs its reserve packs (see buildSoloReserve): packSize-1, packSize-2, … 1 cards
 *  per round on top of the opening pack. */
export function cubeCardsNeeded(config: PackBuilderConfig): number {
  if (config.seats.length === 1) return config.packsPerPlayer * ((config.packSize * (config.packSize + 1)) / 2)
  return config.packsPerPlayer * config.seats.length * config.packSize
}

/** Removes cards at random until `size` remain — the cards other drafters would have taken. */
function trimTo(cards: readonly string[], size: number, random: () => number): string[] {
  const kept = [...cards]
  while (kept.length > size) kept.splice(Math.floor(random() * kept.length), 1)
  return kept
}

/**
 * Solo draft: one lone drafter still makes one pick per card in a pack, like at a full table. After
 * each pick they're handed the next of these packs instead of their own one back — each a fresh
 * pack (from `openPack`) already cut down to one card fewer than the last, standing in for the
 * pack a neighbor would have passed. Returns `[round][k]`, sized to follow each round's opening
 * pack (`rounds[round][0]`): its size minus 1, minus 2, … down to 1.
 */
export function buildSoloReserve(
  rounds: readonly DraftPackState[][],
  openPack: () => string[],
  random: () => number = Math.random,
): DraftPackState[][] {
  return rounds.map((round, roundIndex) => {
    const opening = round[0]
    const reserve: DraftPackState[] = []
    for (let size = opening.cards.length - 1; size >= 1; size--) {
      reserve.push({
        packId: makePackId(roundIndex, opening.holderSeat),
        round: roundIndex,
        cards: trimTo(openPack(), size, random),
        holderSeat: opening.holderSeat,
      })
    }
    return reserve
  })
}

/** Cube solo draft: the opening packs plus their reserve (see buildSoloReserve), all dealt from one
 *  shuffle of the cube so no card appears twice. */
export function buildSoloCubePacks(
  cubeCards: CubeCard[],
  config: Omit<PackBuilderConfig, 'seats'> & { seat: Seat },
  random: () => number = Math.random,
): { rounds: DraftPackState[][]; reserve: DraftPackState[][] } {
  const { packSize, packsPerPlayer, seat } = config
  const needed = cubeCardsNeeded({ packSize, packsPerPlayer, seats: [seat] })
  const expanded = expandCube(cubeCards)
  if (expanded.length < needed) {
    throw new Error(
      `This cube has ${expanded.length} cards, but a solo draft of ${packsPerPlayer} packs × ${packSize} cards needs ${needed} (the packs you're passed come from the cube too). Add more cards or lower the pack size/count.`,
    )
  }
  const shuffled = shuffle(expanded, random)
  let next = 0
  const take = (n: number) => shuffled.slice(next, (next += n))
  const rounds = dealPacks(Array.from({ length: packsPerPlayer }, () => take(packSize)), packsPerPlayer, [seat])
  // Each reserve pack takes exactly as many cards as it ends up holding — nothing is thrown away.
  const reserve = rounds.map((round, roundIndex) =>
    Array.from({ length: packSize - 1 }, (_, k) => ({
      packId: makePackId(roundIndex, seat),
      round: roundIndex,
      cards: take(packSize - 1 - k),
      holderSeat: round[0].holderSeat,
    })),
  )
  return { rounds, reserve }
}

/** Builds the full set of cube packs for a draft: shuffles the cube once, then slices it into
 *  `seats.length * packsPerPlayer` packs of `packSize` cards. Returns `[round][seatIndex]` so
 *  round 1's packs are `packs[0]`. Throws if the cube doesn't have enough cards — a setup-time
 *  error, not something that should surface mid-draft. */
export function buildPacks(cubeCards: CubeCard[], config: PackBuilderConfig, random: () => number = Math.random): DraftPackState[][] {
  const { packSize, packsPerPlayer, seats } = config
  // Just the dealt packs — a solo draft's reserve is built separately (buildSoloCubePacks).
  const needed = packsPerPlayer * seats.length * packSize

  const expanded = expandCube(cubeCards)
  if (expanded.length < needed) {
    throw new Error(
      `This cube has ${expanded.length} cards, but ${needed} are needed for ${seats.length} players × ${packsPerPlayer} packs × ${packSize} cards. Add more cards or lower the pack size/count.`,
    )
  }

  const shuffled = shuffle(expanded, random)
  const packs: string[][] = []
  for (let i = 0; i < packsPerPlayer * seats.length; i++) {
    packs.push(shuffled.slice(i * packSize, (i + 1) * packSize))
  }
  return dealPacks(packs, packsPerPlayer, seats)
}
