import type { FoilKind } from '../state/types'

/** Selectable shader styles for the Foil row in the "Choose art" panel — order is display order. */
export const FOIL_OPTIONS: { id: FoilKind; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'surge', label: 'Surge' },
]

const KNOWN_FOILS = new Set<string>(FOIL_OPTIONS.map((o) => o.id))

/** Guards against a shader style that was removed from FOIL_OPTIONS but is still saved on a deck
 *  (foil persists in DeckCard, so retiring a style leaves stale values behind on existing decks).
 *  TypeScript can't catch those — the value comes off disk already typed as FoilKind. */
export function isKnownFoil(foil: FoilKind): boolean {
  return KNOWN_FOILS.has(foil)
}
