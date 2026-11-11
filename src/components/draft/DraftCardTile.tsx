import type { TaggableCard } from '../../api/scryfallTypes'
import { parseDraftCardKey } from '../../draft/draftCard'
import type { DraftCardArt } from '../../hooks/useDraftCardArt'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import FoilShine from '../shared/FoilShine'

type Props = {
  /** A draft card key (Scryfall id, optionally marked foil — see draft/draftCard.ts). */
  cardKey: string
  art: DraftCardArt
  size: 'small' | 'normal' | 'large'
  onClick?: () => void
  disabled?: boolean
  /** Small corner label, e.g. a copy count in the deck builder. */
  badge?: string
  className?: string
}

const PLACEHOLDER: TaggableCard = { id: '', oracle_id: '', name: '' }

/** One card in a draft pack, pool or the post-draft builder: its art (with automatic retry — see
 *  useDraftCardArt), a foil shine when the copy was opened foil, and the shared hover preview. While
 *  art is unavailable it shows the card's name, or "Loading…" until even that has arrived. */
function DraftCardTile({ cardKey, art, size, onClick, disabled, badge, className }: Props) {
  const { scryfallId, foil } = parseDraftCardKey(cardKey)
  const snapshot = art.snapshotFor(scryfallId)
  const image = art.imageFor(scryfallId, size)
  const [hoverHandlers, foilPoint] = useHoverPreview(snapshot ?? PLACEHOLDER, 'front', undefined, foil ? 'classic' : undefined)
  const name = snapshot?.name ?? 'Loading…'

  return (
    <button
      type="button"
      className={['draft-card', foil && 'draft-card--foil', className].filter(Boolean).join(' ')}
      onClick={onClick}
      disabled={disabled}
      title={foil ? `${name} (foil)` : name}
      aria-label={foil ? `${name}, foil` : name}
      {...(snapshot ? hoverHandlers : {})}
    >
      {image ? (
        <img src={image} alt="" draggable={false} onError={() => art.reportImageError(scryfallId)} />
      ) : (
        <span className="draft-card__noimage">{name}</span>
      )}
      {foil && image && <FoilShine foil="classic" point={foilPoint} />}
      {badge && <span className="draft-card__badge">{badge}</span>}
    </button>
  )
}

export default DraftCardTile
