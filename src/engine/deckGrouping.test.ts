import { describe, expect, it } from 'vitest'
import type { CardSnapshot } from '../storage/cardCache'
import type { DeckCard } from '../state/types'
import { type DeckCardEntry, getPrimaryTypeGroup, groupByCategory, groupByType } from './deckGrouping'

function snapshot(overrides: Partial<CardSnapshot> & { type_line: string }): CardSnapshot {
  return {
    id: overrides.id ?? 'id',
    oracle_id: 'oracle',
    name: overrides.name ?? 'Card',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: {},
    cachedAt: new Date().toISOString(),
    ...overrides,
  }
}

function deckCard(overrides: Partial<DeckCard> & { scryfallId: string }): DeckCard {
  return { quantity: 1, board: 'mainboard', ...overrides }
}

describe('getPrimaryTypeGroup', () => {
  it('picks the first matching type in priority order', () => {
    expect(getPrimaryTypeGroup('Artifact Creature — Golem')).toBe('Creature')
    expect(getPrimaryTypeGroup('Legendary Planeswalker — Jace')).toBe('Planeswalker')
    expect(getPrimaryTypeGroup('Basic Land — Island')).toBe('Land')
  })

  it('falls back to Other for unrecognized type lines', () => {
    expect(getPrimaryTypeGroup('Tribal')).toBe('Other')
  })
})

describe('groupByType', () => {
  it('buckets entries by primary type and orders groups by type priority', () => {
    const entries: DeckCardEntry[] = [
      { deckCard: deckCard({ scryfallId: 'a' }), snapshot: snapshot({ id: 'a', type_line: 'Land — Island' }) },
      { deckCard: deckCard({ scryfallId: 'b' }), snapshot: snapshot({ id: 'b', type_line: 'Creature — Bear' }) },
      { deckCard: deckCard({ scryfallId: 'c' }), snapshot: undefined },
    ]
    const groups = groupByType(entries)
    expect(groups.map((g) => g.label)).toEqual(['Creature', 'Land', 'Other'])
    expect(groups.find((g) => g.label === 'Creature')?.entries).toHaveLength(1)
  })

  it('pulls commanders into a leading Commanders section', () => {
    const entries: DeckCardEntry[] = [
      { deckCard: deckCard({ scryfallId: 'a' }), snapshot: snapshot({ id: 'a', type_line: 'Creature — Bear' }) },
      { deckCard: deckCard({ scryfallId: 'cmdr', isCommander: true }), snapshot: snapshot({ id: 'cmdr', type_line: 'Legendary Creature — Human' }) },
    ]
    const groups = groupByType(entries)
    expect(groups.map((g) => g.label)).toEqual(['Commanders', 'Creature'])
    // The commander is not also double-counted under Creature.
    expect(groups.find((g) => g.label === 'Creature')?.entries).toHaveLength(1)
  })
})

describe('groupByCategory', () => {
  it('leads with Uncategorized, then categories alphabetically — not deck.categories\' own creation order', () => {
    const entries: DeckCardEntry[] = [
      { deckCard: deckCard({ scryfallId: 'a', category: 'Removal' }), snapshot: undefined },
      { deckCard: deckCard({ scryfallId: 'b', category: 'Ramp' }), snapshot: undefined },
      { deckCard: deckCard({ scryfallId: 'c' }), snapshot: undefined },
    ]
    // Categories passed in deliberately out of alphabetical order (as they'd exist after being
    // created/imported in this order) — output must still read Ramp before Removal.
    const groups = groupByCategory(entries, ['Removal', 'Ramp'])
    expect(groups.map((g) => g.label)).toEqual(['Uncategorized', 'Ramp', 'Removal'])
  })

  it('sorts category names case-insensitively', () => {
    const entries: DeckCardEntry[] = [
      { deckCard: deckCard({ scryfallId: 'a', category: 'burn' }), snapshot: undefined },
      { deckCard: deckCard({ scryfallId: 'b', category: 'Aggro' }), snapshot: undefined },
    ]
    const groups = groupByCategory(entries, ['burn', 'Aggro'])
    expect(groups.map((g) => g.label)).toEqual(['Aggro', 'burn'])
  })

  it('puts commanders first, above Uncategorized, regardless of their own category', () => {
    const entries: DeckCardEntry[] = [
      { deckCard: deckCard({ scryfallId: 'a', category: 'Ramp' }), snapshot: undefined },
      { deckCard: deckCard({ scryfallId: 'cmdr', isCommander: true }), snapshot: undefined },
      { deckCard: deckCard({ scryfallId: 'c' }), snapshot: undefined },
    ]
    const groups = groupByCategory(entries, ['Ramp'])
    expect(groups.map((g) => g.label)).toEqual(['Commanders', 'Uncategorized', 'Ramp'])
    expect(groups.find((g) => g.label === 'Commanders')?.entries.map((e) => e.deckCard.scryfallId)).toEqual(['cmdr'])
  })

  it('treats a category not present on the deck as uncategorized', () => {
    const entries: DeckCardEntry[] = [{ deckCard: deckCard({ scryfallId: 'a', category: 'Deleted' }), snapshot: undefined }]
    const groups = groupByCategory(entries, [])
    expect(groups).toEqual([{ label: 'Uncategorized', entries }])
  })

  it('pins isToken cards last under "Token Cards", regardless of insertion order', () => {
    const entries: DeckCardEntry[] = [
      { deckCard: deckCard({ scryfallId: 'a', category: 'Ramp' }), snapshot: undefined },
      { deckCard: deckCard({ scryfallId: 'tok', category: 'Token Cards', isToken: true }), snapshot: undefined },
      { deckCard: deckCard({ scryfallId: 'b', category: 'Removal' }), snapshot: undefined },
    ]
    // Token Cards was added first (as import does), Removal added afterward via the category manager.
    const groups = groupByCategory(entries, ['Token Cards', 'Ramp', 'Removal'])
    expect(groups.map((g) => g.label)).toEqual(['Ramp', 'Removal', 'Token Cards'])
  })

  // Regression: a real synergy card (Anointed Procession, Kaya) commonly shares Archidekt's own
  // "Tokens" category name with the auto-imported token reference cards — they must not collide.
  it("keeps a real card in its own \"Tokens\" category separate from the pinned Token Cards section", () => {
    const entries: DeckCardEntry[] = [
      { deckCard: deckCard({ scryfallId: 'synergy', category: 'Tokens' }), snapshot: undefined },
      { deckCard: deckCard({ scryfallId: 'gen', category: 'Token Cards', isToken: true }), snapshot: undefined },
      { deckCard: deckCard({ scryfallId: 'b', category: 'Removal' }), snapshot: undefined },
    ]
    const groups = groupByCategory(entries, ['Tokens', 'Token Cards', 'Removal'])
    // Alphabetical among the real categories (Removal before Tokens) — Token Cards is still
    // pinned last regardless, since it's pulled out by the isToken flag before sorting even applies.
    expect(groups.map((g) => g.label)).toEqual(['Removal', 'Tokens', 'Token Cards'])
    expect(groups.find((g) => g.label === 'Tokens')?.entries.map((e) => e.deckCard.scryfallId)).toEqual(['synergy'])
    expect(groups.find((g) => g.label === 'Token Cards')?.entries.map((e) => e.deckCard.scryfallId)).toEqual(['gen'])
  })
})
