import type { ImageUris } from '../api/scryfallTypes'

/** Thumbnail widths (px) for the small/medium/large card-grid size toggle, used as a CSS custom property. */
export const CARD_SIZES = {
  small: 110,
  medium: 165,
  large: 240,
} as const

export type CardSizeKey = keyof typeof CARD_SIZES

/**
 * Which Scryfall image resolution to request for each grid size. `small` (146x204) looks fine at the
 * 110px small-grid box. Medium/large boxes both request `large` (672x936): the grid's CSS
 * (`minmax(var(--card-size), 1fr)`) stretches columns to fill each row, so the actual on-screen width
 * ends up noticeably bigger than the nominal 165/240px and varies with viewport width — `normal`
 * (488x680) doesn't leave enough headroom for that stretch and downscales at an uneven ratio that
 * looks aliased on text-heavy cards. `large` gives both tiers enough margin regardless of the exact
 * rendered width.
 */
const IMAGE_URI_FOR_CARD_SIZE: Record<CardSizeKey, keyof ImageUris> = {
  small: 'small',
  medium: 'large',
  large: 'large',
}

export function getCardImageUrl(image: ImageUris, cardSize: CardSizeKey): string {
  return image[IMAGE_URI_FOR_CARD_SIZE[cardSize]] ?? image.small
}
