import type { DragEvent } from 'react'
import type { GameZone } from '../../state/gameReducer'
import { clearInPageDragData, getInPageDragData, peekInPageDragData, setInPageDragData } from '../../utils/inPageDrag'

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

// The payload also lives in an in-page copy (see utils/inPageDrag): dragover handlers read it for
// the live landing preview, and a drop that Chromium delivers with an empty DataTransfer falls
// back to it instead of being silently ignored.

export function setGameDragData(event: DragEvent, data: DraggedGameCard): void {
  setInPageDragData(event, GAME_DRAG_TYPE, data)
}

export function getGameDragData(event: DragEvent): DraggedGameCard | null {
  return getInPageDragData<DraggedGameCard>(event, GAME_DRAG_TYPE)
}

/** For dragover-time previews only — getData() can't be read before the drop. */
export function getCurrentDragData(): DraggedGameCard | null {
  return peekInPageDragData<DraggedGameCard>(GAME_DRAG_TYPE)
}

export function clearCurrentDragData(): void {
  clearInPageDragData()
}
