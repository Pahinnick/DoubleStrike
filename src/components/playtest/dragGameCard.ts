import type { DragEvent } from 'react'
import type { GameZone } from '../../state/gameReducer'

const GAME_DRAG_TYPE = 'application/x-game-card'

/** Another selected battlefield card riding along with the one actually grabbed — `dx`/`dy`
 *  are its offset from the grabbed card's position at drag start, so the whole group keeps
 *  its relative layout when dropped (see PlaytestView's handleBattlefieldDrop). */
export type GroupOffset = {
  instanceId: string
  dx: number
  dy: number
}

export type DraggedGameCard = {
  instanceId: string
  fromZone: GameZone
  /** Shift-click multi-select: other cards moving together with this one. Battlefield-only. */
  groupOffsets?: GroupOffset[]
  /** Set when dragging a card that lives on ANOTHER player's board (see PlaytestCard's
   *  `remoteOwnerId`) — that player's playerId, so the drop handler sends a RELOCATE_CARD
   *  to them instead of touching our own local state, which has no copy of this card. */
  fromPlayerId?: string
}

// Browsers block reading dataTransfer.getData() during dragover (only drop/dragend can),
// so a live landing-position preview can't use it. This in-memory mirror — fine since drags
// never cross windows here — lets dragover handlers read the same payload synchronously.
let currentDrag: DraggedGameCard | null = null

export function setGameDragData(event: DragEvent, data: DraggedGameCard): void {
  event.dataTransfer.setData(GAME_DRAG_TYPE, JSON.stringify(data))
  event.dataTransfer.effectAllowed = 'move'
  currentDrag = data
}

export function getGameDragData(event: DragEvent): DraggedGameCard | null {
  const raw = event.dataTransfer.getData(GAME_DRAG_TYPE)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DraggedGameCard
  } catch {
    return null
  }
}

/** For dragover-time previews only — see the comment above `currentDrag`. */
export function getCurrentDragData(): DraggedGameCard | null {
  return currentDrag
}

export function clearCurrentDragData(): void {
  currentDrag = null
}
