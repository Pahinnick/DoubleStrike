import type { DragEvent } from 'react'

// Separate MIME type from dragGameCard's — keeps a counter-pile drag from ever being misread as
// a whole-card drag (or vice versa) by whichever drop handler happens to catch the bubbled event
// first (see PlaytestView's per-card onDrop, nested inside the battlefield canvas that already
// unconditionally accepts card-relocate drops).
const COUNTER_DRAG_TYPE = 'application/x-game-counter-pile'

export type DraggedCounterPile = {
  /** The battlefield card this pile is currently sitting on. */
  fromInstanceId: string
  pileId: string
  /** Generic counters and power/toughness counters are separate arrays on GameCard (`counters`
   *  vs `ptCounters`) — the drop handler needs to know which one to move the pile out of/into. */
  kind: 'generic' | 'pt'
}

export function setCounterDragData(event: DragEvent, data: DraggedCounterPile): void {
  event.dataTransfer.setData(COUNTER_DRAG_TYPE, JSON.stringify(data))
  event.dataTransfer.effectAllowed = 'move'
}

export function getCounterDragData(event: DragEvent): DraggedCounterPile | null {
  const raw = event.dataTransfer.getData(COUNTER_DRAG_TYPE)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DraggedCounterPile
  } catch {
    return null
  }
}

/** For dragenter/dragover-time checks only (getData is blocked until drop — same restriction
 *  dragGameCard's getCurrentDragData works around, but here we only need to know a counter pile
 *  is what's being dragged, not its contents, so checking `types` is enough — no in-memory mirror
 *  needed). */
export function isDraggingCounterPile(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(COUNTER_DRAG_TYPE)
}
