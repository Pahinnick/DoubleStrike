import type { CardPrices } from '../api/scryfallTypes'

/** Non-foil market price in USD, falling back to the foil price for cards Scryfall only lists as
 *  foil (e.g. many Secret Lair prints). Returns undefined when Scryfall has no listing at all. */
export function getCardUsdPrice(card: { prices?: CardPrices }): number | undefined {
  const raw = card.prices?.usd ?? card.prices?.usd_foil
  if (raw == null) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}
