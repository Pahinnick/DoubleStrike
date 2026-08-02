import type { MouseEvent } from 'react'
import CardMarkChip from '../shared/CardMarkChip'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import { useSimilarCardsTrigger } from '../../hooks/useSimilarCardsTrigger'
import { getSnapshotImage, type CardSnapshot } from '../../storage/cardCache'
import type { Board, DeckCard } from '../../state/types'
import { setDragCardData } from '../../utils/dragCard'
import { formatUsd, getCardUsdPrice } from '../../utils/price'
import { playCue } from '../../utils/sound'

type Props = {
  deckCard: DeckCard
  snapshot: CardSnapshot | undefined
  /** undefined = not loaded yet, null = EDHREC has no score for this card. */
  salt: number | null | undefined
  /** Legality problems specific to this card (singleton violation, outside commander's color
   *  identity, banned, etc.) — empty when the card has none. Drawn from engine/legality.ts. */
  issueReasons: string[]
  categories: string[]
  canDesignateCommander: boolean
  otherBoard: Board
  onSetQuantity: (quantity: number) => void
  onRemove: () => void
  onSetCategory: (category: string | undefined) => void
  onSetCommander: (isCommander: boolean) => void
  onSetMark: (mark: string | undefined) => void
  onMoveBoard: () => void
}

function DeckCardRow({
  deckCard,
  snapshot,
  salt,
  issueReasons,
  categories,
  canDesignateCommander,
  otherBoard,
  onSetQuantity,
  onRemove,
  onSetCategory,
  onSetCommander,
  onSetMark,
  onMoveBoard,
}: Props) {
  const image = snapshot ? getSnapshotImage(snapshot) : undefined
  const name = snapshot?.name ?? deckCard.scryfallId
  const price = snapshot ? getCardUsdPrice(snapshot) : undefined
  // Snapshots resolve almost instantly from the IndexedDB cache, so a right-click/hover
  // in the rare unloaded moment just falls through to the browser's default behavior.
  const fallbackCard = snapshot ?? { id: deckCard.scryfallId, oracle_id: '', name }
  const onContextMenu = useSimilarCardsTrigger(fallbackCard)
  const [hoverHandlers] = useHoverPreview(fallbackCard, 'front', undefined, deckCard.foil)

  function handleMouseEnter(event: MouseEvent) {
    playCue('hover')
    hoverHandlers.onMouseEnter(event)
  }

  return (
    <div
      className={`deck-card-row ${deckCard.isCommander ? 'is-commander' : ''} ${issueReasons.length > 0 ? 'has-issue' : ''}`}
      data-scryfall-id={deckCard.scryfallId}
      data-board={deckCard.board}
      title={issueReasons.length > 0 ? issueReasons.join('; ') : undefined}
      onContextMenu={snapshot ? onContextMenu : undefined}
      draggable
      onDragStart={(event) => setDragCardData(event, { scryfallId: deckCard.scryfallId, board: deckCard.board })}
      {...(snapshot ? hoverHandlers : {})}
      {...(snapshot ? { onMouseEnter: handleMouseEnter } : {})}
    >
      <div className="deck-card-row__thumb">
        {image ? <img src={image.small} alt={name} /> : <div className="deck-card-row__placeholder" />}
        <CardMarkChip mark={deckCard.mark} onSetMark={onSetMark} label={name} />
      </div>
      <span className="deck-card-row__name">{name}</span>
      <span className="deck-card-row__price-salt">
        {price !== undefined && <span className="deck-card-row__price">{formatUsd(price)}</span>}
        {typeof salt === 'number' && (
          <span className="deck-card-row__salt" title="EDHREC salt score">
            🧂 {salt.toFixed(1)}
          </span>
        )}
      </span>
      {categories.length > 0 && (
        <select
          className="deck-card-row__category"
          aria-label={`${name} category`}
          value={deckCard.category ?? ''}
          onChange={(event) => onSetCategory(event.target.value || undefined)}
        >
          <option value="">Uncategorized</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      )}
      {(canDesignateCommander || deckCard.isCommander) && (
        <button
          type="button"
          className={`deck-card-row__commander ${deckCard.isCommander ? 'is-active' : ''}`}
          aria-pressed={!!deckCard.isCommander}
          aria-label={deckCard.isCommander ? `Unset ${name} as commander` : `Set ${name} as commander`}
          title={deckCard.isCommander ? 'Commander' : 'Set as commander'}
          onClick={() => onSetCommander(!deckCard.isCommander)}
        >
          ★
        </button>
      )}
      <button type="button" className="deck-card-row__move" onClick={onMoveBoard} aria-label={`Move ${name} to ${otherBoard}`}>
        {otherBoard === 'sideboard' ? '→ SB' : '→ MB'}
      </button>
      <div className="deck-card-row__qty">
        <button type="button" onClick={() => onSetQuantity(deckCard.quantity - 1)} aria-label={`Decrease ${name} quantity`}>
          −
        </button>
        <span>{deckCard.quantity}</span>
        <button type="button" onClick={() => onSetQuantity(deckCard.quantity + 1)} aria-label={`Increase ${name} quantity`}>
          +
        </button>
      </div>
      <button type="button" onClick={onRemove} aria-label={`Remove ${name}`}>
        ×
      </button>
    </div>
  )
}

export default DeckCardRow
