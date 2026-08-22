import { useEffect, useState } from 'react'
import { autocompleteCardNames } from '../api/scryfall'
import { useDebouncedValue } from './useDebouncedValue'

/** Card-name suggestions for a search box, debounced against Scryfall's `/cards/autocomplete`.
 *  Empty below two characters (matches Scryfall's own minimum) so a fresh keystroke or two
 *  doesn't fire a request that's just going to come back with noise. */
export function useNameAutocomplete(query: string): string[] {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const debounced = useDebouncedValue(query, 200)

  useEffect(() => {
    const trimmed = debounced.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      return
    }
    const controller = new AbortController()
    autocompleteCardNames(trimmed, controller.signal)
      .then(setSuggestions)
      .catch(() => {
        if (!controller.signal.aborted) setSuggestions([])
      })
    return () => controller.abort()
  }, [debounced])

  return suggestions
}
