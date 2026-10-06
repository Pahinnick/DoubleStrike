import { describe, expect, it } from 'vitest'
import { computeDeckLegality, type DeckCardRef } from './legality'
import type { CardSnapshot } from '../storage/cardCache'

function makeSnapshot(
  id: string,
  name: string,
  legalities: Record<string, string>,
  overrides: Partial<Pick<CardSnapshot, 'color_identity' | 'type_line'>> = {},
): CardSnapshot {
  return {
    id,
    oracle_id: `${id}-oracle`,
    name,
    mana_cost: '',
    cmc: 0,
    type_line: overrides.type_line ?? 'Creature',
    colors: [],
    color_identity: overrides.color_identity ?? [],
    legalities: legalities as CardSnapshot['legalities'],
    cachedAt: new Date().toISOString(),
  }
}

describe('computeDeckLegality', () => {
  it('is legal when every card is legal in the format', () => {
    const snapshots = new Map([['a', makeSnapshot('a', 'Card A', { modern: 'legal' })]])
    const cards: DeckCardRef[] = [{ scryfallId: 'a', quantity: 4, board: 'mainboard' }]
    const result = computeDeckLegality(cards, snapshots, 'modern')
    expect(result.isLegal).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('flags banned cards', () => {
    const snapshots = new Map([['a', makeSnapshot('a', 'Banned Card', { modern: 'banned' })]])
    const cards: DeckCardRef[] = [{ scryfallId: 'a', quantity: 1, board: 'mainboard' }]
    const result = computeDeckLegality(cards, snapshots, 'modern')
    expect(result.isLegal).toBe(false)
    expect(result.issues).toEqual([{ scryfallId: 'a', name: 'Banned Card', reason: 'Banned', board: 'mainboard' }])
  })

  it('flags cards missing from the format entirely as not legal', () => {
    const snapshots = new Map([['a', makeSnapshot('a', 'Legacy Card', { legacy: 'legal' })]])
    const cards: DeckCardRef[] = [{ scryfallId: 'a', quantity: 1, board: 'mainboard' }]
    const result = computeDeckLegality(cards, snapshots, 'modern')
    expect(result.isLegal).toBe(false)
    expect(result.issues[0].reason).toBe('Not legal')
  })

  it('flags restricted cards only when more than 1 copy is present', () => {
    const snapshots = new Map([['a', makeSnapshot('a', 'Restricted Card', { vintage: 'restricted' })]])
    const oneCopy = computeDeckLegality([{ scryfallId: 'a', quantity: 1, board: 'mainboard' }], snapshots, 'vintage')
    const twoCopies = computeDeckLegality([{ scryfallId: 'a', quantity: 2, board: 'mainboard' }], snapshots, 'vintage')
    expect(oneCopy.isLegal).toBe(true)
    expect(twoCopies.isLegal).toBe(false)
  })

  it('checks cards in every board, not just mainboard', () => {
    const snapshots = new Map([['a', makeSnapshot('a', 'Banned Sideboard Card', { modern: 'banned' })]])
    const cards: DeckCardRef[] = [{ scryfallId: 'a', quantity: 1, board: 'sideboard' }]
    const result = computeDeckLegality(cards, snapshots, 'modern')
    expect(result.isLegal).toBe(false)
  })

  it('skips cards with no loaded snapshot rather than throwing', () => {
    const result = computeDeckLegality([{ scryfallId: 'missing', quantity: 1, board: 'mainboard' }], new Map(), 'modern')
    expect(result.isLegal).toBe(true)
  })

  it('ignores token reference cards, even ones Scryfall marks not_legal in every format', () => {
    const snapshots = new Map([['tok', makeSnapshot('tok', 'Soldier Token', { modern: 'not_legal' })]])
    const cards: DeckCardRef[] = [{ scryfallId: 'tok', quantity: 1, board: 'mainboard', isToken: true }]
    const result = computeDeckLegality(cards, snapshots, 'modern')
    expect(result.isLegal).toBe(true)
    expect(result.issues).toEqual([])
  })

  describe('commander-specific rules', () => {
    function commanderSnapshot(id: string, name: string, colorIdentity: string[] = []) {
      return makeSnapshot(id, name, { commander: 'legal' }, { color_identity: colorIdentity })
    }

    it('flags a deck with no commander designated', () => {
      const snapshots = new Map([['a', commanderSnapshot('a', 'Some Card')]])
      const cards: DeckCardRef[] = [{ scryfallId: 'a', quantity: 1, board: 'mainboard' }]
      const result = computeDeckLegality(cards, snapshots, 'commander')
      expect(result.issues.some((i) => i.reason === 'No commander designated')).toBe(true)
    })

    it('flags more than one copy of a nonbasic card as a singleton violation', () => {
      const snapshots = new Map([
        ['cmd', commanderSnapshot('cmd', 'The Commander')],
        ['a', commanderSnapshot('a', 'Some Card')],
      ])
      const cards: DeckCardRef[] = [
        { scryfallId: 'cmd', quantity: 1, board: 'mainboard', isCommander: true },
        { scryfallId: 'a', quantity: 2, board: 'mainboard' },
      ]
      const result = computeDeckLegality(cards, snapshots, 'commander')
      expect(result.issues.some((i) => i.reason === 'Singleton violation (max 1 copy)')).toBe(true)
    })

    it('does not flag multiple basic lands as a singleton violation', () => {
      const snapshots = new Map([
        ['cmd', commanderSnapshot('cmd', 'The Commander')],
        ['forest', makeSnapshot('forest', 'Forest', { commander: 'legal' }, { type_line: 'Basic Land — Forest' })],
      ])
      const cards: DeckCardRef[] = [
        { scryfallId: 'cmd', quantity: 1, board: 'mainboard', isCommander: true },
        { scryfallId: 'forest', quantity: 20, board: 'mainboard' },
      ]
      const result = computeDeckLegality(cards, snapshots, 'commander')
      expect(result.issues.some((i) => i.reason === 'Singleton violation (max 1 copy)')).toBe(false)
    })

    it("flags a card outside the commander's color identity", () => {
      const snapshots = new Map([
        ['cmd', commanderSnapshot('cmd', 'Mono Blue Commander', ['U'])],
        ['a', commanderSnapshot('a', 'Red Card', ['R'])],
      ])
      const cards: DeckCardRef[] = [
        { scryfallId: 'cmd', quantity: 1, board: 'mainboard', isCommander: true },
        { scryfallId: 'a', quantity: 1, board: 'mainboard' },
      ]
      const result = computeDeckLegality(cards, snapshots, 'commander')
      expect(result.issues.some((i) => i.reason === "Outside commander's color identity")).toBe(true)
    })

    it("does not flag a card within the commander's color identity", () => {
      const snapshots = new Map([
        ['cmd', commanderSnapshot('cmd', 'Izzet Commander', ['U', 'R'])],
        ['a', commanderSnapshot('a', 'Blue Card', ['U'])],
      ])
      const cards: DeckCardRef[] = [
        { scryfallId: 'cmd', quantity: 1, board: 'mainboard', isCommander: true },
        { scryfallId: 'a', quantity: 1, board: 'mainboard' },
      ]
      const result = computeDeckLegality(cards, snapshots, 'commander')
      expect(result.issues.some((i) => i.reason === "Outside commander's color identity")).toBe(false)
    })

    it('supports two commanders (partners), unioning their color identities', () => {
      const snapshots = new Map([
        ['cmd1', commanderSnapshot('cmd1', 'Blue Partner', ['U'])],
        ['cmd2', commanderSnapshot('cmd2', 'Red Partner', ['R'])],
        ['a', commanderSnapshot('a', 'Izzet Card', ['U', 'R'])],
      ])
      const cards: DeckCardRef[] = [
        { scryfallId: 'cmd1', quantity: 1, board: 'mainboard', isCommander: true },
        { scryfallId: 'cmd2', quantity: 1, board: 'mainboard', isCommander: true },
        { scryfallId: 'a', quantity: 1, board: 'mainboard' },
      ]
      const result = computeDeckLegality(cards, snapshots, 'commander')
      expect(result.issues.some((i) => i.reason === "Outside commander's color identity")).toBe(false)
      expect(result.issues.some((i) => i.reason === 'No commander designated')).toBe(false)
    })

    it('flags a deck that is not exactly 100 cards once nonempty', () => {
      const snapshots = new Map([['cmd', commanderSnapshot('cmd', 'The Commander')]])
      const cards: DeckCardRef[] = [{ scryfallId: 'cmd', quantity: 1, board: 'mainboard', isCommander: true }]
      const result = computeDeckLegality(cards, snapshots, 'commander')
      expect(result.issues.some((i) => i.reason.includes('/100 cards'))).toBe(true)
    })

    it('does not flag deck size for an empty deck', () => {
      const result = computeDeckLegality([], new Map(), 'commander')
      expect(result.issues.some((i) => i.reason.includes('/100 cards'))).toBe(false)
    })

    it('ignores sideboard cards for singleton, identity, and size checks', () => {
      const snapshots = new Map([
        ['cmd', commanderSnapshot('cmd', 'The Commander', ['U'])],
        ['a', commanderSnapshot('a', 'Red Card', ['R'])],
      ])
      const cards: DeckCardRef[] = [
        { scryfallId: 'cmd', quantity: 1, board: 'mainboard', isCommander: true },
        { scryfallId: 'a', quantity: 3, board: 'sideboard' },
      ]
      const result = computeDeckLegality(cards, snapshots, 'commander')
      expect(result.issues.some((i) => i.reason === 'Singleton violation (max 1 copy)')).toBe(false)
      expect(result.issues.some((i) => i.reason === "Outside commander's color identity")).toBe(false)
    })

    it('ignores mainboard token reference cards for singleton, identity, and the 100-card size check', () => {
      const snapshots = new Map([
        ['cmd', commanderSnapshot('cmd', 'The Commander', ['U'])],
        ['tok', commanderSnapshot('tok', 'Zombie Token', ['B'])],
      ])
      const cards: DeckCardRef[] = [
        { scryfallId: 'cmd', quantity: 1, board: 'mainboard', isCommander: true },
        { scryfallId: 'tok', quantity: 1, board: 'mainboard', isToken: true },
      ]
      const result = computeDeckLegality(cards, snapshots, 'commander')
      // 1/100, not 2/100 — the token wasn't counted toward the total.
      expect(result.issues.some((i) => i.reason.includes('1/100 cards'))).toBe(true)
      expect(result.issues.some((i) => i.reason === "Outside commander's color identity")).toBe(false)
    })
  })
})

describe('computeDeckLegality — commander singleton and identity edge cases', () => {
  const legal = { commander: 'legal' }
  function singletonIssues(cards: DeckCardRef[], snapshots: Map<string, CardSnapshot>) {
    return computeDeckLegality(cards, snapshots, 'commander').issues.filter((i) => i.reason.startsWith('Singleton'))
  }

  it('allows any number of snow basics', () => {
    const snapshots = new Map([['snow', makeSnapshot('snow', 'Snow-Covered Island', legal, { type_line: 'Basic Snow Land — Island' })]])
    expect(singletonIssues([{ scryfallId: 'snow', quantity: 30, board: 'mainboard' }], snapshots)).toEqual([])
  })

  it('counts two printings of the same card as two copies', () => {
    const a = makeSnapshot('ring-a', 'Sol Ring', legal, { type_line: 'Artifact' })
    const b = { ...makeSnapshot('ring-b', 'Sol Ring', legal, { type_line: 'Artifact' }), oracle_id: a.oracle_id }
    const snapshots = new Map([
      ['ring-a', a],
      ['ring-b', b],
    ])
    const issues = singletonIssues(
      [
        { scryfallId: 'ring-a', quantity: 1, board: 'mainboard' },
        { scryfallId: 'ring-b', quantity: 1, board: 'mainboard' },
      ],
      snapshots,
    )
    expect(issues.map((i) => i.scryfallId).sort()).toEqual(['ring-a', 'ring-b'])
  })

  it('holds off on identity checks until the commander has loaded', () => {
    const snapshots = new Map([['bolt', makeSnapshot('bolt', 'Lightning Bolt', legal, { color_identity: ['R'] })]])
    const cards: DeckCardRef[] = [
      { scryfallId: 'cmdr', quantity: 1, board: 'mainboard', isCommander: true },
      { scryfallId: 'bolt', quantity: 1, board: 'mainboard' },
    ]
    const identityIssues = computeDeckLegality(cards, snapshots, 'commander').issues.filter((i) => i.reason.includes('identity'))
    expect(identityIssues).toEqual([])
  })
})
