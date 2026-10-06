import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import cardBackImage from '../../assets/card-back.svg'
import type { ImageUris } from '../../api/scryfallTypes'
import { useHoverPreview } from '../../hooks/useHoverPreview'
import FoilShine from '../shared/FoilShine'
import { getSnapshotImage, type CardSnapshot } from '../../storage/cardCache'
import type { GameCard, GameZone } from '../../state/gameReducer'
import type { FoilKind } from '../../state/types'
import { playCue } from '../../utils/sound'
import { clearCurrentDragData, setGameDragData, type GroupOffset } from './dragGameCard'

// A broken CDN load gets a few spaced-out retries before giving up — same reasoning as
// hooks/useCardSnapshots.ts's fetch retries, just for the raw image request itself (which can
// fail even when the snapshot's image_uris data fetched successfully).
const IMAGE_RETRY_DELAYS_MS = [1000, 3000, 6000]

type CardArtProps = {
  image: ImageUris
  name: string
  foil?: FoilKind
  foilPoint?: { x: number; y: number }
}

/** Renders a card's art, retrying a failed image load a few times (remounting the `<img>` via a
 *  bumped `key` rather than altering the URL, so a retry still hits the CDN's own cache instead
 *  of being treated as a fresh, uncached request) before falling back to the same plain-text
 *  placeholder shown when there's no image data at all. Previously a broken image just sat there
 *  broken for the rest of the session with no recovery and no visual distinction from "loading." */
function CardArt({ image, name, foil, foilPoint }: CardArtProps) {
  const [attempt, setAttempt] = useState(0)
  const [pendingRetry, setPendingRetry] = useState(false)
  const [failed, setFailed] = useState(false)

  // A different URL (new card, or a flip to the other face) deserves a fresh set of attempts
  // rather than inheriting a previous image's exhausted retry count.
  useEffect(() => {
    setAttempt(0)
    setPendingRetry(false)
    setFailed(false)
  }, [image.small])

  useEffect(() => {
    if (!pendingRetry) return
    const timer = setTimeout(() => {
      setPendingRetry(false)
      setAttempt((a) => a + 1)
    }, IMAGE_RETRY_DELAYS_MS[attempt])
    return () => clearTimeout(timer)
  }, [pendingRetry, attempt])

  if (failed) {
    return <span className="playtest-card__placeholder playtest-card__placeholder--art-failed">{name}</span>
  }

  return (
    <span className="playtest-card__art">
      <img
        key={attempt}
        src={image.small}
        alt={name}
        draggable={false}
        onError={() => {
          if (attempt >= IMAGE_RETRY_DELAYS_MS.length) setFailed(true)
          else setPendingRetry(true)
        }}
      />
      {foil && <FoilShine foil={foil} point={foilPoint} />}
    </span>
  )
}

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
  /** Set on a `readOnly` card that's actually one of YOUR OWN — e.g. a revealed top-of-library
   *  card — to let it be dragged out to any other zone/the battlefield the same way a hand card
   *  can be, via the normal MOVE_CARD drop handlers (no RELOCATE_CARD/network involved, unlike
   *  `remoteOwnerId`). Mutually exclusive with `remoteOwnerId` in practice — a card is either
   *  someone else's (drag-to-reposition) or your own revealed library card (drag-to-move-zone),
   *  never both. */
  draggableFromZone?: GameZone
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

function PlaytestCard({ gameCard, snapshot, onClick, onContextMenu, readOnly, remoteOwnerId, draggableFromZone, hidden, entering, selected, groupOffsets, foil }: Props) {
  const face = gameCard.showBackFace ? 'back' : 'front'
  const image = hidden ? undefined : snapshot ? getSnapshotImage(snapshot, face) : undefined
  const name = hidden
    ? 'Face-down card'
    : ((gameCard.showBackFace ? snapshot?.card_faces?.[1]?.name : undefined) ?? snapshot?.name ?? gameCard.scryfallId)
  const fallbackCard = snapshot ?? { id: gameCard.scryfallId, oracle_id: '', name }
  // A hidden card has nothing this client could preview (its identity was never sent to us —
  // see the `hidden` prop doc) — hooks still run unconditionally, the handlers just never get
  // spread onto the element below. Same reasoning for `hidden` gating foil: no identity, no art, no shine.
  const [previewHandlers, foilPoint] = useHoverPreview(fallbackCard, face, { generic: gameCard.counters, pt: gameCard.ptCounters }, hidden ? undefined : foil)
  // Where the cursor last was over this card, while it is over it. The shared preview is only
  // ever written from mouse events, and no mouse event follows a card changing under a cursor
  // that isn't moving — so the preview kept showing what the card USED to be: the old face
  // after pressing F, and, worse, an opponent's real card after they turned it face down.
  const hoverPointRef = useRef<{ clientX: number; clientY: number; currentTarget: Element } | null>(null)
  const hoverHandlers: typeof previewHandlers = {
    ...previewHandlers,
    onMouseEnter: (event) => {
      hoverPointRef.current = { clientX: event.clientX, clientY: event.clientY, currentTarget: event.currentTarget }
      previewHandlers.onMouseEnter(event)
    },
    onMouseMove: (event) => {
      hoverPointRef.current = { clientX: event.clientX, clientY: event.clientY, currentTarget: event.currentTarget }
      previewHandlers.onMouseMove(event)
    },
    onMouseLeave: () => {
      hoverPointRef.current = null
      previewHandlers.onMouseLeave()
    },
  }
  const hasSnapshot = snapshot !== undefined
  useEffect(() => {
    const at = hoverPointRef.current
    if (!at) return
    if (hidden || !hasSnapshot) {
      // Nothing this client is allowed to show any more — take the preview down.
      hoverPointRef.current = null
      previewHandlers.onMouseLeave()
      return
    }
    previewHandlers.onMouseMove(at)
    // Re-run only when what the preview shows has changed; previewHandlers is rebuilt on every
    // one of these changes anyway, and listing it would re-fire on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, hasSnapshot, face, gameCard.counters, gameCard.ptCounters])
  // Chromium suppresses the click that follows a completed drag, but not
  // reliably when the drop is cancelled (Esc / dropped outside a target) —
  // guard so a failed drag never registers as a tap.
  const didDrag = useRef(false)

  function handleMouseEnter(event: MouseEvent) {
    playCue('hover')
    hoverHandlers.onMouseEnter(event)
  }

  // Opponents' cards: no tap/menu (all hooks above still run unconditionally), but draggable
  // purely to reposition when remoteOwnerId is set (see that prop's doc), or draggable out to any
  // zone/the battlefield when draggableFromZone is set (see that prop's doc — a revealed
  // top-of-library card, currently the only caller). `onClick` is still wired through here (unlike
  // a tap/context-menu) so the caller can react to an Alt+click flash-highlight gesture — the
  // caller itself is responsible for ignoring a plain click.
  const dragSource = remoteOwnerId
    ? { fromZone: 'battlefield' as const, fromPlayerId: remoteOwnerId }
    : draggableFromZone
      ? { fromZone: draggableFromZone }
      : undefined
  if (readOnly) {
    const readOnlyDragHandlers = dragSource
      ? {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            // Same failed-drag click guard as the interactive branch below — this used to not
            // matter here (a readOnly card's plain click did nothing), but now that clicking a
            // taken card taps it (see PlaytestView's opponent-loop onClick), a cancelled
            // reposition-drag must not fall through and register as a spurious tap.
            didDrag.current = true
            setGameDragData(event, { instanceId: gameCard.instanceId, ...dragSource })
          },
          onDragEnd: () => {
            clearCurrentDragData()
            setTimeout(() => (didDrag.current = false), 0)
          },
        }
      : {}
    return (
      <div
        className={`playtest-card playtest-card--readonly ${gameCard.tapped ? 'is-tapped' : ''} ${entering ? 'playtest-card--entering' : ''}`}
        aria-label={name}
        onClick={(event) => {
          if (didDrag.current) {
            didDrag.current = false
            return
          }
          onClick?.(event)
        }}
        {...readOnlyDragHandlers}
        {...(snapshot
          ? hidden
            // Still attach the leave/blur handlers even while hidden (just not enter/move/focus,
            // which would reveal this card's identity) — this is the top-of-library slot, whose
            // `hidden` flips on the F "reveal top card" toggle. Dropping every handler while hidden
            // (as this used to) meant that toggling F back to hidden *while still hovering* removed
            // onMouseLeave out from under a cursor that never actually left the element — no native
            // mouseleave event follows a prop change, so the shared preview stayed pinned on the
            // last-revealed card forever, the same "no browser event fires" trap the dragstart and
            // node-removal cases in HoverPreviewContext already guard against.
            ? { onMouseLeave: hoverHandlers.onMouseLeave, onBlur: hoverHandlers.onBlur }
            : { ...hoverHandlers, onMouseEnter: handleMouseEnter }
          : {})}
      >
        {hidden ? (
          <img src={cardBackImage} alt={name} draggable={false} />
        ) : image ? (
          <CardArt image={image} name={name} foil={foil} foilPoint={foilPoint} />
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
        <CardArt image={image} name={name} foil={foil} foilPoint={foilPoint} />
      ) : (
        <span className="playtest-card__placeholder">{name}</span>
      )}
    </button>
  )
}

export default PlaytestCard
