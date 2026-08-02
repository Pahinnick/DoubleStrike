import { describe, expect, it } from 'vitest'
import type { RelatedCard } from '../api/scryfallTypes'
import type { CardSnapshot } from '../storage/cardCache'
import { collectDeckTokens } from './deckTokens'

function token(id: string, name: string, type_line = `Token Creature — ${name}`): RelatedCard {
  return { object: 'related_card', id, component: 'token', name, type_line, uri: `https://api.scryfall.com/cards/${id}` }
}

/** Minimal snapshot carrying only what collectDeckTokens reads. */
function snap(related_tokens?: RelatedCard[]): CardSnapshot {
  return {
    id: 'c-' + Math.random(),
    oracle_id: 'o',
    name: 'Card',
    mana_cost: '',
    cmc: 0,
    type_line: 'Creature',
    colors: [],
    color_identity: [],
    legalities: {},
    cachedAt: new Date().toISOString(),
    related_tokens,
  }
}

describe('collectDeckTokens', () => {
  it('dedupes the same token id across cards and counts sources', () => {
    const tokens = collectDeckTokens([snap([token('soldier', 'Soldier')]), snap([token('soldier', 'Soldier')])])
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ id: 'soldier', name: 'Soldier', sourceCount: 2 })
  })

  it('keeps distinct tokens and sorts by source count then name', () => {
    const tokens = collectDeckTokens([
      snap([token('treasure', 'Treasure', 'Token Artifact — Treasure')]),
      snap([token('soldier', 'Soldier'), token('treasure', 'Treasure', 'Token Artifact — Treasure')]),
      snap([token('angel', 'Angel')]),
    ])
    // treasure (2 sources) first, then angel/soldier (1 each) alphabetically.
    expect(tokens.map((t) => t.id)).toEqual(['treasure', 'angel', 'soldier'])
  })

  it('ignores snapshots with no related_tokens (older cache) and empty arrays', () => {
    expect(collectDeckTokens([snap(), snap([])])).toEqual([])
  })

  it('does not double-count a token a single card lists twice', () => {
    const tokens = collectDeckTokens([snap([token('clue', 'Clue', 'Token Artifact — Clue'), token('clue', 'Clue', 'Token Artifact — Clue')])])
    expect(tokens).toHaveLength(1)
    expect(tokens[0].sourceCount).toBe(1)
  })
})
