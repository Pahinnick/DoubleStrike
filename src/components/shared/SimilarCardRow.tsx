import { Fragment, type ReactNode } from 'react'
import { getDisplayImage } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import { useSimilarCardsTrigger } from '../../hooks/useSimilarCardsTrigger'
import { formatUsd, getCardUsdPrice } from '../../utils/price'

type Props = {
  card: ScryfallCard
  matchCount: number
  onAdd: () => void
  /** Replaces the default "N tags" lead-in for callers whose ranking isn't tag-based (e.g. the
   *  EDHREC recommendations modal, which leads with an inclusion rate and a synergy score).
   *  One row per entry, above the price/rank row — a tile is only ~170px of usable width, so
   *  two facts joined onto one line get ellipsised away rather than read. */
  captionLines?: string[]
}

function SimilarCardRow({ card, matchCount, onAdd, captionLines }: Props) {
  const onContextMenu = useSimilarCardsTrigger(card)
  const [hoverHandlers] = useHoverPreview(card)
  const image = getDisplayImage(card)
  const price = getCardUsdPrice(card)

  // Collected rather than inlined so the " · " separators land only between the parts that are
  // actually present — a card with no price and no rank shouldn't render a dangling separator.
  const meta: ReactNode[] = []
  if (captionLines === undefined) meta.push(`${matchCount} tag${matchCount > 1 ? 's' : ''}`)
  if (price !== undefined) meta.push(formatUsd(price))
  if (card.edhrec_rank !== undefined) {
    meta.push(
      <span key="rank" title={`EDHREC rank ${card.edhrec_rank.toLocaleString()} — lower means played in more decks`}>
        {`#${card.edhrec_rank.toLocaleString()}`}
      </span>,
    )
  }

  return (
    <button type="button" className="similar-card-tile" onClick={onAdd} onContextMenu={onContextMenu} {...hoverHandlers}>
      {image ? (
        <img src={image.normal ?? image.small} alt={card.name} loading="lazy" />
      ) : (
        <div className="similar-card-tile__placeholder">{card.name}</div>
      )}
      <div className="similar-card-tile__caption">
        <span className="similar-card-tile__name">{card.name}</span>
        {/* Each supplied line gets its own row. The EDHREC modal sends an inclusion rate and a
            synergy score; joined onto one line they overrun the tile and get clipped mid-word.
            The default "N tags" is short enough to share the price/rank row. */}
        {captionLines?.map((line) => (
          <span key={line} className="similar-card-tile__count">
            {line}
          </span>
        ))}
        {meta.length > 0 && (
          <span className="similar-card-tile__count">
            {meta.map((part, index) => (
              <Fragment key={index}>
                {index > 0 && ' · '}
                {part}
              </Fragment>
            ))}
          </span>
        )}
      </div>
    </button>
  )
}

export default SimilarCardRow
