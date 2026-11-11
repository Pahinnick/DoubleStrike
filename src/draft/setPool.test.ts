import { describe, expect, it } from 'vitest'
import type { ScryfallSet } from '../api/scryfallTypes'
import { recentSetCodes, toDraftableSets } from './setPool'

function set(code: string, overrides: Partial<ScryfallSet> = {}): ScryfallSet {
  return { code, name: code.toUpperCase(), set_type: 'expansion', released_at: '2024-01-01', card_count: 300, digital: false, ...overrides }
}

describe('toDraftableSets', () => {
  const today = '2026-11-09'

  it('keeps released, paper, booster-sold sets, newest first, tagged with their booster type', () => {
    const result = toDraftableSets(
      [set('neo', { released_at: '2022-02-18' }), set('dsk', { released_at: '2024-09-27' }), set('lrw', { released_at: '2007-10-12', set_type: 'core' })],
      today,
    )
    expect(result.map((s) => s.code)).toEqual(['dsk', 'neo', 'lrw'])
    expect(result.map((s) => s.boosterType)).toEqual(['play', 'draft', 'classic'])
  })

  it('drops products that were never draft boosters', () => {
    const result = toDraftableSets(
      [
        set('cmm', { set_type: 'commander' }),
        set('otp', { set_type: 'masterpiece', parent_set_code: 'otj' }),
        set('ydsk', { digital: true }),
        set('plst', { name: 'The List', set_type: 'masters' }),
        set('j22', { name: 'Jumpstart 2022', set_type: 'draft_innovation' }),
        set('tiny', { card_count: 20 }),
        set('next', { released_at: '2027-02-01' }),
        set('acr', { set_type: 'draft_innovation' }),
        set('mat'),
        set('sum', { set_type: 'core' }),
        set('mb2', { set_type: 'masters' }),
        set('dsk'),
      ],
      today,
    )
    expect(result.map((s) => s.code)).toEqual(['dsk'])
  })
})

describe('recentSetCodes', () => {
  it('picks out sets released within the window, which get their booster data checked', () => {
    const sets = toDraftableSets(
      [set('fra', { released_at: '2026-10-02' }), set('ecl', { released_at: '2026-01-23' }), set('dsk', { released_at: '2024-09-27' })],
      '2026-11-09',
    )
    expect(recentSetCodes(sets, '2026-11-09', 400)).toEqual(['fra', 'ecl'])
    expect(recentSetCodes(sets, '2026-11-09', 60)).toEqual(['fra'])
  })
})
