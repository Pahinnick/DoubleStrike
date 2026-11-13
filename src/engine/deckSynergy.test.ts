import { describe, expect, it } from 'vitest'
import {
  MIN_PAIR_DECKS,
  nameKey,
  parseCardPageCoplays,
  rankDeckSynergy,
  sortSynergyCandidates,
  type Coplay,
  type SynergySource,
} from './deckSynergy'

const view = (id: string, name: string, lift: number | undefined, numDecks = 1000, potential = 10000) => ({
  id,
  name,
  ...(lift === undefined ? {} : { lift }),
  num_decks: numDecks,
  potential_decks: potential,
})

describe('parseCardPageCoplays', () => {
  it('reads every list, skips entries without a lift (commander lists) and repeats', () => {
    const payload = {
      container: {
        json_dict: {
          cardlists: [
            { tag: 'topcommanders', cardviews: [view('c1', 'Edgar Markov', undefined)] },
            { tag: 'highliftcards', cardviews: [view('a', 'Blood Artist', 3, 2000, 8000)] },
            { tag: 'creatures', cardviews: [view('a', 'Blood Artist', 3), view('b', 'Viscera Seer', 2.5)] },
          ],
        },
      },
    }
    expect(parseCardPageCoplays(payload)).toEqual([
      { scryfallId: 'a', name: 'Blood Artist', lift: 3, numDecks: 2000, inclusion: 0.25 },
      { scryfallId: 'b', name: 'Viscera Seer', lift: 2.5, numDecks: 1000, inclusion: 0.1 },
    ])
  })

  it('is null for anything that is not a card page', () => {
    expect(parseCardPageCoplays(null)).toBeNull()
    expect(parseCardPageCoplays({ redirect: '/cards/x' })).toBeNull()
  })
})

const coplay = (name: string, lift: number, inclusion = 0.1, numDecks = 1000): Coplay => ({
  scryfallId: `id-${name}`,
  name,
  lift,
  numDecks,
  inclusion,
})

describe('rankDeckSynergy', () => {
  const sources: SynergySource[] = [
    { name: 'Skullclamp', coplays: [coplay('Blood Artist', 3, 0.3), coplay('Sol Ring', 1.0, 0.9), coplay('Fluke', 40, 0.01, 3)] },
    { name: 'Carrion Feeder', coplays: [coplay('Blood Artist', 2, 0.2), coplay('Sol Ring', 0.98, 0.85)] },
    { name: 'Viscera Seer', coplays: [coplay('Blood Artist', 4, 0.4), coplay('Ashnod\'s Altar', 5, 0.1)] },
  ]
  const ranked = rankDeckSynergy(sources, new Set([nameKey('Viscera Seer')]))
  const get = (name: string) => ranked.find((c) => c.name === name)!

  it('adds up synergy across every deck card a candidate pairs with', () => {
    expect(get('Blood Artist').synergy).toBeCloseTo(Math.log(3) + Math.log(2) + Math.log(4))
    expect(get('Blood Artist').pairsWith).toEqual(['Viscera Seer', 'Skullclamp', 'Carrion Feeder'])
    // Tied to one card, however strongly, ranks below a card tied to three.
    expect(get('Blood Artist').synergy).toBeGreaterThan(get("Ashnod's Altar").synergy)
  })

  it('ignores lifts from pairings seen in too few decks', () => {
    expect(MIN_PAIR_DECKS).toBeGreaterThan(3)
    expect(get('Fluke').synergy).toBe(0)
    expect(get('Fluke').pairsWith).toEqual([])
  })

  it('averages the play rate over every deck card looked up, not just those listing the card', () => {
    expect(get('Sol Ring').playRate).toBeCloseTo((0.9 + 0.85) / 3)
    expect(get('Sol Ring').synergy).toBe(0)
  })

  it('never suggests a card already in the deck', () => {
    expect(ranked.some((c) => c.name === 'Viscera Seer')).toBe(false)
  })

  it('ranks by synergy (dropping cards with none) or by play rate', () => {
    expect(sortSynergyCandidates(ranked, 'synergy').map((c) => c.name)).toEqual(['Blood Artist', "Ashnod's Altar"])
    expect(sortSynergyCandidates(ranked, 'played')[0].name).toBe('Sol Ring')
  })
})
