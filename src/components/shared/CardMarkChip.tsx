import { useState, type MouseEvent } from 'react'
import CardMarkPicker from './CardMarkPicker'
import './cardMark.css'

type Props = {
  mark: string | undefined
  onSetMark: (mark: string | undefined) => void
  /** Card name, for the aria-label/title only. */
  label: string
}

/** Small colored flag a player can put on a deck-list card ("already drawn", "key combo piece",
 *  etc.) — used in both the main deck editor's list/grid rows and the Playtest deck-scan tray.
 *  Click (unmarked) or right-click (either state) opens a color-swatch picker; click on an
 *  already-marked chip clears it directly, one step. Persists with the deck (DeckCard.mark),
 *  not the game session — see state/types.ts. */
function CardMarkChip({ mark, onSetMark, label }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)

  function handleClick(event: MouseEvent) {
    event.stopPropagation()
    if (mark) {
      onSetMark(undefined)
    } else {
      setPickerOpen(true)
    }
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    setPickerOpen(true)
  }

  return (
    <div className="card-mark-chip-wrap">
      <button
        type="button"
        className={`card-mark-chip ${mark ? 'is-marked' : ''}`}
        style={mark ? { backgroundColor: mark, borderColor: mark } : undefined}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        aria-label={mark ? `Clear ${label}'s mark` : `Mark ${label}`}
        title={mark ? 'Click to clear this mark, right-click to change its color' : 'Click or right-click to mark this card with a color'}
      />
      {pickerOpen && (
        <CardMarkPicker
          onPick={(color) => {
            onSetMark(color)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

export default CardMarkChip
