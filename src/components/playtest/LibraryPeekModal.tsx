import { useState } from 'react'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import { getSnapshotImage, type CardSnapshot } from '../../storage/cardCache'
import type { GameCard } from '../../state/gameReducer'
import type { FoilKind } from '../../state/types'

export type PeekDestination = 'top' | 'bottom' | 'graveyard' | 'hand'

const DESTINATION_LABEL: Record<PeekDestination, string> = {
  top: 'Top',
  bottom: 'Bottom',
  graveyard: 'Graveyard',
  hand: 'Take to Hand',
}

/** Destinations that land back in the library, where the relative order between same-destination
 *  cards is meaningful (it's what you'll draw next) and worth showing/letting the user change.
 *  Graveyard and hand are unordered piles as far as this app is concerned. */
const ORDERED_DESTINATIONS: PeekDestination[] = ['top', 'bottom']

export type PeekEntry = {
  gameCard: GameCard
  snapshot: CardSnapshot | undefined
  /** Choices offered for this card, in display order. A single option means the choice is forced
   *  (e.g. a land auto-exiled by cascade) and renders as a plain label instead of buttons. */
  options: [PeekDestination, ...PeekDestination[]]
  foil?: FoilKind
}

export type PeekPlacement = { instanceId: string; destination: PeekDestination }

type Props = {
  title: string
  /** Shown once, above the list — e.g. explaining cascade's auto-skip or that bottom order will be randomized. */
  note?: string
  entries: PeekEntry[]
  /** If true, the bottom pile gets shuffled after cards are moved there, so its order doesn't matter. */
  shuffleBottom?: boolean
  onConfirm: (placements: PeekPlacement[]) => void
  onClose: () => void
}

function PeekRow({
  entry,
  destination,
  position,
  groupSize,
  showOrderControls,
  onChangeDestination,
  onMove,
}: {
  entry: PeekEntry
  destination: PeekDestination
  position: number
  groupSize: number
  showOrderControls: boolean
  onChangeDestination: (destination: PeekDestination) => void
  onMove: (direction: -1 | 1) => void
}) {
  const { gameCard, snapshot, options, foil } = entry
  const name = snapshot?.name ?? gameCard.scryfallId
  const image = snapshot ? getSnapshotImage(snapshot) : undefined
  const [hoverHandlers] = useHoverPreview(snapshot ?? { id: gameCard.scryfallId, oracle_id: '', name }, 'front', undefined, foil)

  return (
    <li className="zone-viewer__row" {...(snapshot ? hoverHandlers : {})}>
      {image ? <img src={image.small} alt="" /> : <span className="zone-viewer__img-placeholder" />}
      <span className="zone-viewer__name">{name}</span>
      {options.length === 1 ? (
        <span className="peek-row__forced">{DESTINATION_LABEL[options[0]]}</span>
      ) : (
        options.map((option) => (
          <button
            key={option}
            type="button"
            className={option === destination ? 'is-selected' : ''}
            onClick={() => onChangeDestination(option)}
          >
            {DESTINATION_LABEL[option]}
          </button>
        ))
      )}
      {showOrderControls && groupSize > 1 && (
        <span className="peek-row__order" title={`${DESTINATION_LABEL[destination]} order: ${position} of ${groupSize}`}>
          <span className="peek-row__order-position">{position}</span>
          <span className="peek-row__order-buttons">
            <button
              type="button"
              disabled={position === 1}
              aria-label={`Move up in ${DESTINATION_LABEL[destination].toLowerCase()} order`}
              onClick={() => onMove(-1)}
            >
              ▲
            </button>
            <button
              type="button"
              disabled={position === groupSize}
              aria-label={`Move down in ${DESTINATION_LABEL[destination].toLowerCase()} order`}
              onClick={() => onMove(1)}
            >
              ▼
            </button>
          </span>
        </span>
      )}
    </li>
  )
}

function LibraryPeekModal({ title, note, entries, shuffleBottom = false, onConfirm, onClose }: Props) {
  useEscapeToClose(onClose)
  const [destinations, setDestinations] = useState<Map<string, PeekDestination>>(
    () => new Map(entries.map((entry) => [entry.gameCard.instanceId, entry.options[0]])),
  )
  // The order cards will be put back in — rendered top-to-bottom in this sequence. Reordering only
  // ever swaps two entries that share a destination, since order across destinations is meaningless
  // (a card going to the bottom doesn't have a "position" relative to one going to the top).
  const [order, setOrder] = useState<string[]>(() => entries.map((entry) => entry.gameCard.instanceId))

  function setDestination(instanceId: string, destination: PeekDestination) {
    setDestinations((prev) => new Map(prev).set(instanceId, destination))
  }

  function moveInGroup(instanceId: string, direction: -1 | 1) {
    setOrder((prev) => {
      const destination = destinations.get(instanceId)
      const groupIndices = prev.reduce<number[]>((acc, id, i) => {
        if (destinations.get(id) === destination) acc.push(i)
        return acc
      }, [])
      const posInGroup = groupIndices.indexOf(prev.indexOf(instanceId))
      const swapWith = groupIndices[posInGroup + direction]
      if (swapWith === undefined) return prev
      const i = groupIndices[posInGroup]
      const next = [...prev]
      ;[next[i], next[swapWith]] = [next[swapWith], next[i]]
      return next
    })
  }

  const entryById = new Map(entries.map((entry) => [entry.gameCard.instanceId, entry]))
  const groupSizes = new Map<PeekDestination, number>()
  for (const destination of destinations.values()) {
    groupSizes.set(destination, (groupSizes.get(destination) ?? 0) + 1)
  }
  const positionInGroup = new Map<string, number>()
  const runningCount = new Map<PeekDestination, number>()
  for (const id of order) {
    const destination = destinations.get(id)!
    const nextPosition = (runningCount.get(destination) ?? 0) + 1
    runningCount.set(destination, nextPosition)
    positionInGroup.set(id, nextPosition)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal-content zone-viewer" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {note && <p className="zone-viewer__note">{note}</p>}
        {entries.length === 0 && <p className="search-status">Nothing left in your library.</p>}
        <ul className="zone-viewer__list">
          {order.map((instanceId) => {
            const entry = entryById.get(instanceId)!
            const destination = destinations.get(instanceId)!
            const groupSize = groupSizes.get(destination) ?? 1
            return (
              <PeekRow
                key={instanceId}
                entry={entry}
                destination={destination}
                position={positionInGroup.get(instanceId)!}
                groupSize={groupSize}
                showOrderControls={ORDERED_DESTINATIONS.includes(destination) && !(destination === 'bottom' && shuffleBottom)}
                onChangeDestination={(next) => setDestination(instanceId, next)}
                onMove={(direction) => moveInGroup(instanceId, direction)}
              />
            )
          })}
        </ul>
        <button
          type="button"
          onClick={() => onConfirm(order.map((instanceId) => ({ instanceId, destination: destinations.get(instanceId)! })))}
        >
          Confirm
        </button>
      </div>
    </div>
  )
}

export default LibraryPeekModal
