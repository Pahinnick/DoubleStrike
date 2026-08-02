import { useCallback } from 'react'
import type { TaggableCard } from '../api/scryfallTypes'
import { useSimilarCardsContext } from '../components/shared/SimilarCardsContext'

/** Returns an onContextMenu handler that opens the Similar Cards view for this card, replacing the browser's native menu. */
export function useSimilarCardsTrigger(card: TaggableCard) {
  const { setOpenCard } = useSimilarCardsContext()

  return useCallback(
    (event: { preventDefault: () => void }) => {
      event.preventDefault()
      setOpenCard(card)
    },
    [card, setOpenCard],
  )
}
