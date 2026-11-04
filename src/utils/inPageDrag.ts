import type { DragEvent } from 'react'

// Every drag in this app starts and ends inside the same page, so alongside the browser's own
// DataTransfer we keep an in-memory copy of what was picked up.
//
// Two reasons it exists:
// - dragenter/dragover can't read getData() (browsers only allow it at drop), so live landing
//   previews read the copy instead.
// - Chromium (Electron on Windows) can get into a state where, for the rest of the window's life,
//   every drag still starts fine but reaches its drop target with an EMPTY DataTransfer — no
//   types, no data — even though the source's own dragend still sees the data. Captured from a
//   stuck 1.9.0 window: dragstart set `application/x-game-card`, then dragenter/dragover/drop on
//   the battlefield all had `types: []`, so every drop was silently ignored while clicks kept
//   working. It began after a large multi-card group drag in a pod, and only a restart cleared it.
//   When a drop arrives that empty, the copy is used instead.
//
// A drop from outside the page (a file, a link, text) always carries types of its own, so it is
// never mistaken for the copy. A drag that was never ours has no copy to fall back on.

let current: { type: string; payload: string } | null = null

if (typeof window !== 'undefined') {
  // Capture phase, so a new drag clears the previous copy BEFORE its own source handler records
  // the new one — a copy left over from a drag whose dragend never arrived can't outlive it.
  window.addEventListener('dragstart', () => (current = null), true)
  // Bubble phase on window: runs after the drop/dragend handlers that read the copy.
  window.addEventListener('dragend', () => (current = null))
}

/** Sets drag data on the browser's DataTransfer and keeps the in-page copy. Call from dragstart. */
export function setInPageDragData(event: DragEvent, type: string, data: unknown): void {
  const payload = JSON.stringify(data)
  event.dataTransfer.setData(type, payload)
  event.dataTransfer.effectAllowed = 'move'
  current = { type, payload }
}

/** True when the browser handed over a drag with no data at all — the broken state above, or a
 *  drag carrying nothing. Only then may the in-page copy stand in for it. */
function arrivedEmpty(event: DragEvent): boolean {
  return event.dataTransfer.types.length === 0
}

/** Whether the drag in progress carries `type`. Safe during dragenter/dragover. */
export function isInPageDragOfType(event: DragEvent, type: string): boolean {
  if (event.dataTransfer.types.includes(type)) return true
  return arrivedEmpty(event) && current?.type === type
}

/** The drag's data for `type` at drop time, from the DataTransfer or, when that arrived empty,
 *  the in-page copy. */
export function getInPageDragData<T>(event: DragEvent, type: string): T | null {
  let raw = event.dataTransfer.getData(type)
  if (!raw && arrivedEmpty(event) && current?.type === type) raw = current.payload
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** The in-page copy for `type` without an event — for dragover-time previews. */
export function peekInPageDragData<T>(type: string): T | null {
  if (current?.type !== type) return null
  try {
    return JSON.parse(current.payload) as T
  } catch {
    return null
  }
}

/** Drops the in-page copy (a drag source's own dragend). */
export function clearInPageDragData(): void {
  current = null
}
