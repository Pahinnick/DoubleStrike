import { getDisplayImage } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import { useSimilarCardsTrigger } from '../../hooks/useSimilarCardsTrigger'
import { formatUsd, getCardUsdPrice } from '../../utils/price'

type Props = {
  card: ScryfallCard
  matchCount: number
  onAdd: () => void
}

function SimilarCardRow({ card, matchCount, onAdd }: Props) {
  const onContextMenu = useSimilarCardsTrigger(card)
  const [hoverHandlers] = useHoverPreview(card)
  const image = getDisplayImage(card)
  const price = getCardUsdPrice(card)

  return (
    <button type="button" className="similar-card-tile" onClick={onAdd} onContextMenu={onContextMenu} {...hoverHandlers}>
      {image ? (
        <img src={image.normal ?? image.small} alt={card.name} loading="lazy" />
      ) : (
        <div className="similar-card-tile__placeholder">{card.name}</div>
      )}
      <div className="similar-card-tile__caption">
        <span className="similar-card-tile__name">{card.name}</span>
        <span className="similar-card-tile__count">
          {matchCount} tag{matchCount > 1 ? 's' : ''}
          {price !== undefined && ` · ${formatUsd(price)}`}
          {card.edhrec_rank !== undefined && (
            <span title={`EDHREC rank ${card.edhrec_rank.toLocaleString()} — lower means played in more decks`}>
              {` · #${card.edhrec_rank.toLocaleString()}`}
            </span>
          )}
        </span>
      </div>
    </button>
  )
}

export default SimilarCardRow
