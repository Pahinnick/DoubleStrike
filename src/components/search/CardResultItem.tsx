import type { MouseEvent } from 'react'
import { getDisplayImage } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import { useSimilarCardsTrigger } from '../../hooks/useSimilarCardsTrigger'
import { getCardImageUrl, type CardSizeKey } from '../../utils/cardSize'
import { setDragCardData } from '../../utils/dragCard'
import { formatUsd, getCardUsdPrice } from '../../utils/price'
import { playCue } from '../../utils/sound'

type Props = {
  card: ScryfallCard
  onAdd: (card: ScryfallCard) => void
  cardSize: CardSizeKey
}

function CardResultItem({ card, onAdd, cardSize }: Props) {
  const [hoverHandlers] = useHoverPreview(card)
  const onContextMenu = useSimilarCardsTrigger(card)
  const image = getDisplayImage(card)
  const price = getCardUsdPrice(card)

  function handleMouseEnter(event: MouseEvent) {
    playCue('hover')
    hoverHandlers.onMouseEnter(event)
  }

  return (
    <button
      type="button"
      className="card-result-item"
      draggable
      onDragStart={(event) => setDragCardData(event, { scryfallId: card.id, board: null })}
      onClick={() => onAdd(card)}
      onContextMenu={onContextMenu}
      {...hoverHandlers}
      onMouseEnter={handleMouseEnter}
    >
      {image ? (
        <img src={getCardImageUrl(image, cardSize)} alt={card.name} loading="lazy" />
      ) : (
        <div className="card-result-item__placeholder">{card.name}</div>
      )}
      {price !== undefined && <span className="card-result-item__price">{formatUsd(price)}</span>}
    </button>
  )
}

export default CardResultItem
