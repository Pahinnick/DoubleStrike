import type { Seat } from '../../net/protocol'
import './draft.css'

type Props = {
  roster: Partial<Record<Seat, string>>
  picksBySeat: Partial<Record<Seat, number>>
  mySeat: Seat | null
}

/** Sparse pick counts only — never pack/pool contents (see DraftProgressMessage's privacy
 *  note) — so this can only ever show "how far along," not "what everyone has." */
function DraftProgressBar({ roster, picksBySeat, mySeat }: Props) {
  const seats = Object.keys(roster)
    .map((s) => Number(s) as Seat)
    .sort((a, b) => a - b)

  return (
    <ul className="draft-progress">
      {seats.map((seat) => (
        <li key={seat} className={seat === mySeat ? 'is-self' : ''}>
          <span className="draft-progress__name">{roster[seat]}</span>
          <span className="draft-progress__count">{picksBySeat[seat] ?? 0} picked</span>
        </li>
      ))}
    </ul>
  )
}

export default DraftProgressBar
