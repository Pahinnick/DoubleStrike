import { passDirection, seatsInTableOrder } from '../../draft/draftEngine'
import type { Seat } from '../../net/protocol'
import { SEAT_COLORS } from '../playtest/podLayout'
import './draft.css'

type Props = {
  roster: Partial<Record<Seat, string>>
  picksBySeat: Partial<Record<Seat, number>>
  mySeat: Seat | null
  /** The round of the pack you're holding, for the pass-direction hint (null while waiting). */
  round: number | null
  /** Seats whose player has lost their connection — their packs wait for them. */
  awaySeats: readonly Seat[]
  /** Away seats the host has chosen to pick for. */
  autoPickingSeats: readonly Seat[]
  /** Host only: start picking for an away seat. Absent for guests. */
  onPickForSeat?: (seat: Seat) => void
}

/** Sparse pick counts only — never pack/pool contents (see DraftProgressMessage's privacy
 *  note) — so this can only ever show "how far along," not "what everyone has." Listed in seat
 *  order, which is the order packs travel. */
function DraftProgressBar({ roster, picksBySeat, mySeat, round, awaySeats, autoPickingSeats, onPickForSeat }: Props) {
  const seats = seatsInTableOrder(Object.keys(roster).map((s) => Number(s) as Seat))
  const direction = round === null ? null : passDirection(round)

  return (
    <div className="draft-progress-wrap">
      <ul className="draft-progress">
        {seats.map((seat) => {
          const away = awaySeats.includes(seat)
          const hostPicking = autoPickingSeats.includes(seat)
          return (
            <li key={seat} className={[seat === mySeat && 'is-self', away && 'is-away'].filter(Boolean).join(' ')}>
              <span className="draft-seat__dot" style={{ backgroundColor: SEAT_COLORS[seat] }} aria-hidden="true" />
              <span className="draft-progress__name">
                {roster[seat]} <span className="draft-progress__table">· Table {Math.floor(seat / 2) + 1}</span>
              </span>
              <span className="draft-progress__count">{picksBySeat[seat] ?? 0} picked</span>
              {away && (
                <span className="draft-progress__away">
                  {hostPicking ? 'Host is picking' : 'Disconnected — packs wait for them'}
                </span>
              )}
              {away && !hostPicking && onPickForSeat && (
                <button
                  type="button"
                  className="draft-progress__pick-for"
                  title="Only if they aren't coming back: the host picks for this seat (best rarity, their colors) so everyone else can finish. Stops if they reconnect."
                  onClick={() => onPickForSeat(seat)}
                >
                  Pick for them
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {direction !== null && seats.length > 1 && (
        <p className="draft-progress__direction">
          Pack {round !== null ? round + 1 : ''} passes {direction === 1 ? 'down the list ↓' : 'up the list ↑'}
        </p>
      )}
    </div>
  )
}

export default DraftProgressBar
