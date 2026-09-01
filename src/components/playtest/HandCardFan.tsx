import type { CSSProperties } from 'react'
import cardBackImage from '../../assets/card-back.svg'

type Props = {
  count: number
}

// A generic capped fan, not a card-per-count render, past this point — this is a glance-only
// table decoration (unlike the real hand, nobody needs to individually pick out card N of 14
// here), so past a normal hand size it just shows "a full hand" and lets the count badge (which
// is always the real number, capped or not) carry the rest. Equal to MANY_CARDS_THRESHOLD on
// purpose — every count that still gets the spread shape at all shows every one of its cards, so
// there's no confusing middle ground where two different real counts (say 9 and 12) render
// identically; once a hand exceeds this it switches shape entirely (see isPile) rather than
// just capping the same look at a smaller, misleading number.
const MAX_FAN_CARDS = 12
// Past this many cards, the fan switches to PILE_CARDS shown in the tight, shared-pivot
// closed-stack shape (this component's original design, before it became the wider flexbox
// spread below) specifically so a genuinely large hand looks visibly different from a normal-
// sized one, not just the same shape capped.
const MANY_CARDS_THRESHOLD = 12
const PILE_CARDS = 5

/** A fanned stack of face-down card-backs plus a numeric count — a visual (and, since a fan alone
 *  gets hard to eyeball past a handful of cards, unambiguous) read of how many cards a seat is
 *  holding, rendered on the table itself right under that seat's name label (see PlaytestView),
 *  the same at-a-glance idea as the name label itself but for hand size instead of identity. Never
 *  reveals anything about the actual cards (a real hand stays private, same as always — see
 *  PublicBoard.handCount, which is all this reads for an opponent). This is a *second*, table-side
 *  readout, not a replacement for the "🂠 N" chip already on the seat's card in the player panel
 *  sidebar (see SeatOverlay) — that one stays as-is.
 *
 *  Up to MANY_CARDS_THRESHOLD, each card gets its own place in the row (flexbox + overlap, like
 *  the real hand fan's own technique — see PlaytestView's `hand.map`/playtest.css's
 *  `.playtest__hand-card`) rather than every card pivoting off one shared anchor point, so the fan
 *  reads as spread out rather than a tight closed stack — but noticeably tighter than the real
 *  hand's own spread (see the CSS): this one is never meant to be individually read card-by-card,
 *  just eyeballed for roughly how full a hand is. Past that threshold it switches to the tight
 *  pivot shape instead (see PILE_CARDS/MANY_CARDS_THRESHOLD) — a deliberately different silhouette
 *  for "a lot of cards" rather than just capping the same spread shape, which otherwise reads as a
 *  precise, ordinary-sized hand no matter how large the real count actually is. */
function HandCardFan({ count }: Props) {
  if (count === 0) return null

  const isPile = count > MANY_CARDS_THRESHOLD
  const shown = isPile ? PILE_CARDS : Math.min(count, MAX_FAN_CARDS)
  const center = (shown - 1) / 2
  const step = shown > 1 ? Math.min(isPile ? 12 : 9, (isPile ? 40 : 60) / (shown - 1)) : 0

  return (
    <div className="playtest__hand-fan-mini" role="img" aria-label={`${count} card${count === 1 ? '' : 's'} in hand`}>
      <div className={`playtest__hand-fan-mini-cards ${isPile ? 'is-pile' : ''}`}>
        {Array.from({ length: shown }, (_, i) => {
          const angle = (i - center) * step
          return (
            <img
              key={i}
              src={cardBackImage}
              alt=""
              aria-hidden="true"
              className={`playtest__hand-fan-mini-card ${isPile ? 'is-piled' : ''}`}
              style={{ '--fan-angle': `${angle}deg`, zIndex: i } as CSSProperties}
              draggable={false}
            />
          )
        })}
      </div>
      <span className="playtest__hand-fan-mini-count" aria-hidden="true">
        🂠 {count}
      </span>
    </div>
  )
}

export default HandCardFan
