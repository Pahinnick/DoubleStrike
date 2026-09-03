import { describe, it, expect } from 'vitest'
import type { ScryfallCard } from '../api/scryfallTypes'
import {
  commanderSlugCandidate,
  inclusionRate,
  parseCommanderPage,
  sortEdhrecMatches,
  topCommanderDeckCounts,
  topCommandersRanked,
  type EdhrecCardRec,
  type EdhrecMatch,
} from './edhrecRecommendations'

/** A trimmed slice of the real Atraxa, Praetors' Voice commander page (values verified live). */
const ATRAXA_PAGE = {
  container: {
    json_dict: {
      cardlists: [
        {
          tag: 'highsynergycards',
          header: 'High Synergy Cards',
          cardviews: [
            {
              id: '2d389264-e2d2-4589-9636-faa11fe46710',
              name: 'Tekuthal, Inquiry Dominus',
              num_decks: 29254,
              potential_decks: 44044,
              synergy: 0.27324462476485645,
            },
            {
              id: '1d58d08d-cd62-416d-8d8e-7d9c56d5c4da',
              name: 'Evolution Sage',
              num_decks: 26035,
              potential_decks: 44044,
              synergy: 0.24144745117464772,
            },
          ],
        },
        {
          tag: 'topcards',
          header: 'Top Cards',
          cardviews: [
            {
              id: 'b4e9c870-23c0-413a-ae39-265f09da16d1',
              name: 'Swords to Plowshares',
              num_decks: 24422,
              potential_decks: 44044,
              synergy: -0.024911612048699627,
            },
          ],
        },
      ],
    },
  },
}

describe('parseCommanderPage', () => {
  it('pulls out every list with its cards', () => {
    const data = parseCommanderPage(ATRAXA_PAGE)
    expect(data?.lists.map((list) => list.tag)).toEqual(['highsynergycards', 'topcards'])
    expect(data?.lists[0].header).toBe('High Synergy Cards')
    expect(data?.lists[0].cards[0]).toEqual({
      scryfallId: '2d389264-e2d2-4589-9636-faa11fe46710',
      name: 'Tekuthal, Inquiry Dominus',
      numDecks: 29254,
      potentialDecks: 44044,
      synergy: 0.27324462476485645,
    })
  })

  it('returns null for payloads that carry no lists', () => {
    expect(parseCommanderPage(null)).toBeNull()
    expect(parseCommanderPage({})).toBeNull()
    expect(parseCommanderPage({ container: {} })).toBeNull()
    expect(parseCommanderPage({ container: { json_dict: {} } })).toBeNull()
    expect(parseCommanderPage({ container: { json_dict: { cardlists: [] } } })).toBeNull()
  })

  it('returns null for a redirect stub rather than treating it as a page', () => {
    expect(parseCommanderPage({ redirect: '/commanders/thrasios-triton-hero-tymna-the-weaver' })).toBeNull()
  })

  it('skips unusable cards but keeps the rest of the list', () => {
    const data = parseCommanderPage({
      container: {
        json_dict: {
          cardlists: [
            {
              tag: 'creatures',
              header: 'Creatures',
              cardviews: [{ name: 'No id here' }, { id: 'card-1' }, { id: 'card-2', name: 'Real Card' }],
            },
          ],
        },
      },
    })
    expect(data?.lists[0].cards.map((card) => card.name)).toEqual(['Real Card'])
  })

  it('defaults missing statistics to zero rather than dropping the card', () => {
    const data = parseCommanderPage({
      container: { json_dict: { cardlists: [{ tag: 'topcards', cardviews: [{ id: 'card-1', name: 'Sol Ring' }] }] } },
    })
    expect(data?.lists[0].cards[0]).toEqual({
      scryfallId: 'card-1',
      name: 'Sol Ring',
      numDecks: 0,
      potentialDecks: 0,
      synergy: 0,
    })
    // A list with no header falls back to its tag, which is always present.
    expect(data?.lists[0].header).toBe('topcards')
  })

  it('drops lists that ended up empty', () => {
    const data = parseCommanderPage({
      container: {
        json_dict: {
          cardlists: [
            { tag: 'empty', header: 'Empty', cardviews: [] },
            { tag: 'good', header: 'Good', cardviews: [{ id: 'card-1', name: 'Sol Ring' }] },
          ],
        },
      },
    })
    expect(data?.lists.map((list) => list.tag)).toEqual(['good'])
  })
})

describe('topCommanderDeckCounts', () => {
  const page = (names: [string, number][]) => ({
    container: {
      json_dict: {
        cardlists: [
          {
            tag: 'topcommanders',
            header: 'Top Commanders',
            cardviews: names.map(([name, numDecks], i) => ({ id: `card-${i}`, name, num_decks: numDecks })),
          },
        ],
      },
    },
  })

  const countsFor = (names: [string, number][]) => {
    const data = parseCommanderPage(page(names))
    if (!data) throw new Error('fixture failed to parse')
    return topCommanderDeckCounts(topCommandersRanked(data))
  }

  it('ranks commanders by deck count, most-commanded first', () => {
    const data = parseCommanderPage(
      page([
        ['Krenko, Mob Boss', 43650],
        ['Edgar Markov', 50203],
        ["Atraxa, Praetors' Voice", 44044],
      ]),
    )!
    expect(topCommandersRanked(data).map((c) => c.name)).toEqual([
      'Edgar Markov',
      "Atraxa, Praetors' Voice",
      'Krenko, Mob Boss',
    ])
  })

  it('keys deck counts by lowercased name', () => {
    const counts = countsFor([['The Ur-Dragon', 50393]])
    expect(counts.get('the ur-dragon')).toBe(50393)
  })

  it('also indexes the front face of a double-faced or partner entry', () => {
    const counts = countsFor([['Thrasios, Triton Hero // Tymna the Weaver', 11551]])
    expect(counts.get('thrasios, triton hero // tymna the weaver')).toBe(11551)
    expect(counts.get('thrasios, triton hero')).toBe(11551)
  })

  it('does not let a front-face alias overwrite a commander listed in its own right', () => {
    const counts = countsFor([
      ['Thrasios, Triton Hero', 4000],
      ['Thrasios, Triton Hero // Tymna the Weaver', 11551],
    ])
    expect(counts.get('thrasios, triton hero')).toBe(4000)
  })
})

describe('commanderSlugCandidate', () => {
  it('slugifies a single commander', () => {
    expect(commanderSlugCandidate(["Atraxa, Praetors' Voice"])).toBe('atraxa-praetors-voice')
  })

  it('joins a partner pair in alphabetical order, matching EDHREC canonical slugs', () => {
    // Verified live: this ordering serves the page; the reverse returns a redirect stub.
    expect(commanderSlugCandidate(['Tymna the Weaver', 'Thrasios, Triton Hero'])).toBe(
      'thrasios-triton-hero-tymna-the-weaver',
    )
    expect(commanderSlugCandidate(['Thrasios, Triton Hero', 'Tymna the Weaver'])).toBe(
      'thrasios-triton-hero-tymna-the-weaver',
    )
  })

  it('ignores names that slugify to nothing', () => {
    expect(commanderSlugCandidate(['Sol Ring', '  '])).toBe('sol-ring')
  })

  it('returns an empty string with no commanders', () => {
    expect(commanderSlugCandidate([])).toBe('')
  })
})

describe('inclusionRate', () => {
  const rec = (numDecks: number, potentialDecks: number): EdhrecCardRec => ({
    scryfallId: 'x',
    name: 'x',
    numDecks,
    potentialDecks,
    synergy: 0,
  })

  it('is the share of eligible decks running the card', () => {
    expect(inclusionRate(rec(50, 200))).toBe(0.25)
  })

  it('is zero when EDHREC reports no potential decks, rather than dividing by zero', () => {
    expect(inclusionRate(rec(5, 0))).toBe(0)
  })
})

describe('sortEdhrecMatches', () => {
  const match = (name: string, numDecks: number, synergy: number, cmc: number, usd?: string): EdhrecMatch => ({
    rec: { scryfallId: name, name, numDecks, potentialDecks: 100, synergy },
    card: { name, cmc, prices: usd === undefined ? {} : { usd } } as unknown as ScryfallCard,
  })

  const alpha = match('Alpha', 10, 0.5, 4, '1.00')
  const bravo = match('Bravo', 90, -0.1, 1, '30.00')
  const charlie = match('Charlie', 50, 0.9, 2)

  const names = (matches: EdhrecMatch[]) => matches.map((m) => m.rec.name)

  it('sorts by inclusion rate, most included first', () => {
    expect(names(sortEdhrecMatches([alpha, bravo, charlie], 'inclusion'))).toEqual(['Bravo', 'Charlie', 'Alpha'])
  })

  it('sorts by synergy, highest first, including negatives', () => {
    expect(names(sortEdhrecMatches([alpha, bravo, charlie], 'synergy'))).toEqual(['Charlie', 'Alpha', 'Bravo'])
  })

  it('sorts by name and by mana value', () => {
    expect(names(sortEdhrecMatches([charlie, bravo, alpha], 'name'))).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(names(sortEdhrecMatches([alpha, bravo, charlie], 'cmc'))).toEqual(['Bravo', 'Charlie', 'Alpha'])
  })

  it('sorts unpriced cards last in both price directions', () => {
    expect(names(sortEdhrecMatches([alpha, bravo, charlie], 'price-asc'))).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(names(sortEdhrecMatches([alpha, bravo, charlie], 'price-desc'))).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('never mutates the input array', () => {
    const input = [alpha, bravo, charlie]
    sortEdhrecMatches(input, 'synergy')
    expect(names(input)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })
})
