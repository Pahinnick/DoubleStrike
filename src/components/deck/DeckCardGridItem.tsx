import { useState, type MouseEvent } from 'react'
import CardContextMenu, { type ContextMenuAction } from '../shared/CardContextMenu'
import CardMarkChip from '../shared/CardMarkChip'
import FoilShine from '../shared/FoilShine'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import { useSimilarCardsTrigger } from '../../hooks/useSimilarCardsTrigger'
import { getSnapshotImage, type CardSnapshot } from '../../storage/cardCache'
import type { Board, DeckCard } from '../../state/types'
import { getCardImageUrl, type CardSizeKey } from '../../utils/cardSize'
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
  cardSize: CardSizeKey
  canDesignateCommander: boolean
  otherBoard: Board
  onSetQuantity: (quantity: number) => void
  onRemove: () => void
  onSetCommander: (isCommander: boolean) => void
  onSetMark: (mark: string | undefined) => void
  onMoveBoard: () => void
}

function DeckCardGridItem({
  deckCard,
  snapshot,
  salt,
  issueReasons,
  cardSize,
  canDesignateCommander,
  otherBoard,
  onSetQuantity,
  onRemove,
  onSetCommander,
  onSetMark,
  onMoveBoard,
}: Props) {
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const image = snapshot ? getSnapshotImage(snapshot) : undefined
  const name = snapshot?.name ?? deckCard.scryfallId
  const price = snapshot ? getCardUsdPrice(snapshot) : undefined
  const fallbackCard = snapshot ?? { id: deckCard.scryfallId, oracle_id: '', name }
  const onContextMenu = useSimilarCardsTrigger(fallbackCard)
  const [hoverHandlers, foilPoint] = useHoverPreview(fallbackCard, 'front', undefined, deckCard.foil)

  function handleMouseEnter(event: MouseEvent) {
    playCue('hover')
    hoverHandlers.onMouseEnter(event)
  }

  function openMenu(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuAnchor({ x: rect.left, y: rect.bottom + 4 })
  }

  // Card size (small/medium) leaves too little width for a row of labeled buttons — everything
  // beyond the quantity stepper (the most-used action) folds into this menu instead, so the tile
  // stays usable regardless of how many per-card actions the app grows.
  const menuActions: ContextMenuAction[] = []
  if (canDesignateCommander || deckCard.isCommander) {
    menuActions.push({
      label: deckCard.isCommander ? 'Unset as commander' : 'Set as commander',
      onSelect: () => onSetCommander(!deckCard.isCommander),
    })
  }
  menuActions.push({
    label: otherBoard === 'sideboard' ? 'Move to sideboard' : 'Move to mainboard',
    onSelect: onMoveBoard,
  })
  menuActions.push({ label: 'Remove', onSelect: onRemove })

  return (
    <div
      className={`deck-card-grid-item ${deckCard.isCommander ? 'is-commander' : ''} ${issueReasons.length > 0 ? 'has-issue' : ''}`}
      data-scryfall-id={deckCard.scryfallId}
      data-board={deckCard.board}
      title={issueReasons.length > 0 ? issueReasons.join('; ') : undefined}
      onContextMenu={snapshot ? onContextMenu : undefined}
      draggable
      onDragStart={(event) => setDragCardData(event, { scryfallId: deckCard.scryfallId, board: deckCard.board })}
      {...(snapshot ? hoverHandlers : {})}
      {...(snapshot ? { onMouseEnter: handleMouseEnter } : {})}
    >
      {image ? (
        <img src={getCardImageUrl(image, cardSize)} alt={name} />
      ) : (
        <div className="deck-card-grid-item__placeholder">{name}</div>
      )}
      {image && deckCard.foil && <FoilShine foil={deckCard.foil} point={foilPoint} />}
      {deckCard.isCommander && (
        <span className="deck-card-grid-item__commander-badge" title="Commander">
          ★
        </span>
      )}
      {(price !== undefined || typeof salt === 'number') && (
        <span className="deck-card-grid-item__price-salt">
          {price !== undefined && <span>{formatUsd(price)}</span>}
          {typeof salt === 'number' && <span title="EDHREC salt score">🧂 {salt.toFixed(1)}</span>}
        </span>
      )}
      <CardMarkChip mark={deckCard.mark} onSetMark={onSetMark} label={name} />
      <div className="deck-card-grid-item__overlay">
        <div className="deck-card-grid-item__qty">
          <button type="button" onClick={() => onSetQuantity(deckCard.quantity - 1)} aria-label={`Decrease ${name} quantity`}>
            −
          </button>
          <span>{deckCard.quantity}</span>
          <button type="button" onClick={() => onSetQuantity(deckCard.quantity + 1)} aria-label={`Increase ${name} quantity`}>
            +
          </button>
        </div>
        <button
          type="button"
          className="deck-card-grid-item__menu-trigger"
          aria-label={`More actions for ${name}`}
          aria-haspopup="menu"
          onClick={openMenu}
        >
          ⋮
        </button>
      </div>
      {menuAnchor && (
        <CardContextMenu x={menuAnchor.x} y={menuAnchor.y} actions={menuActions} onClose={() => setMenuAnchor(null)} />
      )}
    </div>
  )
}

export default DeckCardGridItem
