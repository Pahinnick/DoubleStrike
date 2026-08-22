import { useEffect, useState } from 'react'
import { getTypeWords } from '../api/scryfall'

/** The full type-line vocabulary (card types, supertypes, and every subtype list), fetched once
 *  and reused by every caller — see scryfall.ts's getTypeWords for the session-long cache. Empty
 *  until the first fetch resolves; callers just get no suggestions in that brief window rather
 *  than a loading state, since it only matters for a moment on first use each session. */
export function useTypeWords(): string[] {
  const [words, setWords] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    getTypeWords()
      .then((result) => {
        if (!cancelled) setWords(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return words
}
