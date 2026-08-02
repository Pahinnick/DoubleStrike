import { useRef, type DragEvent, type MouseEvent } from 'react'
import cardBackImage from '../../assets/card-back.svg'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import FoilShine from '../shared/FoilShine'
import { getSnapshotImage, type CardSnapshot } from '../../storage/cardCache'
import type { GameCard } from '../../state/gameReducer'
import type { FoilKind } from '../../state/types'
import { playCue } from '../../utils/sound'
import { clearCurrentDragData, setGameDragData, type GroupOffset } from './dragGameCard'

// Shrunk well below the card's real 90x126 render size — the browser's default drag image
// is the full card, which sits right where the drop-position preview needs to be seen.
const DRAG_IMAGE_SCALE = 0.45

type Props = {
  gameCard: GameCard
  snapshot: CardSnapshot | undefined
  onClick?: (event: MouseEvent) => void
  onContextMenu?: (event: MouseEvent) => void
  /** Opponents' battlefield cards: no tap/menu, but hover preview still works so you can read
   *  them. Draggable-for-reposition-only when `remoteOwnerId` is set (see that prop) — otherwise
   *  fully inert. */
  readOnly?: boolean
  /** Set on a `readOnly` card to allow dragging it purely to reposition it (anywhere on the
   *  shared table, including back onto its owner's own board) without taking control of it —
   *  the "move any card anywhere" table-talk feature. Value is the card's actual owning
   *  player's id, so the drop handler knows whose board to send the RELOCATE_CARD to. Grants
   *  no other interaction: still no tap/click/context-menu, since those remain the owner's call. */
  remoteOwnerId?: string
  /** Forces a generic card-back regardless of `snapshot`/`gameCard.faceDown` — used for an
   *  opponent's face-down card, whose real identity this client was never sent (see
   *  toPublicCard/FACE_DOWN_SCRYFALL_ID) and so genuinely cannot render. Distinct from your own
   *  face-down card, which still shows its real art to you (see the `is-face-down` class below)
   *  — only the *viewer* determines whether a face-down card is hidden, not the card itself. */
  hidden?: boolean
  /** Briefly played just now — plays a pop/glow entrance animation to draw the eye. */
  entering?: boolean
  /** Shift-click multi-select (battlefield only) — shows a highlight ring. */
  selected?: boolean
  /** Other selected battlefield cards' offsets from this one, so dragging any selected card
   *  moves the whole group together. Only meaningful when `selected` and there's more than
   *  one card selected — see PlaytestView's battlefield render loop. */
  groupOffsets?: GroupOffset[]
  /** Holographic shader for this card's art, if the deck entry it came from has one set (see
   *  DeckCard.foil) — omitted entirely by the caller for opponents' cards, since foil is a local
   *  cosmetic choice on each player's own deck that never goes out over the wire. */
  foil?: FoilKind
}

function PlaytestCard({ gameCard, snapshot, onClick, onContextMenu, readOnly, remoteOwnerId, hidden, entering, selected, groupOffsets, foil }: Props) {
  const face = gameCard.showBackFace ? 'back' : 'front'
  const image = hidden ? undefined : snapshot ? getSnapshotImage(snapshot, face) : undefined
  const name = hidden
    ? 'Face-down card'
    : ((gameCard.showBackFace ? snapshot?.card_faces?.[1]?.name : undefined) ?? snapshot?.name ?? gameCard.scryfallId)
  const fallbackCard = snapshot ?? { id: gameCard.scryfallId, oracle_id: '', name }
  // A hidden card has nothing this client could preview (its identity was never sent to us —
  // see the `hidden` prop doc) — hooks still run unconditionally, the handlers just never get
  // spread onto the element below. Same reasoning for `hidden` gating foil: no identity, no art, no shine.
  const [hoverHandlers, foilPoint] = useHoverPreview(fallbackCard, face, { generic: gameCard.counters, pt: gameCard.ptCounters }, hidden ? undefined : foil)
  // Chromium suppresses the click that follows a completed drag, but not
  // reliably when the drop is cancelled (Esc / dropped outside a target) —
  // guard so a failed drag never registers as a tap.
  const didDrag = useRef(false)

  function handleMouseEnter(event: MouseEvent) {
    playCue('hover')
    hoverHandlers.onMouseEnter(event)
  }

  // Opponents' cards: no tap/menu (all hooks above still run unconditionally), but draggable
  // purely to reposition when remoteOwnerId is set (see that prop's doc). `onClick` is still
  // wired through here (unlike a tap/context-menu) so the caller can react to an Alt+click
  // flash-highlight gesture — the caller itself is responsible for ignoring a plain click.
  if (readOnly) {
    const remoteDragHandlers = remoteOwnerId
      ? {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            setGameDragData(event, { instanceId: gameCard.instanceId, fromZone: 'battlefield', fromPlayerId: remoteOwnerId })
          },
          onDragEnd: () => clearCurrentDragData(),
        }
      : {}
    return (
      <div
        className={`playtest-card playtest-card--readonly ${gameCard.tapped ? 'is-tapped' : ''} ${entering ? 'playtest-card--entering' : ''}`}
        aria-label={name}
        onClick={onClick}
        {...remoteDragHandlers}
        {...(snapshot && !hidden ? { ...hoverHandlers, onMouseEnter: handleMouseEnter } : {})}
      >
        {hidden ? (
          <img src={cardBackImage} alt={name} draggable={false} />
        ) : image ? (
          <span className="playtest-card__art">
            <img src={image.small} alt={name} draggable={false} />
            {foil && <FoilShine foil={foil} point={foilPoint} />}
          </span>
        ) : (
          <span className="playtest-card__placeholder">{name}</span>
        )}
      </div>
    )
  }

  function handleDragStart(event: DragEvent) {
    didDrag.current = true

    // Custom drag image, well smaller than the real card (and always centered under the
    // cursor), so it doesn't sit right on top of the drop-position preview. Same src the
    // visible card already uses, so it paints from cache instantly; removed right after the
    // browser snapshots it. Purely cosmetic — where the card actually lands is computed
    // independently in PlaytestView from its own fixed battlefield card size, not from this
    // element's rendered size (which varies: hand cards render much bigger than battlefield
    // ones), so a shrunk/mismatched drag image here can't throw off the real drop position.
    if (image) {
      const rect = event.currentTarget.getBoundingClientRect()
      const dragImg = document.createElement('img')
      dragImg.src = image.small
      dragImg.style.width = `${rect.width * DRAG_IMAGE_SCALE}px`
      dragImg.style.height = `${rect.height * DRAG_IMAGE_SCALE}px`
      dragImg.style.position = 'fixed'
      dragImg.style.top = '-9999px'
      dragImg.style.borderRadius = '5px'
      document.body.appendChild(dragImg)
      event.dataTransfer.setDragImage(dragImg, (rect.width * DRAG_IMAGE_SCALE) / 2, (rect.height * DRAG_IMAGE_SCALE) / 2)
      window.setTimeout(() => document.body.removeChild(dragImg), 0)
    }

    setGameDragData(event, {
      instanceId: gameCard.instanceId,
      fromZone: gameCard.zone,
      groupOffsets: selected ? groupOffsets : undefined,
    })
  }

  function handleClick(event: MouseEvent) {
    event.stopPropagation()
    if (didDrag.current) {
      didDrag.current = false
      return
    }
    onClick?.(event)
  }

  function handleContextMenu(event: MouseEvent) {
    if (!onContextMenu) return
    event.preventDefault()
    event.stopPropagation()
    onContextMenu(event)
  }

  return (
    <button
      type="button"
      className={`playtest-card ${gameCard.tapped ? 'is-tapped' : ''} ${entering ? 'playtest-card--entering' : ''} ${selected ? 'is-selected' : ''} ${gameCard.faceDown ? 'is-face-down' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => {
        clearCurrentDragData()
        setTimeout(() => (didDrag.current = false), 0)
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      aria-label={gameCard.faceDown ? `${name} (face down — only you can see this)` : name}
      {...(snapshot ? { ...hoverHandlers, onMouseEnter: handleMouseEnter } : {})}
    >
      {image ? (
        <span className="playtest-card__art">
          <img src={image.small} alt={name} draggable={false} />
          {foil && <FoilShine foil={foil} point={foilPoint} />}
        </span>
      ) : (
        <span className="playtest-card__placeholder">{name}</span>
      )}
    </button>
  )
}

export default PlaytestCard
