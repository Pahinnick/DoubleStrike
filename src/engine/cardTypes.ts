/** The parts of a card (Scryfall card or cached snapshot) that decide what kind of card it is. */
export type TypedCard = {
  type_line?: string
  layout?: string
  card_faces?: { type_line?: string }[]
}

/** A card's type line, falling back to its front face: reversible-layout printings (e.g. the ECL
 *  "Steam Vents") carry no top-level type_line at all, only one per face. */
export function resolveTypeLine(card: TypedCard): string {
  return card.type_line ?? card.card_faces?.[0]?.type_line ?? ''
}

/**
 * Whether a card counts as a land for deck-building purposes (the Lands category, the land count,
 * the mana base).
 *
 * A two-faced card's type line reads "Front // Back", so a plain search for "Land" also matches a
 * card whose BACK is a land. For a transforming card that is wrong: Growing Rites of Itlimoc is a
 * three-mana enchantment that only becomes a land later, never a land drop. Modal double-faced
 * cards are different — either face can be played from hand, so a spell//land one really can be
 * your land for the turn — and they keep counting. Snapshots cached before `layout` was recorded
 * keep the old any-face behaviour until they refresh.
 */
export function isLandCard(card: TypedCard): boolean {
  const typeLine = resolveTypeLine(card)
  const [front, ...backs] = typeLine.split(' // ')
  if (front.includes('Land')) return true
  if (!backs.some((face) => face.includes('Land'))) return false
  return card.layout === undefined || card.layout === 'modal_dfc'
}
