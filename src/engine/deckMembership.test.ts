import { describe, it, expect } from 'vitest'
import { buildDeckMembership, type MembershipEntry, type MembershipSnapshot } from './deckMembership'

const snapshots = (pairs: [string, string][]): Map<string, MembershipSnapshot> =>
  new Map(pairs.map(([scryfallId, oracle_id]) => [scryfallId, { oracle_id }]))

const entry = (overrides: Partial<MembershipEntry> & { scryfallId: string }): MembershipEntry => ({
  quantity: 1,
  board: 'mainboard',
  ...overrides,
})

describe('buildDeckMembership', () => {
  it('counts copies per board', () => {
    const membership = buildDeckMembership(
      [entry({ scryfallId: 'print-a', quantity: 3 }), entry({ scryfallId: 'print-a', quantity: 1, board: 'sideboard' })],
      snapshots([['print-a', 'oracle-1']]),
    )
    expect(membership.get('oracle-1')).toEqual({ mainboard: 3, sideboard: 1 })
  })

  it('collapses two different printings of the same card into one entry', () => {
    const membership = buildDeckMembership(
      [entry({ scryfallId: 'print-old' }), entry({ scryfallId: 'print-new' })],
      snapshots([
        ['print-old', 'oracle-1'],
        ['print-new', 'oracle-1'],
      ]),
    )
    expect(membership.size).toBe(1)
    expect(membership.get('oracle-1')).toEqual({ mainboard: 2, sideboard: 0 })
  })

  it('skips token reference cards, which are not real deck slots', () => {
    const membership = buildDeckMembership(
      [entry({ scryfallId: 'token-print', isToken: true })],
      snapshots([['token-print', 'oracle-token']]),
    )
    expect(membership.size).toBe(0)
  })

  it('skips entries whose snapshot has not resolved yet', () => {
    const membership = buildDeckMembership([entry({ scryfallId: 'unresolved' })], snapshots([]))
    expect(membership.size).toBe(0)
  })

  it('keeps distinct oracle cards apart', () => {
    const membership = buildDeckMembership(
      [entry({ scryfallId: 'a' }), entry({ scryfallId: 'b', quantity: 4 })],
      snapshots([
        ['a', 'oracle-1'],
        ['b', 'oracle-2'],
      ]),
    )
    expect(membership.get('oracle-1')).toEqual({ mainboard: 1, sideboard: 0 })
    expect(membership.get('oracle-2')).toEqual({ mainboard: 4, sideboard: 0 })
  })

  it('returns an empty map for an empty deck', () => {
    expect(buildDeckMembership([], snapshots([])).size).toBe(0)
  })
})
