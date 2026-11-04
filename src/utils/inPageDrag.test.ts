import { describe, expect, it } from 'vitest'
import type { DragEvent } from 'react'
import { clearInPageDragData, getInPageDragData, isInPageDragOfType, peekInPageDragData, setInPageDragData } from './inPageDrag'

/** A DataTransfer stand-in: `store` is what the browser actually delivers to this event. */
function dragEvent(store: Record<string, string> = {}): DragEvent {
  const data = { ...store }
  return {
    dataTransfer: {
      get types() {
        return Object.keys(data)
      },
      getData: (type: string) => data[type] ?? '',
      setData: (type: string, value: string) => {
        data[type] = value
      },
      effectAllowed: 'uninitialized',
    },
  } as unknown as DragEvent
}

const CARD = 'application/x-game-card'

describe('inPageDrag', () => {
  it('reads the browser data normally', () => {
    setInPageDragData(dragEvent(), CARD, { id: 'a' })
    expect(getInPageDragData(dragEvent({ [CARD]: '{"id":"b"}' }), CARD)).toEqual({ id: 'b' })
  })

  it('falls back to the in-page copy when the drop arrives with no data at all', () => {
    // The stuck-Chromium state: dragstart set the data, the drop target got an empty DataTransfer.
    setInPageDragData(dragEvent(), CARD, { id: 'a' })
    const emptyDrop = dragEvent()
    expect(isInPageDragOfType(emptyDrop, CARD)).toBe(true)
    expect(getInPageDragData(emptyDrop, CARD)).toEqual({ id: 'a' })
  })

  it('never mistakes an outside drop (a file) for the copy', () => {
    setInPageDragData(dragEvent(), CARD, { id: 'a' })
    const fileDrop = dragEvent({ Files: '' })
    expect(isInPageDragOfType(fileDrop, CARD)).toBe(false)
    expect(getInPageDragData(fileDrop, CARD)).toBeNull()
  })

  it('only answers for the type that was picked up', () => {
    setInPageDragData(dragEvent(), 'application/x-game-counter-pile', { pileId: 'p' })
    expect(getInPageDragData(dragEvent(), CARD)).toBeNull()
    expect(peekInPageDragData(CARD)).toBeNull()
  })

  it('has nothing to fall back on once the drag is over', () => {
    setInPageDragData(dragEvent(), CARD, { id: 'a' })
    clearInPageDragData()
    expect(getInPageDragData(dragEvent(), CARD)).toBeNull()
  })

  it('a new drag start clears a copy left behind by a drag whose dragend never came', () => {
    setInPageDragData(dragEvent(), CARD, { id: 'stale' })
    window.dispatchEvent(new Event('dragstart'))
    expect(peekInPageDragData(CARD)).toBeNull()
  })
})
