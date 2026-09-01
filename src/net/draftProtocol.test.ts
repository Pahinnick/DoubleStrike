import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, deserialize, serialize, type NetMessage } from './protocol'

describe('draft message serialization round-trips', () => {
  const messages: NetMessage[] = [
    { type: 'DRAFT_CONFIG', v: PROTOCOL_VERSION, config: { cubeId: 'c1', cubeName: 'Vintage Cube', packSize: 15, packsPerPlayer: 3 } },
    { type: 'DRAFT_ROSTER', v: PROTOCOL_VERSION, roster: { 0: 'Alice', 2: 'Bob' } },
    { type: 'DRAFT_START', v: PROTOCOL_VERSION },
    { type: 'DRAFT_PACK', v: PROTOCOL_VERSION, toPlayerId: 'p1', packId: 'r0-s0-abc', round: 0, cards: ['s1', 's2', 's3'] },
    { type: 'DRAFT_PICK', v: PROTOCOL_VERSION, packId: 'r0-s0-abc', scryfallId: 's1' },
    { type: 'DRAFT_PICK_REJECTED', v: PROTOCOL_VERSION, toPlayerId: 'p1', packId: 'r0-s0-abc', reason: "You aren't holding that pack." },
    { type: 'DRAFT_ROUND_COMPLETE', v: PROTOCOL_VERSION, round: 0 },
    { type: 'DRAFT_COMPLETE', v: PROTOCOL_VERSION },
    { type: 'DRAFT_PROGRESS', v: PROTOCOL_VERSION, picksBySeat: { 0: 3, 2: 2 } },
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

  it('rejects a DRAFT_ROSTER with a non-seat key', () => {
    const raw = JSON.stringify({ type: 'DRAFT_ROSTER', v: PROTOCOL_VERSION, roster: { 7: 'Nobody' } })
    expect(deserialize(raw)).toBeNull()
  })

  it('rejects a DRAFT_PROGRESS with a non-numeric value', () => {
    const raw = JSON.stringify({ type: 'DRAFT_PROGRESS', v: PROTOCOL_VERSION, picksBySeat: { 0: 'three' } })
    expect(deserialize(raw)).toBeNull()
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
