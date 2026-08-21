import { describe, expect, it } from 'vitest'
import type { Deck } from './types'
import {
  buildStartingCards,
  gameReducer,
  maxCommanderDamage,
  shuffle,
  startingLifeFor,
  zoneCards,
  OPENING_HAND_SIZE,
  type GameAction,
  type GameState,
} from './gameReducer'

function startCards(count: number, commanders = 0) {
  const cards = []
  for (let i = 0; i < commanders; i++) {
    cards.push({ instanceId: `cmd${i}`, scryfallId: `cmd-card-${i}`, zone: 'command' as const, isCommander: true, commanderTax: 0 })
  }
  for (let i = 0; i < count; i++) {
    cards.push({ instanceId: `c${i}`, scryfallId: `card-${i}`, zone: 'library' as const })
  }
  return cards
}

function startedGame(librarySize = 20, commanders = 0, startingLife = 20): GameState {
  return gameReducer({} as GameState, { type: 'START_GAME', cards: startCards(librarySize, commanders), startingLife })
}

function apply(state: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce(gameReducer, state)
}

describe('gameReducer', () => {
  it('START_GAME draws an opening hand of 7 and sets life/turn', () => {
    const state = startedGame(20, 0, 40)
    expect(zoneCards(state, 'hand')).toHaveLength(OPENING_HAND_SIZE)
    expect(zoneCards(state, 'library')).toHaveLength(13)
    expect(state.life).toBe(40)
    expect(state.turn).toBe(1)
    expect(state.mulligans).toBe(0)
  })

  it('START_GAME leaves commanders in the command zone, not the drawn hand', () => {
    const state = startedGame(20, 1)
    expect(zoneCards(state, 'command')).toHaveLength(1)
    expect(zoneCards(state, 'hand').some((c) => c.instanceId === 'cmd0')).toBe(false)
  })

  it('DRAW takes from the top of the library in order', () => {
    const state = apply(startedGame(20), { type: 'DRAW', count: 2 })
    expect(zoneCards(state, 'hand')).toHaveLength(9)
    // Opening hand took c0..c6, so the next two drawn are c7 and c8.
    const handIds = zoneCards(state, 'hand').map((c) => c.instanceId)
    expect(handIds).toContain('c7')
    expect(handIds).toContain('c8')
    expect(zoneCards(state, 'library')[0].instanceId).toBe('c9')
  })

  it('DRAW always lands the new card(s) in the leftmost hand slot, not wherever their original deck order falls', () => {
    // c0..c6 is the opening hand, drawn in their deck-list order — that order isn't what's under
    // test here, just a fixture. What matters is that the *next* draw (c7) ends up at hand[0],
    // ahead of every card already in hand, instead of wherever c7 would otherwise sort.
    const state = apply(startedGame(20), { type: 'DRAW', count: 1 })
    expect(zoneCards(state, 'hand')[0].instanceId).toBe('c7')
  })

  it('DRAW of multiple cards at once places the top card leftmost, in library order', () => {
    const state = apply(startedGame(20), { type: 'DRAW', count: 3 })
    const handIds = zoneCards(state, 'hand')
      .slice(0, 3)
      .map((c) => c.instanceId)
    expect(handIds).toEqual(['c7', 'c8', 'c9'])
  })

  it('DRAW on an empty library is a no-op instead of erroring', () => {
    const state = apply(startedGame(7), { type: 'DRAW', count: 3 })
    expect(zoneCards(state, 'hand')).toHaveLength(7)
    expect(zoneCards(state, 'library')).toHaveLength(0)
  })

  it('MULLIGAN reshuffles hand into library and draws back to a full hand (London mulligan)', () => {
    const before = startedGame(20)
    const handAndLibrary = [...zoneCards(before, 'hand'), ...zoneCards(before, 'library')].map((c) => c.instanceId)
    const state = gameReducer(before, { type: 'MULLIGAN', shuffledOrder: [...handAndLibrary].reverse() })
    expect(state.mulligans).toBe(1)
    expect(zoneCards(state, 'hand')).toHaveLength(7)
    expect(zoneCards(state, 'library')).toHaveLength(13)
    // New library order follows shuffledOrder: reversed, so the last original card is drawn first.
    expect(zoneCards(state, 'hand')[0].instanceId).toBe(handAndLibrary[handAndLibrary.length - 1])
  })

  it('MULLIGAN keeps drawing a full hand every time, not a shrinking one', () => {
    let state = startedGame(20)
    for (let i = 0; i < 5; i++) {
      const ids = [...zoneCards(state, 'hand'), ...zoneCards(state, 'library')].map((c) => c.instanceId)
      state = gameReducer(state, { type: 'MULLIGAN', shuffledOrder: ids })
    }
    expect(state.mulligans).toBe(5)
    expect(zoneCards(state, 'hand')).toHaveLength(7)
  })

  it('SHUFFLE_LIBRARY reorders only the library, leaving other zones untouched', () => {
    const before = startedGame(20)
    const libraryIds = zoneCards(before, 'library').map((c) => c.instanceId)
    const handIdsBefore = zoneCards(before, 'hand').map((c) => c.instanceId)
    const state = gameReducer(before, { type: 'SHUFFLE_LIBRARY', shuffledOrder: [...libraryIds].reverse() })
    expect(zoneCards(state, 'library').map((c) => c.instanceId)).toEqual([...libraryIds].reverse())
    expect(zoneCards(state, 'hand').map((c) => c.instanceId)).toEqual(handIdsBefore)
  })

  it('REORDER_HAND reorders only the hand, leaving other zones untouched', () => {
    const before = startedGame(20)
    const handIds = zoneCards(before, 'hand').map((c) => c.instanceId)
    const libraryIdsBefore = zoneCards(before, 'library').map((c) => c.instanceId)
    const state = gameReducer(before, { type: 'REORDER_HAND', orderedInstanceIds: [...handIds].reverse() })
    expect(zoneCards(state, 'hand').map((c) => c.instanceId)).toEqual([...handIds].reverse())
    expect(zoneCards(state, 'library').map((c) => c.instanceId)).toEqual(libraryIdsBefore)
  })

  it('REORDER_HAND moves a single card to a new position, leaving the rest in relative order', () => {
    const before = startedGame(20)
    const [a, b, c, d, e, f, g] = zoneCards(before, 'hand').map((card) => card.instanceId)
    // Move `a` (originally first) to just before `d`.
    const state = gameReducer(before, { type: 'REORDER_HAND', orderedInstanceIds: [b, c, a, d, e, f, g] })
    expect(zoneCards(state, 'hand').map((card) => card.instanceId)).toEqual([b, c, a, d, e, f, g])
  })

  it('MOVE_CARD to battlefield keeps position; leaving battlefield clears tap and position', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    let state = gameReducer(before, { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 25, y: 50 })
    const onField = state.cards.find((c) => c.instanceId === cardId)!
    expect(onField.zone).toBe('battlefield')
    expect(onField.x).toBe(25)
    expect(onField.y).toBe(50)

    state = apply(
      state,
      { type: 'SET_TAPPED', instanceId: cardId, tapped: true },
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'graveyard' },
    )
    const inYard = state.cards.find((c) => c.instanceId === cardId)!
    expect(inYard.zone).toBe('graveyard')
    expect(inYard.tapped).toBe(false)
    expect(inYard.x).toBeUndefined()
  })

  it('MOVE_CARD to library top makes it the next draw; bottom makes it the last', () => {
    const before = startedGame(20)
    const [first, second] = zoneCards(before, 'hand').map((c) => c.instanceId)

    let state = gameReducer(before, { type: 'MOVE_CARD', instanceId: first, toZone: 'library', libraryPosition: 'top' })
    expect(zoneCards(state, 'library')[0].instanceId).toBe(first)

    state = gameReducer(state, { type: 'MOVE_CARD', instanceId: second, toZone: 'library', libraryPosition: 'bottom' })
    const library = zoneCards(state, 'library')
    expect(library[library.length - 1].instanceId).toBe(second)
  })

  it('SET_POSITION moves a battlefield card and brings it to the front of the render order', () => {
    const before = startedGame(20)
    const [a, b] = zoneCards(before, 'hand').map((c) => c.instanceId)
    let state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: a, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'MOVE_CARD', instanceId: b, toZone: 'battlefield', x: 10, y: 10 },
    )
    state = gameReducer(state, { type: 'SET_POSITION', instanceId: a, x: 30, y: 40 })
    const field = zoneCards(state, 'battlefield')
    expect(field[field.length - 1].instanceId).toBe(a)
    expect(field[field.length - 1].x).toBe(30)
  })

  it('SET_POSITION ignores cards not on the battlefield', () => {
    const before = startedGame(20)
    const handCard = zoneCards(before, 'hand')[0].instanceId
    const state = gameReducer(before, { type: 'SET_POSITION', instanceId: handCard, x: 10, y: 10 })
    expect(state).toBe(before)
  })

  it('RECEIVE_RELOCATED_CARD moves a battlefield card and brings it to the front of the render order, same as SET_POSITION', () => {
    const before = startedGame(20)
    const [a, b] = zoneCards(before, 'hand').map((c) => c.instanceId)
    let state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: a, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'MOVE_CARD', instanceId: b, toZone: 'battlefield', x: 10, y: 10 },
    )
    state = gameReducer(state, { type: 'RECEIVE_RELOCATED_CARD', instanceId: a, x: 30, y: 40 })
    const field = zoneCards(state, 'battlefield')
    expect(field[field.length - 1].instanceId).toBe(a)
    expect(field[field.length - 1].x).toBe(30)
  })

  it('RECEIVE_RELOCATED_CARD ignores cards not on the battlefield', () => {
    const before = startedGame(20)
    const handCard = zoneCards(before, 'hand')[0].instanceId
    const state = gameReducer(before, { type: 'RECEIVE_RELOCATED_CARD', instanceId: handCard, x: 10, y: 10 })
    expect(state).toBe(before)
  })

  it('RECEIVE_RELOCATED_CARD ignores an unknown instanceId', () => {
    const before = startedGame(20)
    const state = gameReducer(before, { type: 'RECEIVE_RELOCATED_CARD', instanceId: 'no-such-card', x: 10, y: 10 })
    expect(state).toBe(before)
  })

  it('RECEIVE_RELOCATED_CARD carries atSeat through — dropped onto a different quadrant than our own', () => {
    const before = startedGame(20)
    const a = zoneCards(before, 'hand')[0].instanceId
    let state = gameReducer(before, { type: 'MOVE_CARD', instanceId: a, toZone: 'battlefield', x: 0, y: 0 })
    state = gameReducer(state, { type: 'RECEIVE_RELOCATED_CARD', instanceId: a, x: 30, y: 40, atSeat: 2 })
    expect(state.cards.find((c) => c.instanceId === a)).toMatchObject({ x: 30, y: 40, atSeat: 2 })
  })

  it('RECEIVE_RELOCATED_CARD with atSeat omitted clears a previous relocation back to the card\'s own seat', () => {
    const before = startedGame(20)
    const a = zoneCards(before, 'hand')[0].instanceId
    let state = gameReducer(before, { type: 'MOVE_CARD', instanceId: a, toZone: 'battlefield', x: 0, y: 0 })
    state = gameReducer(state, { type: 'RECEIVE_RELOCATED_CARD', instanceId: a, x: 30, y: 40, atSeat: 2 })
    state = gameReducer(state, { type: 'RECEIVE_RELOCATED_CARD', instanceId: a, x: 5, y: 5 })
    expect(state.cards.find((c) => c.instanceId === a)).toMatchObject({ x: 5, y: 5, atSeat: undefined })
  })

  it('UNTAP_ALL untaps only battlefield cards', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    const state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'SET_TAPPED', instanceId: cardId, tapped: true },
      { type: 'UNTAP_ALL' },
    )
    expect(state.cards.find((c) => c.instanceId === cardId)!.tapped).toBe(false)
  })

  it('NEXT_TURN increments the turn, untaps, and draws one', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    const state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'SET_TAPPED', instanceId: cardId, tapped: true },
      { type: 'NEXT_TURN' },
    )
    expect(state.turn).toBe(2)
    expect(state.cards.find((c) => c.instanceId === cardId)!.tapped).toBe(false)
    // 7 opening - 1 to battlefield + 1 drawn
    expect(zoneCards(state, 'hand')).toHaveLength(7)
  })

  it('ADJUST_LIFE applies a relative change and accumulates across dispatches', () => {
    // Delta-based (not "compute the new total and dispatch it") specifically so rapid clicks on the
    // life bubble in PlaytestView can't drop increments to a stale closure of the old total.
    const state = apply(
      startedGame(20),
      { type: 'ADJUST_LIFE', delta: -3 },
      { type: 'ADJUST_LIFE', delta: -3 },
      { type: 'ADJUST_LIFE', delta: -3 },
    )
    expect(state.life).toBe(20 - 9)
  })

  it('START_GAME initializes commander damage empty and poison to 0', () => {
    const state = startedGame(20)
    expect(state.commanderDamage).toEqual({})
    expect(state.poison).toBe(0)
  })

  it('REMOVE_CARD drops a card (used when giving it away)', () => {
    const state = startedGame(20)
    const target = zoneCards(state, 'library')[0]
    const next = gameReducer(state, { type: 'REMOVE_CARD', instanceId: target.instanceId })
    expect(next.cards.some((c) => c.instanceId === target.instanceId)).toBe(false)
    expect(next.cards).toHaveLength(state.cards.length - 1)
  })

  it('RECEIVE_GIVEN_CARD adds a foreign card to the battlefield with its owner seat', () => {
    const state = startedGame(20)
    const next = gameReducer(state, {
      type: 'RECEIVE_GIVEN_CARD',
      card: { instanceId: 'given-1', scryfallId: 'foreign', ownerSeat: 2, x: 40, y: 50, tapped: true },
    })
    const added = next.cards.find((c) => c.instanceId === 'given-1')
    expect(added).toMatchObject({ zone: 'battlefield', ownerSeat: 2, tapped: true, x: 40, y: 50 })
    // A duplicate delivery of the same instance is ignored.
    const again = gameReducer(next, {
      type: 'RECEIVE_GIVEN_CARD',
      card: { instanceId: 'given-1', scryfallId: 'foreign', ownerSeat: 2, x: 40, y: 50, tapped: true },
    })
    expect(again.cards.filter((c) => c.instanceId === 'given-1')).toHaveLength(1)
  })

  it('ADJUST_COMMANDER_DAMAGE tracks damage per source seat, clamped at 0', () => {
    let state = gameReducer(startedGame(20), { type: 'ADJUST_COMMANDER_DAMAGE', fromSeat: 2, delta: 21 })
    expect(state.commanderDamage[2]).toBe(21)
    // A different source accumulates independently.
    state = gameReducer(state, { type: 'ADJUST_COMMANDER_DAMAGE', fromSeat: 3, delta: 5 })
    expect(state.commanderDamage).toEqual({ 2: 21, 3: 5 })
    expect(maxCommanderDamage(state.commanderDamage)).toBe(21)
    const clamped = gameReducer(state, { type: 'ADJUST_COMMANDER_DAMAGE', fromSeat: 2, delta: -100 })
    expect(clamped.commanderDamage[2]).toBe(0)
    expect(clamped.commanderDamage[3]).toBe(5)
  })

  it('ADJUST_POISON applies a relative change, clamped at 0', () => {
    const state = gameReducer(startedGame(20), { type: 'ADJUST_POISON', delta: 10 })
    expect(state.poison).toBe(10)
    const clamped = gameReducer(state, { type: 'ADJUST_POISON', delta: -100 })
    expect(clamped.poison).toBe(0)
  })

  it('START_GAME starts with an empty floating mana pool', () => {
    const state = startedGame(20)
    expect(state.floatingMana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
  })

  it('ADJUST_FLOATING_MANA applies a relative change to one color, clamped at 0, without touching the others', () => {
    const state = apply(startedGame(20), { type: 'ADJUST_FLOATING_MANA', color: 'R', delta: 5 })
    expect(state.floatingMana.R).toBe(5)
    expect(state.floatingMana.U).toBe(0)
    const clamped = gameReducer(state, { type: 'ADJUST_FLOATING_MANA', color: 'R', delta: -100 })
    expect(clamped.floatingMana.R).toBe(0)
  })

  it('CLEAR_FLOATING_MANA zeroes every color at once', () => {
    const state = apply(
      startedGame(20),
      { type: 'ADJUST_FLOATING_MANA', color: 'R', delta: 3 },
      { type: 'ADJUST_FLOATING_MANA', color: 'G', delta: 2 },
      { type: 'CLEAR_FLOATING_MANA' },
    )
    expect(state.floatingMana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
  })

  it('NEXT_TURN empties the floating mana pool, matching real Magic (mana does not carry over)', () => {
    const state = apply(startedGame(20), { type: 'ADJUST_FLOATING_MANA', color: 'G', delta: 7 }, { type: 'NEXT_TURN' })
    expect(state.floatingMana.G).toBe(0)
  })

  it('ADJUST_COMMANDER_TAX adjusts one commander independently of the other, clamped at 0', () => {
    const state = startedGame(20, 2)
    const taxed = gameReducer(state, { type: 'ADJUST_COMMANDER_TAX', instanceId: 'cmd0', delta: 2 })
    expect(taxed.cards.find((c) => c.instanceId === 'cmd0')?.commanderTax).toBe(2)
    expect(taxed.cards.find((c) => c.instanceId === 'cmd1')?.commanderTax).toBe(0)
    const clamped = gameReducer(taxed, { type: 'ADJUST_COMMANDER_TAX', instanceId: 'cmd0', delta: -100 })
    expect(clamped.cards.find((c) => c.instanceId === 'cmd0')?.commanderTax).toBe(0)
  })

  it('commander tax survives a zone change, unlike battlefield-only counters', () => {
    const state = startedGame(20, 1)
    const taxed = gameReducer(state, { type: 'ADJUST_COMMANDER_TAX', instanceId: 'cmd0', delta: 2 })
    const onField = gameReducer(taxed, { type: 'MOVE_CARD', instanceId: 'cmd0', toZone: 'battlefield', x: 0, y: 0 })
    expect(onField.cards.find((c) => c.instanceId === 'cmd0')?.commanderTax).toBe(2)
    const backInCommand = gameReducer(onField, { type: 'MOVE_CARD', instanceId: 'cmd0', toZone: 'command' })
    expect(backInCommand.cards.find((c) => c.instanceId === 'cmd0')?.commanderTax).toBe(2)
  })

  it('CREATE_TOKEN clones a battlefield card onto the battlefield as a token', () => {
    const before = startedGame(20)
    const sourceId = zoneCards(before, 'hand')[0].instanceId
    const state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: sourceId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'CREATE_TOKEN', sourceInstanceId: sourceId, x: 10, y: 10 },
    )
    const field = zoneCards(state, 'battlefield')
    expect(field).toHaveLength(2)
    const token = field.find((c) => c.instanceId !== sourceId)!
    expect(token.isToken).toBe(true)
    expect(token.scryfallId).toBe(zoneCards(before, 'hand')[0].scryfallId)
    expect(token.x).toBe(10)
    expect(token.y).toBe(10)
  })

  it('ADD_TOKEN puts a fresh token on the battlefield from a scryfallId', () => {
    const before = startedGame(20)
    const state = gameReducer(before, { type: 'ADD_TOKEN', scryfallId: 'token-soldier', x: 30, y: 40 })
    const field = zoneCards(state, 'battlefield')
    expect(field).toHaveLength(1)
    expect(field[0].isToken).toBe(true)
    expect(field[0].scryfallId).toBe('token-soldier')
    expect(field[0].zone).toBe('battlefield')
    expect(field[0].x).toBe(30)
    expect(field[0].y).toBe(40)
  })

  it('an ADD_TOKEN token ceases to exist once it leaves the battlefield', () => {
    const before = startedGame(20)
    let state = gameReducer(before, { type: 'ADD_TOKEN', scryfallId: 'token-soldier', x: 0, y: 0 })
    const tokenId = zoneCards(state, 'battlefield')[0].instanceId
    state = gameReducer(state, { type: 'MOVE_CARD', instanceId: tokenId, toZone: 'graveyard' })
    expect(state.cards.some((c) => c.instanceId === tokenId)).toBe(false)
  })

  it('FLIP_CARD toggles showBackFace for a battlefield card', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    let state = apply(before, { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 })
    expect(state.cards.find((c) => c.instanceId === cardId)!.showBackFace).toBeUndefined()
    state = gameReducer(state, { type: 'FLIP_CARD', instanceId: cardId })
    expect(state.cards.find((c) => c.instanceId === cardId)!.showBackFace).toBe(true)
    state = gameReducer(state, { type: 'FLIP_CARD', instanceId: cardId })
    expect(state.cards.find((c) => c.instanceId === cardId)!.showBackFace).toBe(false)
  })

  it('FLIP_CARD is a no-op for a card not on the battlefield', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    const state = gameReducer(before, { type: 'FLIP_CARD', instanceId: cardId })
    expect(state).toBe(before)
  })

  it('a flipped card resets to its front face when it leaves the battlefield', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    let state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'FLIP_CARD', instanceId: cardId },
    )
    expect(state.cards.find((c) => c.instanceId === cardId)!.showBackFace).toBe(true)
    state = gameReducer(state, { type: 'MOVE_CARD', instanceId: cardId, toZone: 'graveyard' })
    expect(state.cards.find((c) => c.instanceId === cardId)!.showBackFace).toBeUndefined()
  })

  it('SET_FACE_DOWN sets faceDown for a battlefield card', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    let state = apply(before, { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 })
    expect(state.cards.find((c) => c.instanceId === cardId)!.faceDown).toBeUndefined()
    state = gameReducer(state, { type: 'SET_FACE_DOWN', instanceId: cardId, faceDown: true })
    expect(state.cards.find((c) => c.instanceId === cardId)!.faceDown).toBe(true)
    state = gameReducer(state, { type: 'SET_FACE_DOWN', instanceId: cardId, faceDown: false })
    expect(state.cards.find((c) => c.instanceId === cardId)!.faceDown).toBe(false)
  })

  it('SET_FACE_DOWN is a no-op for a card not on the battlefield', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    const state = gameReducer(before, { type: 'SET_FACE_DOWN', instanceId: cardId, faceDown: true })
    expect(state).toBe(before)
  })

  it('a face-down card is revealed (faceDown reset) when it leaves the battlefield', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    let state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'SET_FACE_DOWN', instanceId: cardId, faceDown: true },
    )
    expect(state.cards.find((c) => c.instanceId === cardId)!.faceDown).toBe(true)
    state = gameReducer(state, { type: 'MOVE_CARD', instanceId: cardId, toZone: 'graveyard' })
    expect(state.cards.find((c) => c.instanceId === cardId)!.faceDown).toBeUndefined()
  })

  it('CREATE_TOKEN is a no-op for a source not on the battlefield', () => {
    const before = startedGame(20)
    const sourceId = zoneCards(before, 'hand')[0].instanceId
    const state = gameReducer(before, { type: 'CREATE_TOKEN', sourceInstanceId: sourceId, x: 0, y: 0 })
    expect(state).toBe(before)
  })

  it('a token ceases to exist once MOVE_CARD sends it off the battlefield', () => {
    const before = startedGame(20)
    const sourceId = zoneCards(before, 'hand')[0].instanceId
    let state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: sourceId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'CREATE_TOKEN', sourceInstanceId: sourceId, x: 10, y: 10 },
    )
    const tokenId = zoneCards(state, 'battlefield').find((c) => c.instanceId !== sourceId)!.instanceId
    const totalBefore = state.cards.length
    state = gameReducer(state, { type: 'MOVE_CARD', instanceId: tokenId, toZone: 'graveyard' })
    expect(state.cards.some((c) => c.instanceId === tokenId)).toBe(false)
    expect(state.cards).toHaveLength(totalBefore - 1)
  })

  it('a token repositioned within the battlefield via SET_POSITION is unaffected', () => {
    const before = startedGame(20)
    const sourceId = zoneCards(before, 'hand')[0].instanceId
    let state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: sourceId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'CREATE_TOKEN', sourceInstanceId: sourceId, x: 10, y: 10 },
    )
    const tokenId = zoneCards(state, 'battlefield').find((c) => c.instanceId !== sourceId)!.instanceId
    state = gameReducer(state, { type: 'SET_POSITION', instanceId: tokenId, x: 50, y: 50 })
    const token = state.cards.find((c) => c.instanceId === tokenId)!
    expect(token.zone).toBe('battlefield')
    expect(token.x).toBe(50)
  })

  it('ADD_COUNTER_PILE creates a pile at 1, ADJUST_COUNTER_PILE accumulates a signed running total', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    let state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'ADD_COUNTER_PILE', instanceId: cardId, color: 'green' },
    )
    const pileId = state.cards.find((c) => c.instanceId === cardId)!.counters![0].id
    state = apply(
      state,
      { type: 'ADJUST_COUNTER_PILE', instanceId: cardId, pileId, delta: 1 },
      { type: 'ADJUST_COUNTER_PILE', instanceId: cardId, pileId, delta: -1 },
    )
    expect(state.cards.find((c) => c.instanceId === cardId)!.counters).toEqual([{ id: pileId, color: 'green', value: 1 }])
  })

  it('ADD_COUNTER_PILE ignores cards not on the battlefield', () => {
    const before = startedGame(20)
    const handCard = zoneCards(before, 'hand')[0].instanceId
    const state = gameReducer(before, { type: 'ADD_COUNTER_PILE', instanceId: handCard, color: 'green' })
    expect(state).toBe(before)
  })

  it('a card can carry multiple differently-colored counter piles at once', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    const state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'ADD_COUNTER_PILE', instanceId: cardId, color: 'green' },
      { type: 'ADD_COUNTER_PILE', instanceId: cardId, color: 'blue' },
    )
    const piles = state.cards.find((c) => c.instanceId === cardId)!.counters!
    expect(piles.map((p) => p.color)).toEqual(['green', 'blue'])
    expect(piles.every((p) => p.value === 1)).toBe(true)
  })

  it('REMOVE_COUNTER_PILE deletes just that pile, normalizing to undefined once the last one is gone', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    let state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'ADD_COUNTER_PILE', instanceId: cardId, color: 'green' },
    )
    const pileId = state.cards.find((c) => c.instanceId === cardId)!.counters![0].id
    state = gameReducer(state, { type: 'REMOVE_COUNTER_PILE', instanceId: cardId, pileId })
    expect(state.cards.find((c) => c.instanceId === cardId)!.counters).toBeUndefined()
  })

  it('counters are cleared when a permanent leaves the battlefield', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    const state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'ADD_COUNTER_PILE', instanceId: cardId, color: 'green' },
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'graveyard' },
    )
    expect(state.cards.find((c) => c.instanceId === cardId)!.counters).toBeUndefined()
  })

  it('ADD_PT_COUNTER_PILE creates a pile at +1/+1, ADJUST_PT_COUNTER_PILE can move power and toughness together', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    let state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'ADD_PT_COUNTER_PILE', instanceId: cardId, color: 'green' },
    )
    const pileId = state.cards.find((c) => c.instanceId === cardId)!.ptCounters![0].id
    state = gameReducer(state, { type: 'ADJUST_PT_COUNTER_PILE', instanceId: cardId, pileId, powerDelta: 1, toughnessDelta: 1 })
    expect(state.cards.find((c) => c.instanceId === cardId)!.ptCounters).toEqual([{ id: pileId, color: 'green', power: 2, toughness: 2 }])
  })

  // Real gap reported: no way to represent an asymmetric bonus like an Equipment's +1/+0 — the
  // old ADJUST_PT_COUNTER_PILE always moved power and toughness by the same delta.
  it('ADJUST_PT_COUNTER_PILE moves power and toughness independently, so a +1/+1 pile can become +1/+0', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    let state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'ADD_PT_COUNTER_PILE', instanceId: cardId, color: 'green' },
    )
    const pileId = state.cards.find((c) => c.instanceId === cardId)!.ptCounters![0].id
    state = gameReducer(state, { type: 'ADJUST_PT_COUNTER_PILE', instanceId: cardId, pileId, powerDelta: 0, toughnessDelta: -1 })
    expect(state.cards.find((c) => c.instanceId === cardId)!.ptCounters).toEqual([{ id: pileId, color: 'green', power: 1, toughness: 0 }])
  })

  it('ADD_PT_COUNTER_PILE ignores cards not on the battlefield', () => {
    const before = startedGame(20)
    const handCard = zoneCards(before, 'hand')[0].instanceId
    const state = gameReducer(before, { type: 'ADD_PT_COUNTER_PILE', instanceId: handCard, color: 'green' })
    expect(state).toBe(before)
  })

  it('ptCounters are cleared when a permanent leaves the battlefield', () => {
    const before = startedGame(20)
    const cardId = zoneCards(before, 'hand')[0].instanceId
    const state = apply(
      before,
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'battlefield', x: 0, y: 0 },
      { type: 'ADD_PT_COUNTER_PILE', instanceId: cardId, color: 'red' },
      { type: 'MOVE_CARD', instanceId: cardId, toZone: 'graveyard' },
    )
    expect(state.cards.find((c) => c.instanceId === cardId)!.ptCounters).toBeUndefined()
  })

  it('RECEIVE_GIVEN_CARD carries counter piles through', () => {
    const state = gameReducer(startedGame(20), {
      type: 'RECEIVE_GIVEN_CARD',
      card: {
        instanceId: 'given-pt',
        scryfallId: 'foreign',
        ownerSeat: 1,
        x: 0,
        y: 0,
        tapped: false,
        ptCounters: [{ id: 'pt-1', color: 'green', power: 3, toughness: -1 }],
      },
    })
    expect(state.cards.find((c) => c.instanceId === 'given-pt')!.ptCounters).toEqual([{ id: 'pt-1', color: 'green', power: 3, toughness: -1 }])
  })

  it('RECEIVE_GIVEN_CARD carries faceDown through — the recipient legitimately learns a face-down card given directly to them', () => {
    const state = gameReducer(startedGame(20), {
      type: 'RECEIVE_GIVEN_CARD',
      card: {
        instanceId: 'given-facedown',
        scryfallId: 'secret-morph',
        ownerSeat: 1,
        x: 0,
        y: 0,
        tapped: false,
        faceDown: true,
      },
    })
    expect(state.cards.find((c) => c.instanceId === 'given-facedown')!.faceDown).toBe(true)
  })

  it('START_GAME starts with revealTopOfLibrary off', () => {
    expect(startedGame(20).revealTopOfLibrary).toBe(false)
  })

  it('TOGGLE_REVEAL_TOP flips the flag each time', () => {
    const once = apply(startedGame(20), { type: 'TOGGLE_REVEAL_TOP' })
    expect(once.revealTopOfLibrary).toBe(true)
    const twice = apply(once, { type: 'TOGGLE_REVEAL_TOP' })
    expect(twice.revealTopOfLibrary).toBe(false)
  })

  it('START_GAME starts with revealHand off', () => {
    expect(startedGame(20).revealHand).toBe(false)
  })

  it('TOGGLE_REVEAL_HAND flips the flag each time', () => {
    const once = apply(startedGame(20), { type: 'TOGGLE_REVEAL_HAND' })
    expect(once.revealHand).toBe(true)
    const twice = apply(once, { type: 'TOGGLE_REVEAL_HAND' })
    expect(twice.revealHand).toBe(false)
  })

  it('START_GAME initializes scooped to false', () => {
    expect(startedGame(20).scooped).toBe(false)
  })

  it('SCOOP marks the game conceded, without touching cards or life', () => {
    const before = startedGame(20)
    const state = apply(before, { type: 'SCOOP' })
    expect(state.scooped).toBe(true)
    expect(state.life).toBe(before.life)
    expect(state.cards).toEqual(before.cards)
  })

  it('RESTORE_STATE replaces the whole state wholesale — the single-level undo primitive', () => {
    const before = startedGame(20)
    const after = apply(before, { type: 'ADJUST_LIFE', delta: -5 })
    expect(after.life).toBe(15)
    const restored = gameReducer(after, { type: 'RESTORE_STATE', state: before })
    expect(restored).toBe(before)
    expect(restored.life).toBe(20)
  })

  it('RESTORE_STATE backfills floatingMana for a pre-existing save from before that field existed', () => {
    // A solo autosave (see soloGameStorage.ts) can be older than a since-added GameState field —
    // simulate that by stripping it, the same way `JSON.parse(localStorage...)` of an old save
    // would produce a state object with the key simply absent.
    const before = startedGame(20)
    const legacySave = { ...before } as typeof before
    // @ts-expect-error simulating a pre-floatingMana persisted save
    delete legacySave.floatingMana
    const restored = gameReducer(before, { type: 'RESTORE_STATE', state: legacySave })
    expect(restored.floatingMana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
  })

  it('RESTORE_STATE is exempt from the dev-only card-conservation invariant (undoing a give/remove legitimately changes counts)', () => {
    const before = startedGame(20)
    const target = zoneCards(before, 'library')[0]
    const removed = apply(before, { type: 'REMOVE_CARD', instanceId: target.instanceId })
    expect(removed.cards).toHaveLength(before.cards.length - 1)
    // Restoring back to `before` re-adds a card relative to `removed` — should not console.error.
    const restored = gameReducer(removed, { type: 'RESTORE_STATE', state: before })
    expect(restored.cards).toHaveLength(before.cards.length)
  })
})

describe('buildStartingCards', () => {
  const deck: Deck = {
    id: 'd1',
    name: 'Test',
    format: 'commander',
    cards: [
      { scryfallId: 'cmdr', quantity: 1, board: 'mainboard', isCommander: true },
      { scryfallId: 'bolt', quantity: 4, board: 'mainboard' },
      { scryfallId: 'wish', quantity: 2, board: 'sideboard' },
      { scryfallId: 'soldier-token', quantity: 1, board: 'mainboard', category: 'Token Cards', isToken: true },
    ],
    categories: [],
    createdAt: '',
    updatedAt: '',
  }

  it('expands quantities into per-copy instances and excludes the sideboard', () => {
    const cards = buildStartingCards(deck, () => 0)
    expect(cards.filter((c) => c.scryfallId === 'bolt')).toHaveLength(4)
    expect(cards.some((c) => c.scryfallId === 'wish')).toBe(false)
  })

  it('puts commanders in the command zone and gives every copy a unique instance id', () => {
    const cards = buildStartingCards(deck, () => 0)
    expect(cards.find((c) => c.scryfallId === 'cmdr')!.zone).toBe('command')
    expect(new Set(cards.map((c) => c.instanceId)).size).toBe(cards.length)
  })

  it('tags commander copies with isCommander and a starting tax of 0, leaving other cards untagged', () => {
    const cards = buildStartingCards(deck, () => 0)
    const cmdr = cards.find((c) => c.scryfallId === 'cmdr')!
    expect(cmdr.isCommander).toBe(true)
    expect(cmdr.commanderTax).toBe(0)
    const bolt = cards.find((c) => c.scryfallId === 'bolt')!
    expect(bolt.isCommander).toBeUndefined()
    expect(bolt.commanderTax).toBeUndefined()
  })

  // Imported token reference cards must never get shuffled into the library/hand — they're only
  // ever created in-game via the "Create Token" action, not drawn like a real card.
  it('excludes imported token reference cards from the library', () => {
    const cards = buildStartingCards(deck, () => 0)
    expect(cards.some((c) => c.scryfallId === 'soldier-token')).toBe(false)
    expect(cards).toHaveLength(5)
  })
})

describe('shuffle', () => {
  it('returns a permutation without mutating the input', () => {
    const input = [1, 2, 3, 4, 5]
    const result = shuffle(input, () => 0.5)
    expect(result).toHaveLength(5)
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5])
    expect(input).toEqual([1, 2, 3, 4, 5])
  })
})

describe('startingLifeFor', () => {
  it('gives commander decks 40 life and everything else 20', () => {
    expect(startingLifeFor({ format: 'commander' } as Deck)).toBe(40)
    expect(startingLifeFor({ format: 'modern' } as Deck)).toBe(20)
    expect(startingLifeFor({} as Deck)).toBe(20)
  })
})
