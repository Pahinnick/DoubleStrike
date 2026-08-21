import { useMemo, useState } from 'react'
import CardMarkChip from '../shared/CardMarkChip'
import { groupByCategory, type DeckCardEntry } from '../../engine/deckGrouping'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import { getSnapshotImage, type CardSnapshot } from '../../storage/cardCache'
import type { Deck } from '../../state/types'

type Props = {
  deck: Deck
  snapshots: Map<string, CardSnapshot>
  onSetMark: (scryfallId: string, mark: string | undefined) => void
}

function DeckScanRow({ deckCard, snapshot, onSetMark }: DeckCardEntry & { onSetMark: Props['onSetMark'] }) {
  const name = snapshot?.name ?? deckCard.scryfallId
  const fallbackCard = snapshot ?? { id: deckCard.scryfallId, oracle_id: '', name }
  const [hoverHandlers] = useHoverPreview(fallbackCard, 'front', undefined, deckCard.foil)
  const image = snapshot ? getSnapshotImage(snapshot) : undefined

  return (
    <div className="playtest__deck-tray-row" {...(snapshot ? hoverHandlers : {})}>
      <div className="playtest__deck-tray-thumb-wrap">
        {image ? (
          <img className="playtest__deck-tray-thumb" src={image.small} alt="" />
        ) : (
          <div className="playtest__deck-tray-thumb playtest__deck-tray-thumb--placeholder" />
        )}
        <CardMarkChip mark={deckCard.mark} onSetMark={(mark) => onSetMark(deckCard.scryfallId, mark)} label={name} />
      </div>
      <span className="playtest__deck-tray-qty">{deckCard.quantity}×</span>
      <span className="playtest__deck-tray-name">{name}</span>
    </div>
  )
}

/** Slide-out left-side panel listing the full decklist for reference during a game — user request:
 *  "a way to just scan the deck's cards without looking at the deck order." Deliberately reads from
 *  `deck.cards`/`deck.categories` (the static decklist), never live game state (library/hand/
 *  battlefield), so it can't be used to see what's coming up next in the shuffled library — only
 *  "what's in this deck." Reuses the deck builder's own `groupByCategory` so the grouping matches
 *  what the player already knows from building the deck. */
function DeckScanTray({ deck, snapshots, onSetMark }: Props) {
  const [open, setOpen] = useState(false)

  const entries: DeckCardEntry[] = useMemo(
    () =>
      deck.cards
        .filter((c) => c.board === 'mainboard' && !c.isToken)
        .map((deckCard) => ({ deckCard, snapshot: snapshots.get(deckCard.scryfallId) })),
    [deck.cards, snapshots],
  )
  const groups = useMemo(() => groupByCategory(entries, deck.categories), [entries, deck.categories])
  const totalCount = entries.reduce((sum, entry) => sum + entry.deckCard.quantity, 0)

  return (
    <div
      className={`playtest__deck-tray ${open ? 'is-open' : ''}`}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="playtest__deck-tray-tab"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={open ? 'Close deck list' : 'Open deck list'}
      >
        📖 Deck List
      </button>
      <div className="playtest__deck-tray-panel">
        <div className="playtest__deck-tray-header">
          <h3>{deck.name}</h3>
          <span className="playtest__deck-tray-count">{totalCount} cards</span>
        </div>
        <p className="playtest__deck-tray-hint">Reference only — not tied to your library's actual order.</p>
        <div className="playtest__deck-tray-list">
          {groups.map((group) => (
            <div key={group.label || 'all'} className="playtest__deck-tray-group">
              {group.label && <h4>{group.label}</h4>}
              {group.entries.map(({ deckCard, snapshot }) => (
                <DeckScanRow
                  key={`${deckCard.scryfallId}-${deckCard.category ?? ''}`}
                  deckCard={deckCard}
                  snapshot={snapshot}
                  onSetMark={onSetMark}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DeckScanTray
