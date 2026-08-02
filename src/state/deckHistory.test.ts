import { describe, expect, it } from 'vitest'
import { deckHistoryReducer, initDeckHistory, type DeckHistoryState } from './deckHistory'
import { createEmptyDeck } from './deckReducer'

function withCard(state: DeckHistoryState, scryfallId: string): DeckHistoryState {
  return deckHistoryReducer(state, { type: 'ADD_CARD', scryfallId })
}

describe('deckHistoryReducer', () => {
  it('records edits and undoes them one step at a time', () => {
    let state = initDeckHistory(createEmptyDeck('Test'))
    state = withCard(state, 'a')
    state = withCard(state, 'b')
    expect(state.present.cards.map((c) => c.scryfallId)).toEqual(['a', 'b'])

    state = deckHistoryReducer(state, { type: 'UNDO' })
    expect(state.present.cards.map((c) => c.scryfallId)).toEqual(['a'])

    state = deckHistoryReducer(state, { type: 'UNDO' })
    expect(state.present.cards).toEqual([])
  })

  it('redoes an undone edit', () => {
    let state = initDeckHistory(createEmptyDeck('Test'))
    state = withCard(state, 'a')
    state = deckHistoryReducer(state, { type: 'UNDO' })
    expect(state.present.cards).toEqual([])
    state = deckHistoryReducer(state, { type: 'REDO' })
    expect(state.present.cards.map((c) => c.scryfallId)).toEqual(['a'])
  })

  it('is a no-op to undo with empty history or redo with nothing undone', () => {
    const state = initDeckHistory(createEmptyDeck('Test'))
    expect(deckHistoryReducer(state, { type: 'UNDO' })).toBe(state)
    expect(deckHistoryReducer(state, { type: 'REDO' })).toBe(state)
  })

  it('drops the redo stack once a new edit is made after an undo', () => {
    let state = initDeckHistory(createEmptyDeck('Test'))
    state = withCard(state, 'a')
    state = withCard(state, 'b')
    state = deckHistoryReducer(state, { type: 'UNDO' }) // back to [a], redo would restore b
    state = withCard(state, 'c') // new branch — b is no longer reachable
    expect(state.future).toEqual([])
    expect(state.present.cards.map((c) => c.scryfallId)).toEqual(['a', 'c'])
    const afterRedo = deckHistoryReducer(state, { type: 'REDO' })
    expect(afterRedo).toBe(state)
  })

  it('resets history on LOAD_DECK so undo cannot cross deck boundaries', () => {
    let state = initDeckHistory(createEmptyDeck('First'))
    state = withCard(state, 'a')
    const other = createEmptyDeck('Second')
    state = deckHistoryReducer(state, { type: 'LOAD_DECK', deck: other })
    expect(state.past).toEqual([])
    expect(state.future).toEqual([])
    expect(deckHistoryReducer(state, { type: 'UNDO' })).toBe(state)
    expect(state.present.id).toBe(other.id)
  })

  it('does not record a history entry for a no-op action', () => {
    let state = initDeckHistory(createEmptyDeck('Test'))
    state = deckHistoryReducer(state, { type: 'ADD_CATEGORY', name: 'Ramp' })
    const pastLen = state.past.length
    // Adding the same category again is a no-op in deckReducer (returns the same reference).
    state = deckHistoryReducer(state, { type: 'ADD_CATEGORY', name: 'Ramp' })
    expect(state.past.length).toBe(pastLen)
  })

  it('caps the undo history to a bounded length', () => {
    let state = initDeckHistory(createEmptyDeck('Test'))
    for (let i = 0; i < 60; i++) {
      state = deckHistoryReducer(state, { type: 'RENAME_DECK', name: `name-${i}` })
    }
    expect(state.past.length).toBeLessThanOrEqual(50)
    // Newest edit still wins even after older ones fall off the back.
    expect(state.present.name).toBe('name-59')
  })
})
