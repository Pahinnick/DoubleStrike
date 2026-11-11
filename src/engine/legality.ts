import type { CardSnapshot } from '../storage/cardCache'
import type { Board } from '../state/types'
import type { DeckFormat, Format } from '../utils/scryfallQuery'

/** `board` is undefined for deck-wide issues (no commander, wrong deck size) that aren't tied to
 *  a specific card — present for every other issue so callers can distinguish, e.g., a singleton
 *  violation in the mainboard from an unrelated copy of the same printing sitting in the sideboard. */
export type LegalityIssue = { scryfallId: string; name: string; reason: string; board?: Board }

export type DeckCardRef = { scryfallId: string; quantity: number; board: Board; isCommander?: boolean; isToken?: boolean }

const COMMANDER_DECK_SIZE = 100
/** Limited (draft/sealed) decks: at least 40 cards, any number of copies of anything you opened. */
export const LIMITED_MIN_DECK_SIZE = 40

export function getCardLegalityStatus(card: CardSnapshot, format: Format): string {
  return card.legalities[format] ?? 'not_legal'
}

// Matches the words separately rather than the phrase "Basic Land": snow basics read
// "Basic Snow Land — Island", which the phrase misses.
function isBasicLand(snapshot: CardSnapshot): boolean {
  const frontFace = snapshot.type_line.split(' // ')[0]
  return /\bBasic\b/.test(frontFace) && /\bLand\b/.test(frontFace)
}

/**
 * Commander-specific deck-construction rules that Scryfall's per-card
 * `legalities` field can't express on its own: singleton copies, the
 * commander's color identity, and the 100-card deck size. The commander
 * itself isn't a separate board — it's just a mainboard card flagged
 * `isCommander`, matching how Archidekt/Moxfield represent it. Doesn't
 * special-case the handful of cards that explicitly permit unlimited copies
 * of themselves (Relentless Rats, Dragon's Approach, etc.) — a documented
 * simplification.
 */
function computeCommanderIssues(cards: DeckCardRef[], snapshots: Map<string, CardSnapshot>): LegalityIssue[] {
  const issues: LegalityIssue[] = []

  // The sideboard is a holding area for cards not currently in the 100, so
  // singleton/identity/size rules only apply to the mainboard. Imported token reference cards
  // sit on the mainboard for visibility but were never really "in" the 100 either.
  const deckCards = cards.filter((c) => c.board === 'mainboard' && !c.isToken)
  const commanderCards = deckCards.filter((c) => c.isCommander)

  if (commanderCards.length === 0) {
    issues.push({ scryfallId: '__no-commander__', name: 'Deck', reason: 'No commander designated' })
  }

  const commanderIdentity = new Set<string>()
  // False while any commander's card data is still loading: its colours aren't known yet, and
  // checking against a partial identity would flag every card of the missing colours.
  let commanderIdentityKnown = commanderCards.length > 0
  for (const deckCard of commanderCards) {
    const snapshot = snapshots.get(deckCard.scryfallId)
    if (!snapshot) {
      commanderIdentityKnown = false
      continue
    }
    for (const color of snapshot.color_identity) commanderIdentity.add(color)
  }

  // Singleton is a rule about the card, not the printing: two different printings of Sol Ring
  // at one copy each are still two Sol Rings. Counted per oracle card across all its entries.
  const copiesByOracleId = new Map<string, number>()
  for (const deckCard of deckCards) {
    const snapshot = snapshots.get(deckCard.scryfallId)
    if (!snapshot) continue
    const key = snapshot.oracle_id || snapshot.name
    copiesByOracleId.set(key, (copiesByOracleId.get(key) ?? 0) + deckCard.quantity)
  }

  const totalCards = deckCards.reduce((sum, c) => sum + c.quantity, 0)
  if (totalCards > 0 && totalCards !== COMMANDER_DECK_SIZE) {
    issues.push({
      scryfallId: '__deck-size__',
      name: 'Deck',
      reason: `${totalCards}/${COMMANDER_DECK_SIZE} cards (commander decks need exactly ${COMMANDER_DECK_SIZE})`,
    })
  }

  for (const deckCard of deckCards) {
    const snapshot = snapshots.get(deckCard.scryfallId)
    if (!snapshot) continue

    if ((copiesByOracleId.get(snapshot.oracle_id || snapshot.name) ?? 0) > 1 && !isBasicLand(snapshot)) {
      issues.push({
        scryfallId: deckCard.scryfallId,
        name: snapshot.name,
        reason: 'Singleton violation (max 1 copy)',
        board: deckCard.board,
      })
    }

    if (commanderIdentityKnown && snapshot.color_identity.some((color) => !commanderIdentity.has(color))) {
      issues.push({
        scryfallId: deckCard.scryfallId,
        name: snapshot.name,
        reason: "Outside commander's color identity",
        board: deckCard.board,
      })
    }
  }

  return issues
}

/** Limited's only construction rule: a 40-card minimum mainboard. Copies and card legality don't
 *  matter — you play what you opened (basic lands are free and unlimited). */
function computeLimitedIssues(cards: DeckCardRef[]): LegalityIssue[] {
  const total = cards.filter((c) => c.board === 'mainboard' && !c.isToken).reduce((sum, c) => sum + c.quantity, 0)
  if (total >= LIMITED_MIN_DECK_SIZE) return []
  return [{ scryfallId: '__deck-size__', name: 'Deck', reason: `${total}/${LIMITED_MIN_DECK_SIZE} cards (limited decks need at least ${LIMITED_MIN_DECK_SIZE})` }]
}

/**
 * Checks every card in the deck (all boards) against Scryfall's per-format
 * legality data, plus (for commander) the deck-construction rules that
 * `legalities` can't express: singleton, color identity, and deck size.
 */
export function computeDeckLegality(
  cards: DeckCardRef[],
  snapshots: Map<string, CardSnapshot>,
  format: DeckFormat,
): { isLegal: boolean; issues: LegalityIssue[] } {
  if (format === 'limited') {
    const issues = computeLimitedIssues(cards)
    return { isLegal: issues.length === 0, issues }
  }
  const issues: LegalityIssue[] = []

  for (const deckCard of cards) {
    // Token reference cards aren't real, ownable cards — Scryfall marks every token "not_legal"
    // in every constructed format, which would otherwise flag every imported token as an issue.
    if (deckCard.isToken) continue
    const snapshot = snapshots.get(deckCard.scryfallId)
    if (!snapshot) continue

    const status = getCardLegalityStatus(snapshot, format)
    if (status === 'banned') {
      issues.push({ scryfallId: deckCard.scryfallId, name: snapshot.name, reason: 'Banned', board: deckCard.board })
    } else if (status === 'not_legal') {
      issues.push({ scryfallId: deckCard.scryfallId, name: snapshot.name, reason: 'Not legal', board: deckCard.board })
    } else if (status === 'restricted' && deckCard.quantity > 1) {
      issues.push({
        scryfallId: deckCard.scryfallId,
        name: snapshot.name,
        reason: 'Restricted (max 1 copy)',
        board: deckCard.board,
      })
    }
  }

  if (format === 'commander') {
    issues.push(...computeCommanderIssues(cards, snapshots))
  }

  return { isLegal: issues.length === 0, issues }
}
