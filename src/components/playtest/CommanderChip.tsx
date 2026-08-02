import { useHoverPreview } from '../../hooks/useHoverPreview'
import { getSnapshotImage, type CardSnapshot } from '../../storage/cardCache'

type Props = {
  scryfallId: string
  name: string
  snapshot: CardSnapshot | undefined
}

/** A tiny hoverable thumbnail of a commander, shown next to a seat's nameplate (see
 *  SeatOverlay's `commanders` prop) — hovering shows the full card via the same shared
 *  hover-preview portal every other card thumbnail in Playtest uses, so players can check
 *  what a commander actually does without needing a full-size render inline in the nameplate. */
function CommanderChip({ scryfallId, name, snapshot }: Props) {
  const fallbackCard = snapshot ?? { id: scryfallId, oracle_id: '', name }
  const [hoverHandlers] = useHoverPreview(fallbackCard)
  const image = snapshot ? getSnapshotImage(snapshot) : undefined
  // A square-ish art crop reads far better than a full card squeezed into ~18px than the
  // full-card "small" image would; falls back to it when a crop isn't available.
  const thumb = image?.art_crop ?? image?.small

  return (
    <span className="playtest__seat-commander-chip" title={name} {...(snapshot ? hoverHandlers : {})}>
      {thumb ? <img src={thumb} alt={name} draggable={false} /> : <span className="playtest__seat-commander-chip-fallback">{name[0]}</span>}
    </span>
  )
}

export default CommanderChip
