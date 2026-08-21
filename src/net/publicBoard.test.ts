import { describe, expect, it } from 'vitest'
import { FACE_DOWN_SCRYFALL_ID } from './protocol'
import type { GameCard, GameState } from '../state/gameReducer'
import { zeroManaPool } from '../utils/colors'
import { toPublicBoard } from './publicBoard'

function card(overrides: Partial<GameCard> & Pick<GameCard, 'instanceId' | 'scryfallId' | 'zone'>): GameCard {
  return { tapped: false, ...overrides }
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    cards: [],
    life: 40,
    commanderDamage: {},
    poison: 0,
    turn: 1,
    mulligans: 0,
    startingLife: 40,
    revealTopOfLibrary: false,
    revealHand: false,
    scooped: false,
    floatingMana: zeroManaPool(),
    ...overrides,
  }
}

const identity = { playerId: 'p1', name: 'Alice', seat: 1 as const }

describe('toPublicBoard', () => {
  it('derives life/poison/commander-damage and hand count', () => {
    const s = state({
      life: 33,
      commanderDamage: { 2: 5, 3: 12 },
      poison: 2,
      cards: [
        card({ instanceId: 'h1', scryfallId: 'hand-a', zone: 'hand' }),
        card({ instanceId: 'h2', scryfallId: 'hand-b', zone: 'hand' }),
        card({ instanceId: 'l1', scryfallId: 'lib-a', zone: 'library' }),
      ],
    })
    const pub = toPublicBoard(s, identity)
    expect(pub).toMatchObject({
      playerId: 'p1',
      name: 'Alice',
      seat: 1,
      life: 33,
      // Wire carries the full per-source breakdown (public knowledge at a real table), not
      // just the worst single total — see toPublicCommanderDamage.
      commanderDamage: { 2: 5, 3: 12 },
      poison: 2,
      handCount: 2,
    })
    expect(pub.battlefield).toEqual([])
  })

  it('strips zero/negative commander-damage sources from the wire, sparse like counters/floatingMana', () => {
    const s = state({ commanderDamage: { 1: 5, 2: 0, 3: -1 } })
    const pub = toPublicBoard(s, identity)
    expect(pub.commanderDamage).toEqual({ 1: 5 })
  })

  it('drops the solo-only synthetic commander-damage source (SOLO_CMDR_SOURCE) from the wire', () => {
    const s = state({ commanderDamage: { [-1]: 7 } })
    const pub = toPublicBoard(s, identity)
    expect(pub.commanderDamage).toEqual({})
  })

  it('includes only battlefield cards, carrying their public fields', () => {
    const s = state({
      cards: [
        card({
          instanceId: 'b1',
          scryfallId: 'bf-a',
          zone: 'battlefield',
          x: 12,
          y: 34,
          tapped: true,
          counters: [{ id: 'pile-1', color: 'green', value: 3 }],
        }),
        card({ instanceId: 'b2', scryfallId: 'bf-b', zone: 'battlefield', x: 50, y: 60, isToken: true, showBackFace: true }),
        card({ instanceId: 'g1', scryfallId: 'gy-a', zone: 'graveyard' }),
      ],
    })
    const pub = toPublicBoard(s, identity)
    expect(pub.battlefield).toEqual([
      { instanceId: 'b1', scryfallId: 'bf-a', x: 12, y: 34, tapped: true, counters: [{ id: 'pile-1', color: 'green', value: 3 }] },
      { instanceId: 'b2', scryfallId: 'bf-b', x: 50, y: 60, tapped: false, isToken: true, showBackFace: true },
    ])
  })

  it('masks a face-down battlefield card\'s real identity behind FACE_DOWN_SCRYFALL_ID, like hand/library privacy', () => {
    const s = state({
      cards: [
        card({ instanceId: 'b1', scryfallId: 'SECRET-MORPH-CARD', zone: 'battlefield', x: 5, y: 5, faceDown: true }),
        card({ instanceId: 'b2', scryfallId: 'public-bf-card', zone: 'battlefield', x: 6, y: 6 }),
      ],
    })
    const pub = toPublicBoard(s, identity)
    expect(pub.battlefield[0]).toMatchObject({ scryfallId: FACE_DOWN_SCRYFALL_ID, faceDown: true })
    expect(pub.battlefield[1]).toMatchObject({ scryfallId: 'public-bf-card' })
    expect(pub.battlefield[1]).not.toHaveProperty('faceDown')
    expect(JSON.stringify(pub)).not.toContain('SECRET-MORPH-CARD')
  })

  it('includes ptCounters on a battlefield card when present', () => {
    const s = state({
      cards: [
        card({
          instanceId: 'b1',
          scryfallId: 'bf-a',
          zone: 'battlefield',
          x: 1,
          y: 1,
          ptCounters: [{ id: 'pt-1', color: 'green', power: 2, toughness: -1 }],
        }),
      ],
    })
    const pub = toPublicBoard(s, identity)
    expect(pub.battlefield[0]).toMatchObject({ ptCounters: [{ id: 'pt-1', color: 'green', power: 2, toughness: -1 }] })
  })

  it('omits counters/ptCounters once the last pile is removed (empty array normalized to undefined upstream)', () => {
    const s = state({
      cards: [card({ instanceId: 'b1', scryfallId: 'bf-a', zone: 'battlefield', x: 0, y: 0, counters: [], ptCounters: [] })],
    })
    const pub = toPublicBoard(s, identity)
    expect(pub.battlefield[0]).not.toHaveProperty('counters')
    expect(pub.battlefield[0]).not.toHaveProperty('ptCounters')
  })

  it('mirrors graveyard, exile, and command contents (public zones)', () => {
    const s = state({
      cards: [
        card({ instanceId: 'g1', scryfallId: 'gy-card', zone: 'graveyard' }),
        card({ instanceId: 'e1', scryfallId: 'ex-card', zone: 'exile', showBackFace: true }),
        // The command zone is public knowledge at a real table (your commander sits face-up),
        // so — like graveyard/exile — it's shared in full, letting opponents' clients show
        // whose commander is whose next to their nameplate.
        card({ instanceId: 'c1', scryfallId: 'cmd-card', zone: 'command' }),
      ],
    })
    const pub = toPublicBoard(s, identity)
    expect(pub.graveyard).toEqual([{ instanceId: 'g1', scryfallId: 'gy-card' }])
    expect(pub.exile).toEqual([{ instanceId: 'e1', scryfallId: 'ex-card', showBackFace: true }])
    expect(pub.command).toEqual([{ instanceId: 'c1', scryfallId: 'cmd-card' }])
  })

  it('defaults a battlefield card with no position to 0,0 rather than leaking undefined', () => {
    const s = state({ cards: [card({ instanceId: 'b1', scryfallId: 'bf-a', zone: 'battlefield' })] })
    expect(toPublicBoard(s, identity).battlefield[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('includes battlefieldSkin when the sender has one set, omits it otherwise', () => {
    const s = state()
    expect(toPublicBoard(s, identity).battlefieldSkin).toBeUndefined()
    expect(toPublicBoard(s, { ...identity, battlefieldSkin: 'prism' }).battlefieldSkin).toBe('prism')
  })

  it('omits hand contents by default, sharing only the count', () => {
    const s = state({
      cards: [card({ instanceId: 'h1', scryfallId: 'hand-a', zone: 'hand' })],
    })
    const pub = toPublicBoard(s, identity)
    expect(pub.handCount).toBe(1)
    expect(pub.hand).toBeUndefined()
  })

  it('shares hand contents when the player has opted in via revealHand, like graveyard/exile/command', () => {
    const s = state({
      revealHand: true,
      cards: [
        card({ instanceId: 'h1', scryfallId: 'hand-a', zone: 'hand' }),
        card({ instanceId: 'h2', scryfallId: 'hand-b', zone: 'hand', showBackFace: true }),
      ],
    })
    const pub = toPublicBoard(s, identity)
    expect(pub.hand).toEqual([
      { instanceId: 'h1', scryfallId: 'hand-a' },
      { instanceId: 'h2', scryfallId: 'hand-b', showBackFace: true },
    ])
  })

  it('shares startingLife, the reference point a life bar fills against', () => {
    const pub = toPublicBoard(state({ startingLife: 30, life: 30 }), identity)
    expect(pub.startingLife).toBe(30)
  })

  it('shares floating mana, sparse (zero colors omitted)', () => {
    const s = state({ floatingMana: { ...zeroManaPool(), R: 3, G: 2 } })
    const pub = toPublicBoard(s, identity)
    expect(pub.floatingMana).toEqual({ R: 3, G: 2 })
  })

  it('omits floatingMana entirely once nothing is floating, rather than sending an all-zero object', () => {
    const pub = toPublicBoard(state(), identity)
    expect(pub.floatingMana).toBeUndefined()
  })

  it('NEVER leaks hand or library card identities onto the wire (command IS shared — see the zone-mirroring test above)', () => {
    const s = state({
      cards: [
        card({ instanceId: 'h1', scryfallId: 'SECRET-HAND-CARD', zone: 'hand' }),
        card({ instanceId: 'l1', scryfallId: 'SECRET-LIBRARY-CARD', zone: 'library' }),
        card({ instanceId: 'b1', scryfallId: 'public-bf-card', zone: 'battlefield', x: 1, y: 1 }),
      ],
    })
    const serialized = JSON.stringify(toPublicBoard(s, identity))
    expect(serialized).not.toContain('SECRET-HAND-CARD')
    expect(serialized).not.toContain('SECRET-LIBRARY-CARD')
    expect(serialized).toContain('public-bf-card')
  })
})
