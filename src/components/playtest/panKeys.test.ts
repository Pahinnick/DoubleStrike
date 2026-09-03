import { describe, it, expect } from 'vitest'
import { createPanKeys } from './panKeys'

const down = (key: string, code: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  key,
  code,
  ...mods,
})

describe('createPanKeys', () => {
  it('holds a direction between press and release', () => {
    const keys = createPanKeys()
    expect(keys.press(down('w', 'KeyW'))).toBe(true)
    expect([...keys.directions()]).toEqual(['w'])
    keys.release(down('w', 'KeyW'))
    expect(keys.directions().size).toBe(0)
  })

  it('reports OS auto-repeat as not-a-fresh-press', () => {
    const keys = createPanKeys()
    expect(keys.press(down('w', 'KeyW'))).toBe(true)
    expect(keys.press(down('w', 'KeyW'))).toBe(false)
    expect(keys.directions().size).toBe(1)
  })

  it('ignores keys that are not W/A/S/D', () => {
    const keys = createPanKeys()
    expect(keys.press(down('q', 'KeyQ'))).toBe(false)
    expect(keys.directions().size).toBe(0)
  })

  it('releases by physical key even when the release reports a different character', () => {
    const keys = createPanKeys()
    keys.press(down('w', 'KeyW'))
    // Some layouts/modifier states report a different event.key on the way up; the code matches.
    keys.release({ key: 'Dead', code: 'KeyW', altKey: true })
    expect(keys.directions().size).toBe(0)
  })

  it('stops panning when a modifier goes down, so Alt+click cannot strand the camera', () => {
    const keys = createPanKeys()
    keys.press(down('w', 'KeyW'))
    // Alt+click: the Alt keydown itself carries altKey, and it clears the hold. Even if the
    // W release is then swallowed entirely, nothing is left panning.
    expect(keys.press(down('Alt', 'AltLeft', { altKey: true }))).toBe(false)
    expect(keys.directions().size).toBe(0)
    // Pressing an unrelated direction afterwards still works normally.
    expect(keys.press(down('a', 'KeyA'))).toBe(true)
    expect([...keys.directions()]).toEqual(['a'])
  })

  it('does not start a pan from a modified WASD press', () => {
    const keys = createPanKeys()
    expect(keys.press(down('w', 'KeyW', { ctrlKey: true }))).toBe(false)
    expect(keys.directions().size).toBe(0)
  })

  it('collapses two physical keys mapped to the same direction', () => {
    const keys = createPanKeys()
    keys.press(down('w', 'KeyW'))
    keys.press(down('w', 'ArrowUp'))
    expect(keys.size).toBe(2)
    expect([...keys.directions()]).toEqual(['w'])
  })

  it('clear() drops everything, for blur and tab-away', () => {
    const keys = createPanKeys()
    keys.press(down('w', 'KeyW'))
    keys.press(down('a', 'KeyA'))
    keys.clear()
    expect(keys.directions().size).toBe(0)
  })
})
