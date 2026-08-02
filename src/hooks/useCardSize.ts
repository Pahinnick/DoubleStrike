import { useEffect, useState } from 'react'
import { CARD_SIZES, type CardSizeKey } from '../utils/cardSize'

const STORAGE_KEY = 'mtg-deckbuilder:cardSize'

function isCardSizeKey(value: string | null): value is CardSizeKey {
  return value !== null && value in CARD_SIZES
}

/** Card grid size, shared and persisted across the search and deck panels. */
export function useCardSize(defaultSize: CardSizeKey = 'small') {
  const [cardSize, setCardSize] = useState<CardSizeKey>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isCardSizeKey(stored) ? stored : defaultSize
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, cardSize)
  }, [cardSize])

  return [cardSize, setCardSize] as const
}
