import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCastingManaCost, getDisplayImage, searchAllPrints } from './scryfall'
import type { ScryfallCard } from './scryfallTypes'

function makeCard(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: 'test-id',
    oracle_id: 'test-oracle-id',
    name: 'Test Card',
    layout: 'normal',
    cmc: 0,
    type_line: 'Creature',
    color_identity: [],
    legalities: {},
    ...overrides,
  }
}

describe('getCastingManaCost', () => {
  it('returns the top-level mana_cost when present', () => {
    const card = makeCard({ mana_cost: '{2}{U}{U}' })
    expect(getCastingManaCost(card)).toBe('{2}{U}{U}')
  })

  it('falls back to the front face mana_cost for DFCs', () => {
    const card = makeCard({
      mana_cost: '',
      layout: 'transform',
      card_faces: [
        { name: 'Front', mana_cost: '{1}{B}' },
        { name: 'Back', mana_cost: '' },
      ],
    })
    expect(getCastingManaCost(card)).toBe('{1}{B}')
  })

  it('prefers the front face cost over a combined split/adventure top-level string', () => {
    // Scryfall gives split/adventure cards a top-level mana_cost like
    // "{1}{R} // {1}{U}" that is not a single parseable cost; card_faces
    // must win whenever present.
    const card = makeCard({
      mana_cost: '{1}{R} // {1}{U}',
      layout: 'split',
      card_faces: [
        { name: 'Fire', mana_cost: '{1}{R}' },
        { name: 'Ice', mana_cost: '{1}{U}' },
      ],
    })
    expect(getCastingManaCost(card)).toBe('{1}{R}')
  })

  it('returns an empty string when no cost is available on either side', () => {
    const card = makeCard({ mana_cost: '', card_faces: undefined })
    expect(getCastingManaCost(card)).toBe('')
  })
})

describe('getDisplayImage', () => {
  it('returns top-level image_uris when present', () => {
    const card = makeCard({ image_uris: { small: 's', normal: 'n', large: 'l' } })
    expect(getDisplayImage(card)?.normal).toBe('n')
  })

  it('returns the front face image for DFCs by default', () => {
    const card = makeCard({
      card_faces: [
        { name: 'Front', mana_cost: '', image_uris: { small: 's1', normal: 'n1', large: 'l1' } },
        { name: 'Back', mana_cost: '', image_uris: { small: 's2', normal: 'n2', large: 'l2' } },
      ],
    })
    expect(getDisplayImage(card)?.normal).toBe('n1')
    expect(getDisplayImage(card, 'back')?.normal).toBe('n2')
  })

  it('returns undefined when there are no images anywhere', () => {
    const card = makeCard({})
    expect(getDisplayImage(card)).toBeUndefined()
  })
})

describe('fetched cards', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("fill in a reversible card's missing top-level type line from its face", async () => {
    // Shaped like Scryfall's reversible shocklands (Lorwyn Eclipsed): no top-level type_line.
    const reversible = { ...makeCard({ id: 'rev-1', name: 'Blood Crypt // Blood Crypt', layout: 'reversible_card' }), type_line: undefined }
    reversible.card_faces = [
      { name: 'Blood Crypt', mana_cost: '', type_line: 'Land — Swamp Mountain' },
      { name: 'Blood Crypt', mana_cost: '', type_line: 'Land — Swamp Mountain' },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ object: 'list', has_more: false, data: [reversible] }), { status: 200 })),
    )
    const [card] = await searchAllPrints('set:ecl is:booster')
    expect(card.type_line).toBe('Land — Swamp Mountain')
  })
})
