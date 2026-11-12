import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdBackgroundActive } from './keepActive'

describe('holdBackgroundActive', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('stops background throttling while any game connection holds it, and restores it after the last', () => {
    const calls: boolean[] = []
    vi.stubGlobal('window', { electronNet: { setBackgroundActive: (active: boolean) => (calls.push(active), Promise.resolve()) } })
    const releaseDraft = holdBackgroundActive()
    const releaseMatch = holdBackgroundActive()
    expect(calls).toEqual([true])
    releaseDraft()
    releaseDraft() // a second release of the same hold changes nothing
    expect(calls).toEqual([true])
    releaseMatch()
    expect(calls).toEqual([true, false])
  })

  it('does nothing in a plain browser', () => {
    vi.stubGlobal('window', {})
    expect(() => holdBackgroundActive()()).not.toThrow()
  })
})
