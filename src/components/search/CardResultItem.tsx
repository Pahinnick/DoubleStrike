import type { MouseEvent } from 'react'
import { getDisplayImage } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import type { MembershipCount } from '../../engine/deckMembership'
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
  /** Copies of this card the open deck already runs, per board — undefined when it runs none. */
  inDeck?: MembershipCount
}

function CardResultItem({ card, onAdd, cardSize, inDeck }: Props) {
  const [hoverHandlers] = useHoverPreview(card)
  const onContextMenu = useSimilarCardsTrigger(card)
  const image = getDisplayImage(card)
  const price = getCardUsdPrice(card)
  // Sideboard copies are deliberately not part of the badge's number — it answers "how many are
  // in the list I'm building" — but they still belong in the tooltip, so a card you only run in
  // the sideboard reads as owned rather than as a silent zero.
  const inDeckLabel = inDeck
    ? [inDeck.mainboard > 0 ? `${inDeck.mainboard} in mainboard` : null, inDeck.sideboard > 0 ? `${inDeck.sideboard} in sideboard` : null]
        .filter(Boolean)
        .join(' · ')
    : undefined

  function handleMouseEnter(event: MouseEvent) {
    playCue('hover')
    hoverHandlers.onMouseEnter(event)
  }

  return (
    <button
      type="button"
      className={`card-result-item ${inDeck ? 'is-in-deck' : ''}`}
      title={inDeckLabel}
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
      {inDeck && (
        <span className="card-result-item__in-deck" aria-label={inDeckLabel}>
          {inDeck.mainboard > 1 ? `✓ ${inDeck.mainboard}` : '✓'}
        </span>
      )}
      {price !== undefined && <span className="card-result-item__price">{formatUsd(price)}</span>}
    </button>
  )
}

export default CardResultItem
