import { useState } from 'react'
import Autocomplete from '../shared/Autocomplete'
import { useTypeWords } from '../../hooks/useTypeWords'

type Props = {
  types: string[]
  onChange: (types: string[]) => void
  ariaLabel?: string
  className?: string
}

const SUGGESTION_LIMIT = 12

/** Type-line filter as a set of chips (Legendary, Creature, ...) instead of one free-text field —
 *  each chip becomes its own `t:` clause (see buildScryfallQuery), so multiple types are ANDed
 *  together correctly instead of silently degrading into a bare text search. Suggestions come
 *  from Scryfall's type catalogs (useTypeWords) but aren't enforced: Enter with no match still
 *  adds the typed word verbatim, since silver-border/Un-set types aren't in those catalogs. */
function TypeMultiSelect({ types, onChange, ariaLabel, className }: Props) {
  const [text, setText] = useState('')
  const words = useTypeWords()

  const query = text.trim().toLowerCase()
  const suggestions =
    query.length === 0
      ? []
      : words.filter((word) => word.toLowerCase().startsWith(query) && !types.some((t) => t.toLowerCase() === word.toLowerCase())).slice(0, SUGGESTION_LIMIT)

  function addType(raw: string) {
    const trimmed = raw.trim()
    setText('')
    if (trimmed.length === 0) return
    if (types.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return
    onChange([...types, trimmed])
  }

  function removeType(type: string) {
    onChange(types.filter((t) => t !== type))
  }

  return (
    <div className={`type-multiselect ${className ?? ''}`}>
      {types.length > 0 && (
        <div className="type-multiselect__chips">
          {types.map((type) => (
            <span key={type} className="type-multiselect__chip">
              {type}
              <button type="button" aria-label={`Remove ${type}`} onClick={() => removeType(type)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <Autocomplete
        value={text}
        onChange={setText}
        onCommit={addType}
        onEnterFreeform={addType}
        suggestions={suggestions}
        placeholder={types.length > 0 ? 'Add another type…' : 'e.g. Legendary, Creature'}
        ariaLabel={ariaLabel}
        className="type-multiselect__input"
      />
    </div>
  )
}

export default TypeMultiSelect
