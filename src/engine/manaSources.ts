import type { Color } from '../utils/colors'

export type LandSource = { quantity: number; colors: Color[] }

export type ManaBase = {
  totalLands: number
  lands: LandSource[]
  // True only when `lands` is a genuine non-overlapping partition of the deck's
  // real lands (i.e. every land counted in exactly one entry) — safe input for
  // castability's exact joint-probability model. A manual override's per-color
  // counts are marginals with unknown overlap (e.g. one 5-color rock counts
  // toward all five), so treating them as disjoint categories there would make
  // the categories sum to more than totalLands and break the hypergeometric math.
  exact: boolean
}

export type DeckLandInput = { quantity: number; producedMana: Color[] }

function mergeByColorSet(entries: DeckLandInput[]): LandSource[] {
  const merged = new Map<string, LandSource>()
  for (const entry of entries) {
    const colors = [...new Set(entry.producedMana)].sort() as Color[]
    const key = colors.join('')
    const existing = merged.get(key)
    if (existing) {
      existing.quantity += entry.quantity
    } else {
      merged.set(key, { quantity: entry.quantity, colors })
    }
  }
  return [...merged.values()]
}

/** Builds a ManaBase from the deck's land cards, merging lands with identical produced-color sets. */
export function deriveManaBase(deckLands: DeckLandInput[]): ManaBase {
  const totalLands = deckLands.reduce((sum, l) => sum + l.quantity, 0)
  return { totalLands, lands: mergeByColorSet(deckLands), exact: true }
}

/**
 * Ramp sources (mana rocks/dorks) merged the same way lands are. Scryfall gives nonland
 * permanents with a mana ability the same `produced_mana` field lands use, so any card with a
 * non-empty entry here (Sol Ring, Elvish Mystic, etc.) can tap for mana just like a land can.
 * Doesn't catch land-tutoring ramp (Nature's Lore, Rampant Growth, etc.) — those fetch a land
 * onto the battlefield rather than tapping for mana themselves, so Scryfall gives them no
 * produced_mana of their own.
 */
export function deriveRampSources(rampCards: DeckLandInput[]): LandSource[] {
  return mergeByColorSet(rampCards.filter((c) => c.producedMana.length > 0))
}

/**
 * Folds ramp sources into a manaBase for calculation purposes (Avg Turn, mana-base
 * recommendations) without changing what's shown as "Total lands" in the Mana Base UI. Each
 * ramp card is a real, disjoint card from the deck's lands, so appending it doesn't break the
 * "exact" partition invariant when the base manaBase was already exact.
 */
export function withRampSources(base: ManaBase, ramp: LandSource[]): ManaBase {
  if (ramp.length === 0) return base
  const rampTotal = ramp.reduce((sum, r) => sum + r.quantity, 0)
  return { totalLands: base.totalLands + rampTotal, lands: [...base.lands, ...ramp], exact: base.exact }
}

/** Count of lands that can produce a given color, regardless of what else they produce. */
export function sourceCountForColor(manaBase: ManaBase, color: Color): number {
  return manaBase.lands.filter((l) => l.colors.includes(color)).reduce((sum, l) => sum + l.quantity, 0)
}

/** Per-color source counts for display (e.g. in ManaBaseControls). */
export function sourceCountsByColor(manaBase: ManaBase, colors: readonly Color[]): Partial<Record<Color, number>> {
  const counts: Partial<Record<Color, number>> = {}
  for (const color of colors) counts[color] = sourceCountForColor(manaBase, color)
  return counts
}

/**
 * Builds a ManaBase from manually-entered per-color source counts (no
 * overlap data available, e.g. a user override). Assumes no land produces
 * more than one of the specified colors — the simplest faithful reading of
 * manually entered counts.
 */
export function manaBaseFromOverride(totalLands: number, sourceCounts: Partial<Record<Color, number>>): ManaBase {
  const lands: LandSource[] = []
  let coloredTotal = 0
  for (const [color, count] of Object.entries(sourceCounts) as [Color, number | undefined][]) {
    if (count && count > 0) {
      lands.push({ quantity: count, colors: [color] })
      coloredTotal += count
    }
  }
  const otherLands = Math.max(0, totalLands - coloredTotal)
  if (otherLands > 0) lands.push({ quantity: otherLands, colors: [] })
  return { totalLands, lands, exact: false }
}
