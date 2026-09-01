import { useHoverPreview } from '../../hooks/useHoverPreview'
import { getSnapshotImage, type CardSnapshot } from '../../storage/cardCache'

type Props = {
  commanderIds: string[]
  snapshots: Map<string, CardSnapshot>
}

/** One deck-manager row's commander art — an art-crop thumbnail per commander (1, or 2 for a
 *  partners/background pairing), falling back to a generic deck glyph for non-commander formats
 *  or a deck whose commander art hasn't been cached locally yet. */
function DeckManagerCommanders({ commanderIds, snapshots }: Props) {
  if (commanderIds.length === 0) {
    return (
      <span className="deck-manager-row__art deck-manager-row__art--empty" aria-hidden="true">
        🂠
      </span>
    )
  }

  return (
    <span className="deck-manager-row__art">
      {commanderIds.map((id) => (
        <CommanderThumb key={id} scryfallId={id} snapshot={snapshots.get(id)} />
      ))}
    </span>
  )
}

function CommanderThumb({ scryfallId, snapshot }: { scryfallId: string; snapshot: CardSnapshot | undefined }) {
  const fallbackCard = snapshot ?? { id: scryfallId, oracle_id: '', name: '' }
  const [hoverHandlers] = useHoverPreview(fallbackCard)
  const image = snapshot ? getSnapshotImage(snapshot) : undefined
  const thumb = image?.art_crop ?? image?.small

  return (
    <span className="deck-manager-row__commander-thumb" {...(snapshot ? hoverHandlers : {})}>
      {thumb ? <img src={thumb} alt={snapshot?.name ?? 'Commander'} draggable={false} /> : null}
    </span>
  )
}

export default DeckManagerCommanders
