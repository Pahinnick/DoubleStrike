import { useState } from 'react'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import { getSnapshotImage, type CardSnapshot } from '../../storage/cardCache'
import type { GameCard, GameZone } from '../../state/gameReducer'
import type { FoilKind } from '../../state/types'

type Entry = { gameCard: GameCard; snapshot: CardSnapshot | undefined; foil?: FoilKind }

type Props = {
  label: string
  entries: Entry[]
  onMove?: (instanceId: string, toZone: GameZone) => void
  onClose: () => void
  note?: string
  /** Shows a name/type filter box above the list — meant for the library ("tutor") view, where the
   *  list can be the whole deck; graveyard/exile are small enough not to need it. */
  searchable?: boolean
  /** Display only (no move buttons) — used for viewing an opponent's graveyard/exile in a pod. */
  readOnly?: boolean
  /** The zone being shown, so its rows don't offer moving a card to where it already is. */
  zone?: GameZone
}

function matchesQuery(entry: Entry, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const name = entry.snapshot?.name ?? ''
  const typeLine = entry.snapshot?.type_line ?? ''
  return name.toLowerCase().includes(q) || typeLine.toLowerCase().includes(q)
}

/** Where a card in the viewer can be sent: every zone but the one it's already in. "Library"
 *  puts it on top; "Field" plays it to a free spot. */
const MOVE_TARGETS: { zone: GameZone; label: string; title?: string }[] = [
  { zone: 'hand', label: 'Hand' },
  { zone: 'battlefield', label: 'Field' },
  { zone: 'graveyard', label: 'Graveyard' },
  { zone: 'exile', label: 'Exile' },
  { zone: 'library', label: 'Library', title: 'Put on top of library' },
]

function ZoneViewerRow({ entry, onMove, zone }: { entry: Entry; onMove?: Props['onMove']; zone?: GameZone }) {
  const { gameCard, snapshot, foil } = entry
  const name = snapshot?.name ?? gameCard.scryfallId
  const image = snapshot ? getSnapshotImage(snapshot) : undefined
  const [hoverHandlers] = useHoverPreview(snapshot ?? { id: gameCard.scryfallId, oracle_id: '', name }, 'front', undefined, foil)

  return (
    <li className="zone-viewer__row" {...(snapshot ? hoverHandlers : {})}>
      {image ? <img src={image.small} alt="" /> : <span className="zone-viewer__img-placeholder" />}
      <span className="zone-viewer__name">{name}</span>
      {onMove &&
        MOVE_TARGETS.filter((t) => t.zone !== zone).map((t) => (
          <button key={t.zone} type="button" title={t.title} onClick={() => onMove(gameCard.instanceId, t.zone)}>
            {t.label}
          </button>
        ))}
    </li>
  )
}

function ZoneViewerModal({ label, entries, onMove, onClose, note, searchable, readOnly, zone }: Props) {
  useEscapeToClose(onClose)
  const [query, setQuery] = useState('')
  const filtered = searchable ? entries.filter((entry) => matchesQuery(entry, query)) : entries
  const rowMove = readOnly ? undefined : onMove

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="modal-content zone-viewer" onClick={(event) => event.stopPropagation()}>
        <h2>
          {label} ({entries.length})
        </h2>
        {note && <p className="zone-viewer__note">{note}</p>}
        {searchable && (
          <input
            type="text"
            className="zone-viewer__search"
            placeholder="Search name or type..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        )}
        {entries.length === 0 && <p className="search-status">Nothing here.</p>}
        {entries.length > 0 && filtered.length === 0 && <p className="search-status">No matches.</p>}
        <ul className="zone-viewer__list">
          {filtered.map((entry) => (
            <ZoneViewerRow key={entry.gameCard.instanceId} entry={entry} onMove={rowMove} zone={zone} />
          ))}
        </ul>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export default ZoneViewerModal
