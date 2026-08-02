import { useDeck } from '../../state/DeckContext'
import { FORMATS, type Format } from '../../utils/scryfallQuery'

function FormatSelector() {
  const { deck, dispatch } = useDeck()

  return (
    <select
      value={deck.format ?? ''}
      onChange={(event) =>
        dispatch({ type: 'SET_FORMAT', format: (event.target.value || undefined) as Format | undefined })
      }
      aria-label="Deck format"
    >
      <option value="">No format</option>
      {FORMATS.map((format) => (
        <option key={format} value={format}>
          {format}
        </option>
      ))}
    </select>
  )
}

export default FormatSelector
