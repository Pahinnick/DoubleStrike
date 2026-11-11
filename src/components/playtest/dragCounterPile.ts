import type { DragEvent } from 'react'
import { getInPageDragData, isInPageDragOfType, setInPageDragData } from '../../utils/inPageDrag'

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

// Goes through utils/inPageDrag so a drop Chromium delivers with an empty DataTransfer still
// lands — see that module for the stuck-window state this covers.
export function setCounterDragData(event: DragEvent, data: DraggedCounterPile): void {
  setInPageDragData(event, COUNTER_DRAG_TYPE, data)
}

export function getCounterDragData(event: DragEvent): DraggedCounterPile | null {
  return getInPageDragData<DraggedCounterPile>(event, COUNTER_DRAG_TYPE)
}

/** For dragenter/dragover-time checks (getData is blocked until drop): is a counter pile what's
 *  being dragged? */
export function isDraggingCounterPile(event: DragEvent): boolean {
  return isInPageDragOfType(event, COUNTER_DRAG_TYPE)
}
