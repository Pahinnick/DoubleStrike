import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraftRejoin, loadDraftRejoin, saveDraftRejoin } from './draftRejoin'

/** Minimal in-memory Storage — this test environment doesn't provide localStorage. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
  }
}

describe('draft rejoin storage', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('remembers the room and player id', () => {
    saveDraftRejoin({ roomCode: 'ABC123', playerId: 'p1', name: 'Alice' }, 1000)
    expect(loadDraftRejoin(2000)).toEqual({ roomCode: 'ABC123', playerId: 'p1', name: 'Alice', savedAt: 1000 })
  })

  it('forgets a draft older than six hours', () => {
    saveDraftRejoin({ roomCode: 'ABC123', playerId: 'p1', name: 'Alice' }, 0)
    expect(loadDraftRejoin(7 * 60 * 60 * 1000)).toBeNull()
    expect(loadDraftRejoin(0)).toBeNull()
  })

  it('forgets on clear', () => {
    saveDraftRejoin({ roomCode: 'ABC123', playerId: 'p1', name: 'Alice' })
    clearDraftRejoin()
    expect(loadDraftRejoin()).toBeNull()
  })

  it('ignores junk in storage', () => {
    localStorage.setItem('mtgdb:draft:rejoin', '{not json')
    expect(loadDraftRejoin()).toBeNull()
    localStorage.setItem('mtgdb:draft:rejoin', JSON.stringify({ roomCode: '', playerId: 'p1', savedAt: Date.now() }))
    expect(loadDraftRejoin()).toBeNull()
  })
})
