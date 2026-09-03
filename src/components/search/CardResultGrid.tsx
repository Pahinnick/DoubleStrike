import type { CSSProperties } from 'react'
import type { ScryfallCard } from '../../api/scryfallTypes'
import type { MembershipCount } from '../../engine/deckMembership'
import { CARD_SIZES, type CardSizeKey } from '../../utils/cardSize'
import CardResultItem from './CardResultItem'

type Props = {
  cards: ScryfallCard[]
  onAdd: (card: ScryfallCard) => void
  cardSize: CardSizeKey
  /** oracle_id -> copies already in the open deck. Omitted by callers that don't mark ownership. */
  membership?: Map<string, MembershipCount>
}

function CardResultGrid({ cards, onAdd, cardSize, membership }: Props) {
  if (cards.length === 0) return null

  return (
    <div className="card-result-grid" style={{ '--card-size': `${CARD_SIZES[cardSize]}px` } as CSSProperties}>
      {cards.map((card) => (
        <CardResultItem
          key={card.id}
          card={card}
          onAdd={onAdd}
          cardSize={cardSize}
          inDeck={membership?.get(card.oracle_id)}
        />
      ))}
    </div>
  )
}

export default CardResultGrid
