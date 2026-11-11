/**
 * What the host picks on behalf of a player who has dropped out of the draft (see
 * useDraftSession's away/auto-pick handling) — so one lost connection doesn't stall every other
 * seat's packs. Deliberately simple and predictable, like a real draft's "auto-pick when your
 * timer runs out": the highest-rarity card, nudged toward the colors that player has already
 * been taking, and never a basic land while anything else is left.
 */
import type { ScryfallCard } from '../api/scryfallTypes'
import { parseDraftCardKey } from './draftCard'

/** Just the parts of a card auto-pick looks at — small enough to keep for a whole set/cube. */
export type AutoPickCardInfo = { rarity?: string; colors: string[]; isBasicLand: boolean }

export type AutoPickInfo = Readonly<Record<string, AutoPickCardInfo>>

const RARITY_SCORE: Readonly<Record<string, number>> = {
  mythic: 4,
  special: 3,
  bonus: 3,
  rare: 3,
  uncommon: 2,
  common: 1,
}

/** Builds the lookup auto-pick uses from whatever full cards the host already loaded. */
export function toAutoPickInfo(cards: readonly ScryfallCard[]): Record<string, AutoPickCardInfo> {
  const info: Record<string, AutoPickCardInfo> = {}
  for (const card of cards) {
    const colors = card.colors ?? card.card_faces?.[0]?.colors ?? card.color_identity ?? []
    const typeLine = card.type_line ?? ''
    info[card.id] = { rarity: card.rarity, colors, isBasicLand: typeLine.includes('Basic') && typeLine.includes('Land') }
  }
  return info
}

/** The two colors this pool leans into most (fewer if it's barely started). */
export function mainColors(pool: readonly string[], info: AutoPickInfo): string[] {
  const counts = new Map<string, number>()
  for (const key of pool) {
    for (const color of info[parseDraftCardKey(key).scryfallId]?.colors ?? []) counts.set(color, (counts.get(color) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([color]) => color)
}

function score(key: string, colors: readonly string[], info: AutoPickInfo): number {
  const card = info[parseDraftCardKey(key).scryfallId]
  if (!card) return 0
  if (card.isBasicLand) return -100
  const rarity = (RARITY_SCORE[card.rarity ?? ''] ?? 0) * 10
  if (colors.length === 0) return rarity
  // On-color cards (or colorless ones, which fit any deck) beat off-color ones of the same rarity.
  const offColor = card.colors.filter((c) => !colors.includes(c)).length
  const fit = card.colors.length === 0 ? 2 : offColor === 0 ? 4 : -2 * offColor
  return rarity + fit
}

/** The card key to take from `pack` for a player whose picks so far are `pool`. Cards the host
 *  has no info for count as unknown-rarity, and ties keep the pack's own order — so with no info
 *  at all this is simply the pack's first card. Returns null only for an empty pack. */
export function chooseAutoPick(pack: readonly string[], pool: readonly string[], info: AutoPickInfo): string | null {
  const colors = mainColors(pool, info)
  let best: string | null = null
  let bestScore = -Infinity
  for (const key of pack) {
    const s = score(key, colors, info)
    if (s > bestScore) {
      best = key
      bestScore = s
    }
  }
  return best
}
