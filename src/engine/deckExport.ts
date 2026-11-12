import type { ScryfallCard } from '../api/scryfallTypes'
import type { DeckCard } from '../state/types'
import { getPrimaryTypeGroup } from './deckGrouping'

export type ExportFormat = 'tts' | 'archidekt' | 'dec' | 'arena' | 'mtgo'

export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'tts', label: 'Tabletop Simulator (paste into importer)' },
  { value: 'archidekt', label: 'Archidekt (plain text)' },
  { value: 'dec', label: '.dec' },
  { value: 'arena', label: 'MTG Arena (.txt)' },
  { value: 'mtgo', label: 'MTGO (.txt / simple format)' },
]

type ResolvedEntry = { deckCard: DeckCard; card: ScryfallCard & { set: string; collector_number: string } }

/** Resolves deck cards against their Scryfall data, drops ones missing set/collector info
 *  (e.g. an offline lookup) rather than emitting an unparseable line, drops imported token
 *  reference cards (never real, ownable cards — nothing to rebuy/rebuild), and sorts commander(s)
 *  first — so they're first in the exported list, which importers build as the top of the
 *  physical deck stack, easy to grab without digging — then everything else alphabetically by
 *  name. Shared by every export format. */
function resolveAndSort(cards: DeckCard[], cardsById: Map<string, ScryfallCard>): ResolvedEntry[] {
  return cards
    .filter((deckCard) => !deckCard.isToken)
    .map((deckCard) => ({ deckCard, card: cardsById.get(deckCard.scryfallId) }))
    .filter((entry): entry is ResolvedEntry => Boolean(entry.card?.set && entry.card?.collector_number))
    .sort((a, b) => {
      const rankA = a.deckCard.isCommander ? 0 : 1
      const rankB = b.deckCard.isCommander ? 0 : 1
      return rankA !== rankB ? rankA - rankB : a.card.name.localeCompare(b.card.name)
    })
}

/**
 * Exactly one tag per line — the widely-used TTS "MTG Deck Loader / Importer" mod's grammar for
 * this format is `[<category>]`, a single tag, not a comma-separated list. A card can't be both
 * a commander and sideboard-only, so there's no real conflict: Commander beats Maybeboard beats
 * the card's own category, in that priority order. (A sideboard card's real category is dropped
 * in the process — Maybeboard's exclusion behavior on the TTS side matters far more than
 * preserving categorization for cards that won't even end up on the table.)
 */
function buildTag(deckCard: DeckCard, card: ScryfallCard): string {
  if (deckCard.isCommander) return 'Commander{top}'
  if (deckCard.board === 'sideboard') return 'Maybeboard'
  // Reversible-layout printings have no top-level type_line — it only exists per face.
  return deckCard.category ?? getPrimaryTypeGroup(card.type_line ?? card.card_faces?.[0]?.type_line ?? '')
}

/**
 * Formats a deck as Archidekt's plain-text export ("1x Card Name (set) 123 [Tag]"), matching
 * what deckImport.ts's parseArchidektExport() reads back in. Includes sideboard cards, tagged
 * Maybeboard so Archidekt-aware importers exclude them from the physical deck.
 */
export function formatArchidektExport(cards: DeckCard[], cardsById: Map<string, ScryfallCard>): string {
  return resolveAndSort(cards, cardsById)
    .map(
      ({ deckCard, card }) =>
        `${deckCard.quantity}x ${card.name} (${card.set}) ${card.collector_number} [${buildTag(deckCard, card)}]`,
    )
    .join('\n')
}

// The three formats below have no tag/category syntax at all (confirmed against a real TTS
// importer's own help text: ".dec", "MTG Arena .txt", "MTG Online .txt / simple format" — none
// of them mention Archidekt-style [Category] brackets). Rather than invent unsupported syntax to
// carry sideboard/Maybeboard status — which is exactly what broke the Archidekt export against
// that importer in the first place — sideboard cards are just omitted. That lands on the same
// outcome Maybeboard was for: those cards don't end up on the physical table.

/** MTGO's simple .txt export ("1 Storm Crow") — just quantity and name, mainboard only. */
export function formatMtgoExport(cards: DeckCard[], cardsById: Map<string, ScryfallCard>): string {
  return resolveAndSort(
    cards.filter((c) => c.board === 'mainboard'),
    cardsById,
  )
    .map(({ deckCard, card }) => `${deckCard.quantity} ${card.name}`)
    .join('\n')
}

/** MTG Arena's .txt export ("1 Storm Crow (9ED) 100") — set code and collector number let the
 *  importer pick the exact printing, mainboard only. */
export function formatArenaExport(cards: DeckCard[], cardsById: Map<string, ScryfallCard>): string {
  return resolveAndSort(
    cards.filter((c) => c.board === 'mainboard'),
    cardsById,
  )
    .map(({ deckCard, card }) => `${deckCard.quantity} ${card.name} (${card.set.toUpperCase()}) ${card.collector_number}`)
    .join('\n')
}

/** .dec format ("1 [9ED] Storm Crow") — set code in brackets ahead of the name, mainboard only. */
export function formatDecExport(cards: DeckCard[], cardsById: Map<string, ScryfallCard>): string {
  return resolveAndSort(
    cards.filter((c) => c.board === 'mainboard'),
    cardsById,
  )
    .map(({ deckCard, card }) => `${deckCard.quantity} [${card.set.toUpperCase()}] ${card.name}`)
    .join('\n')
}

/**
 * For pasting into a Tabletop Simulator table's deck importer ("or enter a decklist" — rikrassen's
 * MTG Deck Importer, in the scripted 4-player tables): MTG Arena lines under Commander / Deck /
 * Sideboard headings. Checked against that importer's server: the headings are what put the
 * commander face up in front of the player instead of shuffled into the library, and the
 * sideboard in its own pile (it also adds a token pile for whatever the cards create). Full card
 * names, double-faced "Front // Back" included, and set + collector number pick the exact printing.
 */
export function formatTtsExport(cards: DeckCard[], cardsById: Map<string, ScryfallCard>): string {
  const line = ({ deckCard, card }: ResolvedEntry) => `${deckCard.quantity} ${card.name} (${card.set.toUpperCase()}) ${card.collector_number}`
  const entries = resolveAndSort(cards, cardsById)
  const sections: [string, ResolvedEntry[]][] = [
    ['Commander', entries.filter((e) => e.deckCard.isCommander)],
    ['Deck', entries.filter((e) => !e.deckCard.isCommander && e.deckCard.board === 'mainboard')],
    ['Sideboard', entries.filter((e) => !e.deckCard.isCommander && e.deckCard.board === 'sideboard')],
  ]
  return sections
    .filter(([, list]) => list.length > 0)
    .map(([heading, list]) => [heading, ...list.map(line)].join('\n'))
    .join('\n\n')
}

export function formatDeckExport(format: ExportFormat, cards: DeckCard[], cardsById: Map<string, ScryfallCard>): string {
  switch (format) {
    case 'tts':
      return formatTtsExport(cards, cardsById)
    case 'archidekt':
      return formatArchidektExport(cards, cardsById)
    case 'dec':
      return formatDecExport(cards, cardsById)
    case 'arena':
      return formatArenaExport(cards, cardsById)
    case 'mtgo':
      return formatMtgoExport(cards, cardsById)
  }
}
