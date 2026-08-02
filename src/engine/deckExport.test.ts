import { describe, expect, it } from 'vitest'
import type { ScryfallCard } from '../api/scryfallTypes'
import type { DeckCard } from '../state/types'
import { formatArchidektExport, formatArenaExport, formatDecExport, formatMtgoExport } from './deckExport'

function makeCard(overrides: Partial<ScryfallCard> & { id: string; name: string }): ScryfallCard {
  return {
    oracle_id: overrides.id,
    layout: 'normal',
    cmc: 0,
    type_line: 'Land',
    color_identity: [],
    legalities: {},
    set: 'tmc',
    collector_number: '1',
    ...overrides,
  }
}

function makeDeckCard(overrides: Partial<DeckCard> & { scryfallId: string }): DeckCard {
  return { quantity: 1, board: 'mainboard', ...overrides }
}

describe('formatArchidektExport', () => {
  it('formats a plain nonland card with a user category', () => {
    const cards = [makeDeckCard({ scryfallId: 'a', category: 'Ramp' })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Sol Ring', set: 'tmc', collector_number: '59', type_line: 'Artifact' })]])
    expect(formatArchidektExport(cards, byId)).toBe('1x Sol Ring (tmc) 59 [Ramp]')
  })

  it('falls back to the primary type group when no category is set', () => {
    const cards = [makeDeckCard({ scryfallId: 'a' })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Island', type_line: 'Basic Land — Island' })]])
    expect(formatArchidektExport(cards, byId)).toBe('1x Island (tmc) 1 [Land]')
  })

  it('marks a commander with the Commander{top} tag in place of its category', () => {
    const cards = [makeDeckCard({ scryfallId: 'a', isCommander: true, category: 'Voltron' })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Alela' })]])
    expect(formatArchidektExport(cards, byId)).toBe('1x Alela (tmc) 1 [Commander{top}]')
  })

  it('tags sideboard cards as Maybeboard in place of their category', () => {
    const cards = [makeDeckCard({ scryfallId: 'a', board: 'sideboard', category: 'Removal' })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Swords to Plowshares' })]])
    expect(formatArchidektExport(cards, byId)).toBe('1x Swords to Plowshares (tmc) 1 [Maybeboard]')
  })

  // Regression test: the "MTG Deck Loader / Importer" Tabletop Simulator mod's grammar for this
  // format is a single `[<category>]` tag — a comma-separated list like `[Draw,Maybeboard]`
  // (the old behavior here) fails its parser with "invalid deck format".
  it('never emits more than one comma-separated tag, even when a card has both a category and a board reason to tag', () => {
    const cards = [
      makeDeckCard({ scryfallId: 'a', category: 'Draw', board: 'sideboard' }),
      makeDeckCard({ scryfallId: 'b', isCommander: true, category: 'Voltron' }),
    ]
    const byId = new Map([
      ['a', makeCard({ id: 'a', name: 'Abundance' })],
      ['b', makeCard({ id: 'b', name: 'Zur the Enchanter' })],
    ])
    const lines = formatArchidektExport(cards, byId).split('\n')
    for (const line of lines) {
      const tag = line.match(/\[(.+)\]$/)?.[1]
      expect(tag).not.toContain(',')
    }
  })

  it('carries the deck card quantity through', () => {
    const cards = [makeDeckCard({ scryfallId: 'a', quantity: 16, category: 'Land' })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Forest' })]])
    expect(formatArchidektExport(cards, byId)).toBe('16x Forest (tmc) 1 [Land]')
  })

  it('sorts lines alphabetically by name regardless of input order', () => {
    const cards = [makeDeckCard({ scryfallId: 'b' }), makeDeckCard({ scryfallId: 'a' })]
    const byId = new Map([
      ['b', makeCard({ id: 'b', name: 'Zebra Stag' })],
      ['a', makeCard({ id: 'a', name: 'Adarkar Wastes' })],
    ])
    const lines = formatArchidektExport(cards, byId).split('\n')
    expect(lines[0]).toContain('Adarkar Wastes')
    expect(lines[1]).toContain('Zebra Stag')
  })

  // Most importers build the physical deck stack in list order, so the commander needs to be
  // first — on top, easy to grab — regardless of where its name would otherwise sort.
  it('puts the commander first even when its name would sort last alphabetically', () => {
    const cards = [makeDeckCard({ scryfallId: 'a' }), makeDeckCard({ scryfallId: 'z', isCommander: true })]
    const byId = new Map([
      ['a', makeCard({ id: 'a', name: 'Adarkar Wastes' })],
      ['z', makeCard({ id: 'z', name: 'Zur the Enchanter' })],
    ])
    const lines = formatArchidektExport(cards, byId).split('\n')
    expect(lines[0]).toContain('Zur the Enchanter')
    expect(lines[1]).toContain('Adarkar Wastes')
  })

  it('puts both partner commanders first, ahead of the rest, sorted alphabetically between themselves', () => {
    const cards = [
      makeDeckCard({ scryfallId: 'm' }),
      makeDeckCard({ scryfallId: 'z', isCommander: true }),
      makeDeckCard({ scryfallId: 'a', isCommander: true }),
    ]
    const byId = new Map([
      ['m', makeCard({ id: 'm', name: 'Middle Card' })],
      ['z', makeCard({ id: 'z', name: 'Zur the Enchanter' })],
      ['a', makeCard({ id: 'a', name: 'Ardenn, Intrepid Archaeologist' })],
    ])
    const lines = formatArchidektExport(cards, byId).split('\n')
    expect(lines[0]).toContain('Ardenn')
    expect(lines[1]).toContain('Zur')
    expect(lines[2]).toContain('Middle Card')
  })

  it('skips cards with no resolved set/collector number instead of emitting a broken line', () => {
    const cards = [makeDeckCard({ scryfallId: 'missing' }), makeDeckCard({ scryfallId: 'a' })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Sol Ring' })]])
    expect(formatArchidektExport(cards, byId)).toBe('1x Sol Ring (tmc) 1 [Land]')
  })

  it('returns an empty string for an empty deck', () => {
    expect(formatArchidektExport([], new Map())).toBe('')
  })

  it('omits imported token reference cards — never a real, ownable card to rebuy', () => {
    const cards = [makeDeckCard({ scryfallId: 'a' }), makeDeckCard({ scryfallId: 'tok', category: 'Tokens', isToken: true })]
    const byId = new Map([
      ['a', makeCard({ id: 'a', name: 'Sol Ring' })],
      ['tok', makeCard({ id: 'tok', name: 'Soldier Token' })],
    ])
    expect(formatArchidektExport(cards, byId)).toBe('1x Sol Ring (tmc) 1 [Land]')
  })
})

describe('formatMtgoExport', () => {
  it('formats a plain "quantity name" line with no set/collector/tag', () => {
    const cards = [makeDeckCard({ scryfallId: 'a', quantity: 4 })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Lightning Bolt' })]])
    expect(formatMtgoExport(cards, byId)).toBe('4 Lightning Bolt')
  })

  it('omits sideboard cards rather than inventing unsupported syntax for them', () => {
    const cards = [
      makeDeckCard({ scryfallId: 'a' }),
      makeDeckCard({ scryfallId: 'b', board: 'sideboard' }),
    ]
    const byId = new Map([
      ['a', makeCard({ id: 'a', name: 'Sol Ring' })],
      ['b', makeCard({ id: 'b', name: 'Negate' })],
    ])
    expect(formatMtgoExport(cards, byId)).toBe('1 Sol Ring')
  })

  it('puts the commander first here too — the top-of-list ordering is shared across every format', () => {
    const cards = [makeDeckCard({ scryfallId: 'a' }), makeDeckCard({ scryfallId: 'z', isCommander: true })]
    const byId = new Map([
      ['a', makeCard({ id: 'a', name: 'Adarkar Wastes' })],
      ['z', makeCard({ id: 'z', name: 'Zur the Enchanter' })],
    ])
    const lines = formatMtgoExport(cards, byId).split('\n')
    expect(lines[0]).toBe('1 Zur the Enchanter')
    expect(lines[1]).toBe('1 Adarkar Wastes')
  })
})

describe('formatArenaExport', () => {
  it('formats "quantity name (SET) collector" with an uppercased set code', () => {
    const cards = [makeDeckCard({ scryfallId: 'a', quantity: 1 })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Storm Crow', set: '9ed', collector_number: '100' })]])
    expect(formatArenaExport(cards, byId)).toBe('1 Storm Crow (9ED) 100')
  })

  it('omits sideboard cards', () => {
    const cards = [makeDeckCard({ scryfallId: 'a', board: 'sideboard' })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Negate' })]])
    expect(formatArenaExport(cards, byId)).toBe('')
  })
})

describe('formatDecExport', () => {
  it('formats "quantity [SET] name" with an uppercased set code', () => {
    const cards = [makeDeckCard({ scryfallId: 'a', quantity: 1 })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Storm Crow', set: '9ed', collector_number: '100' })]])
    expect(formatDecExport(cards, byId)).toBe('1 [9ED] Storm Crow')
  })

  it('omits sideboard cards', () => {
    const cards = [makeDeckCard({ scryfallId: 'a', board: 'sideboard' })]
    const byId = new Map([['a', makeCard({ id: 'a', name: 'Negate' })]])
    expect(formatDecExport(cards, byId)).toBe('')
  })
})
