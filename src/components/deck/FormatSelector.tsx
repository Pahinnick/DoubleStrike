import { useDeck } from '../../state/DeckContext'
import { DECK_FORMATS, type DeckFormat } from '../../utils/scryfallQuery'

function FormatSelector() {
  const { deck, dispatch } = useDeck()

  return (
    <select
      value={deck.format ?? ''}
      onChange={(event) =>
        dispatch({ type: 'SET_FORMAT', format: (event.target.value || undefined) as DeckFormat | undefined })
      }
      aria-label="Deck format"
    >
      <option value="">No format</option>
      {DECK_FORMATS.map((format) => (
        <option key={format} value={format}>
          {format}
        </option>
      ))}
    </select>
  )
}

export default FormatSelector
