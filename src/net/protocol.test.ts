import { describe, expect, it } from 'vitest'
import {
  FACE_DOWN_SCRYFALL_ID,
  HOST_SEAT,
  MAX_FRAME_CHARS,
  MAX_ID_CHARS,
  MAX_PLAYERS,
  MAX_TEXT_CHARS,
  MAX_ZONE_CARDS,
  PROTOCOL_VERSION,
  ROOM_CODE_LENGTH,
  type NetMessage,
  type PublicBoard,
  deserialize,
  generateRoomCode,
  isValidRoomCode,
  nextFreeSeat,
  parseMessage,
  peerIdToRoomCode,
  relayTargets,
  roomCodeToPeerId,
  serialize,
} from './protocol'

function board(overrides: Partial<PublicBoard> = {}): PublicBoard {
  return {
    playerId: 'p1',
    name: 'Alice',
    seat: 0,
    life: 40,
    commanderDamage: {},
    poison: 0,
    handCount: 7,
    battlefield: [
      { instanceId: 'i1', scryfallId: 's1', x: 10, y: 20, tapped: false },
      {
        instanceId: 'i2',
        scryfallId: 's2',
        x: 30,
        y: 40,
        tapped: true,
        counters: [{ id: 'pile-1', color: 'green', value: 2 }],
        showBackFace: true,
        isToken: true,
      },
    ],
    ...overrides,
  }
}

describe('serialization round-trips', () => {
  const messages: NetMessage[] = [
    { type: 'HELLO', v: PROTOCOL_VERSION, playerId: 'p2', key: 'k2', name: 'Bob', deckFormat: 'commander' },
    { type: 'WELCOME', v: PROTOCOL_VERSION, playerId: 'p2', seat: 2 },
    { type: 'STATE', v: PROTOCOL_VERSION, board: board() },
    { type: 'PLAYER_LEFT', v: PROTOCOL_VERSION, playerId: 'p2' },
  ]

  for (const msg of messages) {
    it(`${msg.type} survives serialize -> deserialize`, () => {
      expect(deserialize(serialize(msg))).toEqual(msg)
    })
  }

  it('rejects a HELLO without a join key', () => {
    const bad = { type: 'HELLO', v: PROTOCOL_VERSION, playerId: 'p2', name: 'Bob', deckFormat: 'commander' }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('deserialize accepts an already-parsed object, not only a string', () => {
    const msg: NetMessage = { type: 'WELCOME', v: PROTOCOL_VERSION, playerId: 'p2', seat: 1 }
    expect(deserialize(msg)).toEqual(msg)
  })

  it('GIVE_CARD round-trips', () => {
    const msg: NetMessage = {
      type: 'GIVE_CARD',
      v: PROTOCOL_VERSION,
      toPlayerId: 'p2',
      card: { instanceId: 'i9', scryfallId: 's9', ownerSeat: 0, x: 100, y: 200, tapped: true, counters: [{ id: 'pile-9', color: 'blue', value: 1 }] },
    }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a GIVE_CARD whose card is missing ownerSeat', () => {
    const bad = { type: 'GIVE_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', card: { instanceId: 'i9', scryfallId: 's9', x: 1, y: 2, tapped: false } }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('GIVE_CARD carrying faceDown round-trips — a card given directly to a recipient legitimately reveals its real scryfallId to them', () => {
    const msg: NetMessage = {
      type: 'GIVE_CARD',
      v: PROTOCOL_VERSION,
      toPlayerId: 'p2',
      card: { instanceId: 'i10', scryfallId: 's10', ownerSeat: 0, x: 1, y: 2, tapped: false, faceDown: true },
    }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('STATE carrying a battlefield card with atSeat round-trips — relocated onto a different quadrant', () => {
    const withAtSeat = board({ battlefield: [{ instanceId: 'i5', scryfallId: 's5', x: 0, y: 0, tapped: false, atSeat: 2 }] })
    const msg: NetMessage = { type: 'STATE', v: PROTOCOL_VERSION, board: withAtSeat }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a STATE whose battlefield card has an out-of-range atSeat', () => {
    const bad = { ...board(), battlefield: [{ instanceId: 'i5', scryfallId: 's5', x: 0, y: 0, tapped: false, atSeat: 9 }] }
    expect(deserialize(JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION, board: bad }))).toBeNull()
  })

  it('STATE carrying a face-down battlefield card round-trips', () => {
    const withFaceDown = board({
      battlefield: [{ instanceId: 'i4', scryfallId: FACE_DOWN_SCRYFALL_ID, x: 0, y: 0, tapped: false, faceDown: true }],
    })
    const msg: NetMessage = { type: 'STATE', v: PROTOCOL_VERSION, board: withFaceDown }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a STATE whose battlefield card has a non-boolean faceDown', () => {
    const bad = board({ battlefield: [{ instanceId: 'i4', scryfallId: 's4', x: 0, y: 0, tapped: false, faceDown: 'yes' } as never] })
    expect(deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: bad }))).toBeNull()
  })

  it('STATE carrying graveyard/exile/command piles round-trips', () => {
    const withPiles = board({
      graveyard: [{ instanceId: 'g1', scryfallId: 's1' }],
      exile: [{ instanceId: 'e1', scryfallId: 's2', showBackFace: true }],
      command: [{ instanceId: 'c1', scryfallId: 's3' }],
    })
    const msg: NetMessage = { type: 'STATE', v: PROTOCOL_VERSION, board: withPiles }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('STATE carrying a revealed hand round-trips (opt-in — see toPublicBoard/GameState.revealHand)', () => {
    const withHand = board({ hand: [{ instanceId: 'h1', scryfallId: 's7' }] })
    const msg: NetMessage = { type: 'STATE', v: PROTOCOL_VERSION, board: withHand }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('ROLL round-trips a multi-die result, and rejects non-numeric faces', () => {
    const many: NetMessage = {
      type: 'ROLL',
      v: PROTOCOL_VERSION,
      playerId: 'p1',
      name: 'Alice',
      roll: { kind: 'die', sides: 6, value: 14, values: [5, 3, 6] },
    }
    expect(deserialize(serialize(many))).toEqual(many)
    // A single die stays exactly the shape it always had — no `values` at all.
    const one: NetMessage = { type: 'ROLL', v: PROTOCOL_VERSION, playerId: 'p1', name: 'Alice', roll: { kind: 'die', sides: 20, value: 17 } }
    expect(deserialize(serialize(one))).toEqual(one)
    const bad = { type: 'ROLL', v: PROTOCOL_VERSION, playerId: 'p1', name: 'Alice', roll: { kind: 'die', sides: 6, value: 4, values: ['4'] } }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('ROLL carries an optional shared id, and ROLL_DISMISS names one', () => {
    const withId: NetMessage = {
      type: 'ROLL',
      v: PROTOCOL_VERSION,
      playerId: 'p1',
      name: 'Alice',
      roll: { kind: 'coin', value: 'heads' },
      id: 'roll-1',
    }
    expect(deserialize(serialize(withId))).toEqual(withId)
    const dismiss: NetMessage = { type: 'ROLL_DISMISS', v: PROTOCOL_VERSION, id: 'roll-1' }
    expect(deserialize(serialize(dismiss))).toEqual(dismiss)
    // An id is the whole point of a dismissal, so it's required there (unlike on ROLL).
    expect(deserialize(JSON.stringify({ type: 'ROLL_DISMISS', v: PROTOCOL_VERSION }))).toBeNull()
    expect(deserialize(JSON.stringify({ type: 'ROLL_DISMISS', v: PROTOCOL_VERSION, id: '' }))).toBeNull()
  })

  it('TURN_PASS round-trips with and without the shared turn number', () => {
    const withTurn: NetMessage = { type: 'TURN_PASS', v: PROTOCOL_VERSION, activeSeat: 2, turn: 7 }
    expect(deserialize(serialize(withTurn))).toEqual(withTurn)
    const withoutTurn: NetMessage = { type: 'TURN_PASS', v: PROTOCOL_VERSION, activeSeat: 2 }
    expect(deserialize(serialize(withoutTurn))).toEqual(withoutTurn)
  })

  it('RETURN_CARD round-trips with and without a libraryPosition', () => {
    const bottomed: NetMessage = {
      type: 'RETURN_CARD',
      v: PROTOCOL_VERSION,
      toPlayerId: 'p2',
      instanceId: 'i1',
      toZone: 'library',
      libraryPosition: 'bottom',
    }
    expect(deserialize(serialize(bottomed))).toEqual(bottomed)
    // Omitted entirely by an older sender — still valid, and MOVE_CARD's own default takes over.
    const plain: NetMessage = { type: 'RETURN_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', instanceId: 'i1', toZone: 'hand' }
    expect(deserialize(serialize(plain))).toEqual(plain)
  })

  it('rejects a RETURN_CARD with an unknown libraryPosition', () => {
    const bad = { type: 'RETURN_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', instanceId: 'i1', toZone: 'library', libraryPosition: 'middle' }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('rejects a board with a malformed hand pile card', () => {
    const bad = board({ hand: [{ scryfallId: 's1' } as never] })
    expect(deserialize(JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION, board: bad }))).toBeNull()
  })

  it('STATE carrying a battlefield card with ptCounters round-trips', () => {
    const withPt = board({
      battlefield: [
        { instanceId: 'i3', scryfallId: 's3', x: 0, y: 0, tapped: false, ptCounters: [{ id: 'pt-1', color: 'green', power: 2, toughness: -1 }] },
      ],
    })
    const msg: NetMessage = { type: 'STATE', v: PROTOCOL_VERSION, board: withPt }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a STATE whose battlefield card has a malformed ptCounters', () => {
    const bad = {
      ...board(),
      battlefield: [{ instanceId: 'i4', scryfallId: 's4', x: 0, y: 0, tapped: false, ptCounters: [{ id: 'pt-2', color: 'green', power: 1 }] }],
    }
    const msg = { type: 'STATE', v: PROTOCOL_VERSION, board: bad }
    expect(deserialize(JSON.stringify(msg))).toBeNull()
  })

  it('STATE carrying a battlefieldSkin round-trips, and omits it when the sender has none', () => {
    const withSkin = board({ battlefieldSkin: 'prism' })
    expect(deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: withSkin }))).toEqual({
      type: 'STATE',
      v: PROTOCOL_VERSION,
      board: withSkin,
    })
    const withoutSkin = deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: board() }))
    expect((withoutSkin as { board: PublicBoard }).board.battlefieldSkin).toBeUndefined()
  })

  it('rejects a STATE whose battlefieldSkin is not a string', () => {
    const bad = { ...board(), battlefieldSkin: 42 }
    expect(deserialize(JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION, board: bad }))).toBeNull()
  })

  it('STATE carrying scooped round-trips, and omits it when the sender has not conceded', () => {
    const scooped = board({ scooped: true })
    expect(deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: scooped }))).toEqual({
      type: 'STATE',
      v: PROTOCOL_VERSION,
      board: scooped,
    })
    const notScooped = deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: board() }))
    expect((notScooped as { board: PublicBoard }).board.scooped).toBeUndefined()
  })

  it('rejects a STATE whose scooped flag is not a boolean', () => {
    const bad = { ...board(), scooped: 'yes' }
    expect(deserialize(JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION, board: bad }))).toBeNull()
  })

  it('STATE carrying startingLife round-trips, and tolerates it being absent', () => {
    const withStarting = board({ startingLife: 30 })
    expect(deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: withStarting }))).toEqual({
      type: 'STATE',
      v: PROTOCOL_VERSION,
      board: withStarting,
    })
    const without = deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: board() }))
    expect((without as { board: PublicBoard }).board.startingLife).toBeUndefined()
  })

  it('rejects a STATE whose startingLife is not a number', () => {
    const bad = { ...board(), startingLife: '40' }
    expect(deserialize(JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION, board: bad }))).toBeNull()
  })

  it('STATE carrying floatingMana round-trips, and omits it when nothing is floating', () => {
    const floating = board({ floatingMana: { R: 3, G: 2 } })
    expect(deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: floating }))).toEqual({
      type: 'STATE',
      v: PROTOCOL_VERSION,
      board: floating,
    })
    const empty = deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: board() }))
    expect((empty as { board: PublicBoard }).board.floatingMana).toBeUndefined()
  })

  it('rejects a STATE whose floatingMana has a non-color key or a non-numeric value', () => {
    const badKey = { ...board(), floatingMana: { Q: 3 } }
    expect(deserialize(JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION, board: badKey }))).toBeNull()
    const badValue = { ...board(), floatingMana: { R: '3' } }
    expect(deserialize(JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION, board: badValue }))).toBeNull()
  })

  it('STATE carrying per-source commanderDamage round-trips (v2 shape: keyed by seat, not a single worst-source number)', () => {
    const withDamage = board({ commanderDamage: { 1: 5, 3: 21 } })
    expect(deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: withDamage }))).toEqual({
      type: 'STATE',
      v: PROTOCOL_VERSION,
      board: withDamage,
    })
  })

  it('rejects a STATE whose commanderDamage has a non-seat key or a non-numeric value', () => {
    const badKey = { ...board(), commanderDamage: { 7: 5 } }
    expect(deserialize(JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION, board: badKey }))).toBeNull()
    const badValue = { ...board(), commanderDamage: { 1: '5' } }
    expect(deserialize(JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION, board: badValue }))).toBeNull()
  })

  it('GIVE_CARD with ptCounters round-trips', () => {
    const msg: NetMessage = {
      type: 'GIVE_CARD',
      v: PROTOCOL_VERSION,
      toPlayerId: 'p2',
      card: {
        instanceId: 'i10',
        scryfallId: 's10',
        ownerSeat: 0,
        x: 100,
        y: 200,
        tapped: true,
        ptCounters: [{ id: 'pt-10', color: 'red', power: -1, toughness: 3 }],
      },
    }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('ROLL (die) round-trips', () => {
    const msg: NetMessage = {
      type: 'ROLL',
      v: PROTOCOL_VERSION,
      playerId: 'p2',
      name: 'Bob',
      roll: { kind: 'die', sides: 20, value: 14 },
    }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('ROLL (coin) round-trips', () => {
    const msg: NetMessage = {
      type: 'ROLL',
      v: PROTOCOL_VERSION,
      playerId: 'p2',
      name: 'Bob',
      roll: { kind: 'coin', value: 'heads' },
    }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a ROLL with a malformed roll payload', () => {
    const bad = { type: 'ROLL', v: PROTOCOL_VERSION, playerId: 'p2', name: 'Bob', roll: { kind: 'die', sides: 20 } }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('rejects a ROLL with an unknown roll kind', () => {
    const bad = { type: 'ROLL', v: PROTOCOL_VERSION, playerId: 'p2', name: 'Bob', roll: { kind: 'dart', value: 1 } }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('PING round-trips', () => {
    const msg: NetMessage = { type: 'PING', v: PROTOCOL_VERSION, playerId: 'p2', name: 'Bob', x: 1234.5, y: 678 }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a PING missing coordinates', () => {
    const bad = { type: 'PING', v: PROTOCOL_VERSION, playerId: 'p2', name: 'Bob', x: 1 }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('HIGHLIGHT round-trips', () => {
    const msg: NetMessage = { type: 'HIGHLIGHT', v: PROTOCOL_VERSION, instanceId: 'i42' }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a HIGHLIGHT missing instanceId', () => {
    const bad = { type: 'HIGHLIGHT', v: PROTOCOL_VERSION }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('REACTION round-trips', () => {
    const msg: NetMessage = { type: 'REACTION', v: PROTOCOL_VERSION, playerId: 'p2', name: 'Bob', emoji: '👍' }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a REACTION missing emoji', () => {
    const bad = { type: 'REACTION', v: PROTOCOL_VERSION, playerId: 'p2', name: 'Bob' }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('RELOCATE_CARD round-trips', () => {
    const msg: NetMessage = { type: 'RELOCATE_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', instanceId: 'i9', x: 111, y: 222 }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('RELOCATE_CARD with atSeat round-trips — dropped onto a different quadrant than the card owner\'s own', () => {
    const msg: NetMessage = { type: 'RELOCATE_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', instanceId: 'i9', x: 111, y: 222, atSeat: 3 }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a RELOCATE_CARD with an out-of-range atSeat', () => {
    const bad = { type: 'RELOCATE_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', instanceId: 'i9', x: 1, y: 2, atSeat: 7 }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('rejects a RELOCATE_CARD missing coordinates', () => {
    const bad = { type: 'RELOCATE_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', instanceId: 'i9', x: 1 }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('rejects a RELOCATE_CARD missing toPlayerId', () => {
    const bad = { type: 'RELOCATE_CARD', v: PROTOCOL_VERSION, instanceId: 'i9', x: 1, y: 2 }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('TAP_CARD round-trips in both tap directions', () => {
    for (const tapped of [true, false]) {
      const msg: NetMessage = { type: 'TAP_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', instanceId: 'i9', tapped }
      expect(deserialize(serialize(msg))).toEqual(msg)
    }
  })

  it('rejects a TAP_CARD missing tapped', () => {
    const bad = { type: 'TAP_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', instanceId: 'i9' }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('rejects a TAP_CARD missing toPlayerId', () => {
    const bad = { type: 'TAP_CARD', v: PROTOCOL_VERSION, instanceId: 'i9', tapped: true }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('FLIP_CARD round-trips', () => {
    const msg: NetMessage = { type: 'FLIP_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', instanceId: 'i9' }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a FLIP_CARD missing instanceId', () => {
    const bad = { type: 'FLIP_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2' }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('rejects a FLIP_CARD missing toPlayerId', () => {
    const bad = { type: 'FLIP_CARD', v: PROTOCOL_VERSION, instanceId: 'i9' }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('DELETE_CARD round-trips', () => {
    const msg: NetMessage = { type: 'DELETE_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2', instanceId: 'i9' }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a DELETE_CARD missing instanceId', () => {
    const bad = { type: 'DELETE_CARD', v: PROTOCOL_VERSION, toPlayerId: 'p2' }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('rejects a DELETE_CARD missing toPlayerId', () => {
    const bad = { type: 'DELETE_CARD', v: PROTOCOL_VERSION, instanceId: 'i9' }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('TURN_PASS round-trips', () => {
    const msg: NetMessage = { type: 'TURN_PASS', v: PROTOCOL_VERSION, activeSeat: 2 }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a TURN_PASS with an out-of-range seat', () => {
    const bad = { type: 'TURN_PASS', v: PROTOCOL_VERSION, activeSeat: 4 }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })

  it('RADIO round-trips with a station', () => {
    const msg: NetMessage = { type: 'RADIO', v: PROTOCOL_VERSION, station: 'groovesalad' }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('RADIO round-trips with station: null (off)', () => {
    const msg: NetMessage = { type: 'RADIO', v: PROTOCOL_VERSION, station: null }
    expect(deserialize(serialize(msg))).toEqual(msg)
  })

  it('rejects a RADIO with an empty-string station', () => {
    const bad = { type: 'RADIO', v: PROTOCOL_VERSION, station: '' }
    expect(deserialize(JSON.stringify(bad))).toBeNull()
  })
})

describe('parseMessage rejection', () => {
  it('rejects an incompatible protocol version', () => {
    const wire = JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION + 1, board: board() })
    const result = parseMessage(wire)
    expect(result).toEqual({ ok: false, reason: 'version' })
  })

  it('rejects malformed JSON', () => {
    expect(parseMessage('{not json')).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rejects an unknown message type', () => {
    expect(parseMessage(JSON.stringify({ type: 'NOPE', v: PROTOCOL_VERSION }))).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('rejects a STATE whose board is missing required fields', () => {
    const bad = { type: 'STATE', v: PROTOCOL_VERSION, board: { playerId: 'p1' } }
    expect(parseMessage(JSON.stringify(bad))).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rejects a board with a malformed battlefield card', () => {
    const bad = board({ battlefield: [{ instanceId: 'i1' } as never] })
    expect(deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: bad }))).toBeNull()
  })

  it('rejects a board with a malformed graveyard pile card', () => {
    const bad = board({ graveyard: [{ scryfallId: 's1' } as never] })
    expect(deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: bad }))).toBeNull()
  })

  it('rejects a board with a malformed command pile card', () => {
    const bad = board({ command: [{ scryfallId: 's1' } as never] })
    expect(deserialize(serialize({ type: 'STATE', v: PROTOCOL_VERSION, board: bad }))).toBeNull()
  })

  it('rejects a non-object', () => {
    expect(deserialize(42)).toBeNull()
    expect(deserialize(null)).toBeNull()
  })
})

describe('nextFreeSeat', () => {
  it('gives the host seat first when nothing is occupied', () => {
    expect(nextFreeSeat([])).toBe(HOST_SEAT)
  })

  it('seats the first guest directly above the host', () => {
    expect(nextFreeSeat([0])).toBe(2)
  })

  it('fills remaining seats clockwise around the table after that', () => {
    expect(nextFreeSeat([0, 2])).toBe(3)
    expect(nextFreeSeat([0, 2, 3])).toBe(1)
    expect(nextFreeSeat([0, 1])).toBe(2) // fills the preferred gap, not just the next-highest
  })

  it('returns null when the pod is full', () => {
    expect(nextFreeSeat([0, 1, 2, 3])).toBeNull()
    expect([0, 1, 2, 3]).toHaveLength(MAX_PLAYERS)
  })
})

describe('relayTargets', () => {
  it('forwards to every connected peer except the sender', () => {
    expect(relayTargets(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('is empty when the sender is the only peer', () => {
    expect(relayTargets(['a'], 'a')).toEqual([])
  })
})

describe('room codes', () => {
  it('generates a code of the right length using only unambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode()
      expect(code).toHaveLength(ROOM_CODE_LENGTH)
      expect(isValidRoomCode(code)).toBe(true)
      expect(code).not.toMatch(/[01OIL]/) // no visually ambiguous characters
    }
  })

  it('round-trips code <-> peer id (case/space insensitive)', () => {
    const peerId = roomCodeToPeerId('  x7k2q9 ')
    expect(peerId).toBe('mtg-vtt-X7K2Q9')
    expect(peerIdToRoomCode(peerId)).toBe('X7K2Q9')
  })

  it('peerIdToRoomCode returns null for a foreign id', () => {
    expect(peerIdToRoomCode('some-other-peer')).toBeNull()
  })

  it('isValidRoomCode rejects wrong length and ambiguous characters', () => {
    expect(isValidRoomCode('ABC')).toBe(false)
    expect(isValidRoomCode('ABCDE0')).toBe(false) // 0 is not in the alphabet
    expect(isValidRoomCode('ABCDEF')).toBe(true)
  })
})

describe('size limits on what a peer can send', () => {
  const state = (b: PublicBoard) => JSON.stringify({ type: 'STATE', v: PROTOCOL_VERSION, board: b })
  const card = (i: number) => ({ instanceId: `i${i}`, scryfallId: 's', x: 0, y: 0, tapped: false })

  it('accepts a big but real board', () => {
    expect(deserialize(state(board({ battlefield: Array.from({ length: 150 }, (_, i) => card(i)) })))).not.toBeNull()
  })

  it('rejects a battlefield with an absurd number of cards', () => {
    expect(deserialize(state(board({ battlefield: Array.from({ length: MAX_ZONE_CARDS + 1 }, (_, i) => card(i)) })))).toBeNull()
  })

  it('rejects a frame over the size cap before parsing it', () => {
    expect(parseMessage('x'.repeat(MAX_FRAME_CHARS + 1))).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rejects an overlong name and an overlong id', () => {
    expect(deserialize(state(board({ name: 'n'.repeat(MAX_TEXT_CHARS + 1) })))).toBeNull()
    expect(deserialize(state(board({ playerId: 'p'.repeat(MAX_ID_CHARS + 1) })))).toBeNull()
  })

  it('rejects absurd numbers', () => {
    expect(deserialize(state(board({ life: 1e300 })))).toBeNull()
  })

  it('rejects a card carrying thousands of counter piles', () => {
    const counters = Array.from({ length: 5000 }, (_, i) => ({ id: `c${i}`, color: 'green' as const, value: 1 }))
    expect(deserialize(state(board({ battlefield: [{ ...card(1), counters }] })))).toBeNull()
  })

  it('rejects a roll of a million dice', () => {
    const roll = { kind: 'die', sides: 6, value: 1, values: Array.from({ length: 1_000_000 }, () => 1) }
    expect(deserialize(JSON.stringify({ type: 'ROLL', v: PROTOCOL_VERSION, playerId: 'p', name: 'n', roll }))).toBeNull()
  })
})
