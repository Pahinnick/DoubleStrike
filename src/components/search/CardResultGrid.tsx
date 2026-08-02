import type { CSSProperties } from 'react'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { CARD_SIZES, type CardSizeKey } from '../../utils/cardSize'
import CardResultItem from './CardResultItem'

type Props = {
  cards: ScryfallCard[]
  onAdd: (card: ScryfallCard) => void
  cardSize: CardSizeKey
}

function CardResultGrid({ cards, onAdd, cardSize }: Props) {
  if (cards.length === 0) return null

  return (
    <div className="card-result-grid" style={{ '--card-size': `${CARD_SIZES[cardSize]}px` } as CSSProperties}>
      {cards.map((card) => (
        <CardResultItem key={card.id} card={card} onAdd={onAdd} cardSize={cardSize} />
      ))}
    </div>
  )
}

export default CardResultGrid
