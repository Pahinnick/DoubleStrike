import { useEffect, useRef } from 'react'

// Open dismissable layers, oldest first. Only the newest one answers Escape, so a confirm dialog
// over a modal over the board closes one layer per press instead of all three at once.
const openLayers: object[] = []

/** True while any modal/menu using useEscapeToClose is open — lets global keyboard shortcuts
 *  (Playtest's single-key bindings, the deck editor's undo) stand down behind a modal. */
export function isDismissableLayerOpen(): boolean {
  return openLayers.length > 0
}

/**
 * Closes a modal, popover or menu on Escape. Pass `enabled: false` while the layer isn't open
 * (for components that stay mounted and render null) or mustn't be dismissed right now.
 *
 * An input inside the layer that uses Escape for itself (cancelling an inline rename, closing an
 * autocomplete list) should call `event.stopPropagation()` in its own handler so the press
 * doesn't also close the layer around it.
 */
export function useEscapeToClose(onClose: () => void, enabled = true): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!enabled) return
    const layer = {}
    openLayers.push(layer)
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (openLayers[openLayers.length - 1] !== layer) return
      // Marks the press as handled for the listeners still to run (other layers registered on
      // the same target see defaultPrevented and leave it alone).
      event.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      const index = openLayers.indexOf(layer)
      if (index !== -1) openLayers.splice(index, 1)
    }
  }, [enabled])
}
