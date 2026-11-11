import { describe, expect, it } from 'vitest'
import { createEmptyDeck, deckReducer } from './deckReducer'

describe('deckReducer', () => {
  it('adds a new card to the mainboard by default', () => {
    const deck = createEmptyDeck('Test')
    const next = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    expect(next.cards).toEqual([{ scryfallId: 'abc', quantity: 1, board: 'mainboard' }])
  })

  it('increments quantity when the same card/board is added again', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    expect(deck.cards).toEqual([{ scryfallId: 'abc', quantity: 2, board: 'mainboard' }])
  })

  it('flags a new card as a token when the action says so', () => {
    const deck = createEmptyDeck('Test')
    const next = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'tok', category: 'Tokens', isToken: true })
    expect(next.cards).toEqual([{ scryfallId: 'tok', quantity: 1, board: 'mainboard', category: 'Tokens', isToken: true }])
  })

  it('creates a category supplied on ADD_CARD if the deck does not already have it', () => {
    const deck = createEmptyDeck('Test')
    const next = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc', category: 'Ramp' })
    expect(next.categories).toEqual(['Ramp'])
  })

  it('does not duplicate a category that already exists when adding a card into it', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CATEGORY', name: 'Ramp' })
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc', category: 'Ramp' })
    expect(deck.categories).toEqual(['Ramp'])
  })

  it('keeps mainboard and sideboard copies of the same card separate', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc', board: 'mainboard' })
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc', board: 'sideboard' })
    expect(deck.cards).toHaveLength(2)
  })

  it('removes a card entirely when quantity is set to zero', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    deck = deckReducer(deck, { type: 'SET_QUANTITY', scryfallId: 'abc', board: 'mainboard', quantity: 0 })
    expect(deck.cards).toEqual([])
  })

  it('removes a card via REMOVE_CARD', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    deck = deckReducer(deck, { type: 'REMOVE_CARD', scryfallId: 'abc', board: 'mainboard' })
    expect(deck.cards).toEqual([])
  })

  it('moves a card between boards', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc', board: 'mainboard' })
    deck = deckReducer(deck, {
      type: 'MOVE_CARD_BOARD',
      scryfallId: 'abc',
      fromBoard: 'mainboard',
      toBoard: 'sideboard',
    })
    expect(deck.cards).toEqual([{ scryfallId: 'abc', quantity: 1, board: 'sideboard' }])
  })

  it('moves single copies between boards, splitting and merging stacks', () => {
    let deck = createEmptyDeck('Test')
    for (let i = 0; i < 3; i++) deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc', board: 'sideboard' })
    deck = deckReducer(deck, { type: 'SET_CARD_FOIL', scryfallId: 'abc', board: 'sideboard', foil: 'classic' })
    deck = deckReducer(deck, { type: 'MOVE_CARD_COPIES', scryfallId: 'abc', fromBoard: 'sideboard', toBoard: 'mainboard', count: 1 })
    expect(deck.cards.find((c) => c.board === 'sideboard')?.quantity).toBe(2)
    expect(deck.cards.find((c) => c.board === 'mainboard')).toMatchObject({ quantity: 1, foil: 'classic' })
    deck = deckReducer(deck, { type: 'MOVE_CARD_COPIES', scryfallId: 'abc', fromBoard: 'sideboard', toBoard: 'mainboard', count: 5 })
    expect(deck.cards).toHaveLength(1)
    expect(deck.cards[0]).toMatchObject({ board: 'mainboard', quantity: 3 })
  })

  it('ignores a copy move with nothing to move', () => {
    const deck = createEmptyDeck('Test')
    expect(deckReducer(deck, { type: 'MOVE_CARD_COPIES', scryfallId: 'nope', fromBoard: 'sideboard', toBoard: 'mainboard', count: 1 })).toBe(deck)
  })

  it('renames the deck', () => {
    const deck = createEmptyDeck('Old Name')
    const next = deckReducer(deck, { type: 'RENAME_DECK', name: 'New Name' })
    expect(next.name).toBe('New Name')
  })

  it('replaces the whole deck on LOAD_DECK', () => {
    const deckA = createEmptyDeck('A')
    const deckB = createEmptyDeck('B')
    expect(deckReducer(deckA, { type: 'LOAD_DECK', deck: deckB })).toBe(deckB)
  })

  it('adds a category, ignoring duplicates case-insensitively', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CATEGORY', name: 'Removal' })
    deck = deckReducer(deck, { type: 'ADD_CATEGORY', name: 'removal' })
    expect(deck.categories).toEqual(['Removal'])
  })

  it('assigns a category to a card', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    deck = deckReducer(deck, { type: 'ADD_CATEGORY', name: 'Removal' })
    deck = deckReducer(deck, { type: 'SET_CARD_CATEGORY', scryfallId: 'abc', board: 'mainboard', category: 'Removal' })
    expect(deck.cards[0].category).toBe('Removal')
  })

  it('renames a category and updates cards using it', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    deck = deckReducer(deck, { type: 'ADD_CATEGORY', name: 'Removal' })
    deck = deckReducer(deck, { type: 'SET_CARD_CATEGORY', scryfallId: 'abc', board: 'mainboard', category: 'Removal' })
    deck = deckReducer(deck, { type: 'RENAME_CATEGORY', oldName: 'Removal', newName: 'Interaction' })
    expect(deck.categories).toEqual(['Interaction'])
    expect(deck.cards[0].category).toBe('Interaction')
  })

  it('removes a category and clears it from cards using it', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    deck = deckReducer(deck, { type: 'ADD_CATEGORY', name: 'Removal' })
    deck = deckReducer(deck, { type: 'SET_CARD_CATEGORY', scryfallId: 'abc', board: 'mainboard', category: 'Removal' })
    deck = deckReducer(deck, { type: 'REMOVE_CATEGORY', name: 'Removal' })
    expect(deck.categories).toEqual([])
    expect(deck.cards[0].category).toBeUndefined()
  })

  it('flags a mainboard card as the commander', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    deck = deckReducer(deck, { type: 'SET_COMMANDER', scryfallId: 'abc', board: 'mainboard', isCommander: true })
    expect(deck.cards[0].isCommander).toBe(true)
  })

  it('unflags a card as commander', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    deck = deckReducer(deck, { type: 'SET_COMMANDER', scryfallId: 'abc', board: 'mainboard', isCommander: true })
    deck = deckReducer(deck, { type: 'SET_COMMANDER', scryfallId: 'abc', board: 'mainboard', isCommander: false })
    expect(deck.cards[0].isCommander).toBe(false)
  })

  it('sets a colored mark on a card', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    deck = deckReducer(deck, { type: 'SET_CARD_MARK', scryfallId: 'abc', board: 'mainboard', mark: '#e5484d' })
    expect(deck.cards[0].mark).toBe('#e5484d')
  })

  it('clears a card\'s mark', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc' })
    deck = deckReducer(deck, { type: 'SET_CARD_MARK', scryfallId: 'abc', board: 'mainboard', mark: '#e5484d' })
    deck = deckReducer(deck, { type: 'SET_CARD_MARK', scryfallId: 'abc', board: 'mainboard', mark: undefined })
    expect(deck.cards[0].mark).toBeUndefined()
  })

  it('only marks the card on the matching board', () => {
    let deck = createEmptyDeck('Test')
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc', board: 'mainboard' })
    deck = deckReducer(deck, { type: 'ADD_CARD', scryfallId: 'abc', board: 'sideboard' })
    deck = deckReducer(deck, { type: 'SET_CARD_MARK', scryfallId: 'abc', board: 'mainboard', mark: '#4a90e2' })
    expect(deck.cards.find((c) => c.board === 'mainboard')?.mark).toBe('#4a90e2')
    expect(deck.cards.find((c) => c.board === 'sideboard')?.mark).toBeUndefined()
  })
})
