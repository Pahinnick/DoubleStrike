type Shortcut = { keys: string; description: string }

const KEYBOARD_SHORTCUTS: Shortcut[] = [
  { keys: '1 – 4', description: 'Center the camera on that seat (multiplayer pod only)' },
  { keys: '0 or F', description: 'Fit the whole table in view (multiplayer pod only)' },
  { keys: 'Ctrl+Z / Cmd+Z', description: 'Undo' },
  { keys: 'Ctrl+Y or Ctrl+Shift+Z / Cmd+Shift+Z', description: 'Redo' },
  { keys: 'Esc', description: 'Close the open menu/dialog, or clear the current multi-selection' },
  { keys: 'Delete / Backspace', description: 'Send the hovered card (hand or battlefield), or the whole multi-selection, to the graveyard' },
]

const MOUSE_SHORTCUTS: Shortcut[] = [
  { keys: 'Alt + scroll over a card', description: 'Resize the hover-preview popup' },
  { keys: 'Alt + click empty battlefield', description: 'Ping that spot for everyone in the pod' },
  { keys: 'Alt + click a card', description: 'Flash-highlight that card for everyone in the pod' },
  { keys: 'Shift + click a card', description: 'Add/remove it from the multi-select group' },
  { keys: 'Shift + drag empty battlefield', description: 'Marquee-select every card in the box' },
  { keys: 'Right-click empty battlefield', description: 'Create a token at that point' },
  { keys: 'Right-click a card', description: 'Open its actions menu (tap, counters, flip, etc.)' },
]

type Props = {
  onClose: () => void
}

function ShortcutsModal({ onClose }: Props) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="modal-content shortcuts-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Shortcuts</h2>
        <h3>Keyboard</h3>
        <ul className="shortcuts-modal__list">
          {KEYBOARD_SHORTCUTS.map((s) => (
            <li key={s.keys}>
              <kbd>{s.keys}</kbd>
              <span>{s.description}</span>
            </li>
          ))}
        </ul>
        <h3>Mouse</h3>
        <ul className="shortcuts-modal__list">
          {MOUSE_SHORTCUTS.map((s) => (
            <li key={s.keys}>
              <kbd>{s.keys}</kbd>
              <span>{s.description}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export default ShortcutsModal
