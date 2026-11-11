import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, deserialize, serialize, type NetMessage } from './protocol'

describe('draft message serialization round-trips', () => {
  const messages: NetMessage[] = [
    { type: 'DRAFT_CONFIG', v: PROTOCOL_VERSION, config: { source: { kind: 'cube', cubeId: 'c1', name: 'Vintage Cube' }, packSize: 15, packsPerPlayer: 3 } },
    {
      type: 'DRAFT_CONFIG',
      v: PROTOCOL_VERSION,
      config: { source: { kind: 'set', setCode: 'dsk', name: 'Duskmourn', boosterType: 'play' }, packSize: 14, packsPerPlayer: 3 },
    },
    { type: 'DRAFT_ROSTER', v: PROTOCOL_VERSION, roster: { 0: 'Alice', 2: 'Bob', 5: 'Cara' } },
    { type: 'DRAFT_ROSTER', v: PROTOCOL_VERSION, roster: { 0: 'Alice', 2: 'Bob' } },
    { type: 'DRAFT_SEAT_REQUEST', v: PROTOCOL_VERSION, seat: 5 },
    { type: 'DRAFT_START', v: PROTOCOL_VERSION },
    { type: 'DRAFT_PACK', v: PROTOCOL_VERSION, toPlayerId: 'p1', packId: 'r0-s0-abc', round: 0, cards: ['s1', 's2', 's3'] },
    { type: 'DRAFT_PICK', v: PROTOCOL_VERSION, packId: 'r0-s0-abc', scryfallId: 's1' },
    { type: 'DRAFT_PICK_REJECTED', v: PROTOCOL_VERSION, toPlayerId: 'p1', packId: 'r0-s0-abc', reason: "You aren't holding that pack." },
    { type: 'DRAFT_ROUND_COMPLETE', v: PROTOCOL_VERSION, round: 0 },
    { type: 'DRAFT_COMPLETE', v: PROTOCOL_VERSION },
    { type: 'DRAFT_PROGRESS', v: PROTOCOL_VERSION, picksBySeat: { 0: 3, 2: 2 } },
    {
      type: 'DRAFT_RESUME',
      v: PROTOCOL_VERSION,
      toPlayerId: 'p1',
      config: { source: { kind: 'set', setCode: 'dsk', name: 'Duskmourn', boosterType: 'play' }, packSize: 14, packsPerPlayer: 3 },
      phase: 'drafting',
      pool: ['s1', 's2~foil'],
      packs: [{ packId: 'r0-s1-abc', round: 0, cards: ['s3', 's4'] }],
      picksBySeat: { 0: 2, 1: 2 },
      roster: { 0: 'Alice', 1: 'Bob' },
    },
    { type: 'DRAFT_PRESENCE', v: PROTOCOL_VERSION, away: [1], autoPicking: [] },
    { type: 'DRAFT_PRESENCE', v: PROTOCOL_VERSION, away: [1, 4], autoPicking: [4] },
    { type: 'DRAFT_MATCH_STATUS', v: PROTOCOL_VERSION, status: { state: 'waiting', opponentSeat: 2 } },
    { type: 'DRAFT_MATCH_STATUS', v: PROTOCOL_VERSION, status: { state: 'building', opponentSeat: null } },
    { type: 'DRAFT_MATCH_STATUS', v: PROTOCOL_VERSION, status: { state: 'playing', opponentSeat: 3, room: 'ABC234' } },
    { type: 'DRAFT_MATCHES', v: PROTOCOL_VERSION, statuses: { 0: { state: 'playing', opponentSeat: 2 }, 2: { state: 'playing', opponentSeat: 0 }, 1: { state: 'building', opponentSeat: null } } },
  ]

  for (const msg of messages) {
    it(`${msg.type} survives serialize -> deserialize`, () => {
      expect(deserialize(serialize(msg))).toEqual(msg)
    })
  }
})

describe('draft message validation', () => {
  it('rejects a DRAFT_PACK missing toPlayerId', () => {
    const raw = JSON.stringify({ type: 'DRAFT_PACK', v: PROTOCOL_VERSION, packId: 'p', round: 0, cards: [] })
    expect(deserialize(raw)).toBeNull()
  })

  it('rejects a DRAFT_CONFIG with an unknown source kind', () => {
    const raw = JSON.stringify({ type: 'DRAFT_CONFIG', v: PROTOCOL_VERSION, config: { source: { kind: 'chaos', name: 'x' }, packSize: 15, packsPerPlayer: 3 } })
    expect(deserialize(raw)).toBeNull()
  })

  it('rejects a DRAFT_CONFIG for a set with an unknown booster type', () => {
    const config = { source: { kind: 'set', setCode: 'dsk', name: 'Duskmourn', boosterType: 'jumpstart' }, packSize: 14, packsPerPlayer: 3 }
    expect(deserialize(JSON.stringify({ type: 'DRAFT_CONFIG', v: PROTOCOL_VERSION, config }))).toBeNull()
  })

  it('rejects a DRAFT_ROSTER with a non-seat key', () => {
    const raw = JSON.stringify({ type: 'DRAFT_ROSTER', v: PROTOCOL_VERSION, roster: { 7: 'Nobody' } })
    expect(deserialize(raw)).toBeNull()
  })

  it('rejects a DRAFT_PROGRESS with a non-numeric value', () => {
    const raw = JSON.stringify({ type: 'DRAFT_PROGRESS', v: PROTOCOL_VERSION, picksBySeat: { 0: 'three' } })
    expect(deserialize(raw)).toBeNull()
  })

  it('rejects a DRAFT_RESUME with an unknown phase or a malformed pack', () => {
    const base = {
      type: 'DRAFT_RESUME',
      v: PROTOCOL_VERSION,
      toPlayerId: 'p1',
      config: { source: { kind: 'cube', cubeId: 'c1', name: 'Cube' }, packSize: 15, packsPerPlayer: 3 },
      phase: 'drafting',
      pool: [],
      packs: [],
      picksBySeat: {},
      roster: { 0: 'Alice' },
    }
    expect(deserialize(JSON.stringify(base))).not.toBeNull()
    expect(deserialize(JSON.stringify({ ...base, phase: 'lobby' }))).toBeNull()
    expect(deserialize(JSON.stringify({ ...base, packs: [{ packId: 'x', round: 0 }] }))).toBeNull()
    expect(deserialize(JSON.stringify({ ...base, pool: [1, 2] }))).toBeNull()
  })

  it('rejects a DRAFT_PRESENCE with an out-of-range seat', () => {
    const raw = JSON.stringify({ type: 'DRAFT_PRESENCE', v: PROTOCOL_VERSION, away: [6], autoPicking: [] })
    expect(deserialize(raw)).toBeNull()
  })

  it('rejects a DRAFT_MATCH_STATUS with an unknown state or a bad seat', () => {
    const bad = (status: unknown) => JSON.stringify({ type: 'DRAFT_MATCH_STATUS', v: PROTOCOL_VERSION, status })
    expect(deserialize(bad({ state: 'sleeping', opponentSeat: null }))).toBeNull()
    expect(deserialize(bad({ state: 'waiting', opponentSeat: 7 }))).toBeNull()
    expect(deserialize(bad({ state: 'waiting', opponentSeat: 2, room: 'no!' }))).toBeNull()
    expect(deserialize(JSON.stringify({ type: 'DRAFT_MATCHES', v: PROTOCOL_VERSION, statuses: { 9: { state: 'building', opponentSeat: null } } }))).toBeNull()
  })

  it('still rejects a totally unknown message type', () => {
    const raw = JSON.stringify({ type: 'NOT_A_REAL_TYPE', v: PROTOCOL_VERSION })
    expect(deserialize(raw)).toBeNull()
  })

  it('rejects a wrong protocol version even for a draft message', () => {
    const raw = JSON.stringify({ type: 'DRAFT_START', v: PROTOCOL_VERSION + 1 })
    const result = deserialize(raw)
    expect(result).toBeNull()
  })
})
