import { createPortal } from 'react-dom'
import { getDisplayImage } from '../../api/scryfall'
import CounterPileStack from '../playtest/CounterPileStack'
import { counterPileLabel, counterPileName, formatPtCounters } from '../playtest/counterFormat'
import FoilShine from './FoilShine'
import { useHoverPreviewContext } from './HoverPreviewContext'

const PREVIEW_WIDTH = 300
const PREVIEW_HEIGHT = 418
const GAP = 20
// Above every other overlay/modal in the app (the Similar Cards panel peaks at 3000),
// so the preview never renders behind — and visibly darkened under — a modal backdrop.
const Z_INDEX = 4000

function CardHoverPreview() {
  const { hover, previewScale } = useHoverPreviewContext()
  if (!hover) return null

  const image = getDisplayImage(hover.card, hover.face)
  if (!image) return null

  const width = PREVIEW_WIDTH * previewScale
  const height = PREVIEW_HEIGHT * previewScale
  const name = (hover.face === 'back' ? hover.card.card_faces?.[1]?.name : undefined) ?? hover.card.name
  const { point, counters } = hover
  const overflowsRight = point.x + GAP + width > window.innerWidth
  const left = overflowsRight ? point.x - GAP - width : point.x + GAP
  const top = Math.min(Math.max(8, point.y - height / 3), window.innerHeight - height - 8)
  // Same edge-anchored stacks (and the same playtest.css positioning) as the battlefield card
  // itself, so a pile reads in the same place whether you're looking at the small card or this
  // magnified hover preview. counterPileLabel (not a bare signed number) so a keyword-ability
  // pile (lifelink, flying, etc.) shows its abbreviation here too, same as on the real card —
  // this used to always show "+1" instead of e.g. "LL" for those.
  const genericItems = (counters?.generic ?? []).map((p) => ({
    id: p.id,
    color: p.color,
    text: counterPileLabel(p),
    name: counterPileName(p.color),
  }))
  const ptItems = (counters?.pt ?? []).map((p) => ({ id: p.id, color: p.color, text: formatPtCounters(p) }))

  return createPortal(
    <div style={{ position: 'fixed', top, left: Math.max(8, left), width, zIndex: Z_INDEX, pointerEvents: 'none' }}>
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)' }}>
        <img src={image.large ?? image.normal} alt={name} style={{ display: 'block', width: '100%' }} />
        {hover.foil && hover.foilPoint && <FoilShine foil={hover.foil} point={hover.foilPoint} />}
      </div>
      <CounterPileStack items={genericItems} side="left" scale={previewScale} />
      <CounterPileStack items={ptItems} side="right" scale={previewScale} />
    </div>,
    document.body,
  )
}

export default CardHoverPreview
