/**
 * Host/Join UI for the multiplayer pod — the front end for `useMultiplayer`.
 *
 * Idle: host a game (get a shareable code) or join with a friend's code.
 * Active: shows the room code, your seat, and who's seated, plus Leave. All the
 * transport logic lives in `useMultiplayer`/`peerConnection`; this is just chrome.
 */
import { useState } from 'react'
import type { ConnectionStatus } from '../../net/peerConnection'
import { MAX_PLAYERS, isValidRoomCode, type PublicBoard, type Seat } from '../../net/protocol'
import type { MultiplayerRole } from '../../net/useMultiplayer'

type Props = {
  status: ConnectionStatus
  statusDetail: string | null
  role: MultiplayerRole | null
  roomCode: string | null
  mySeat: Seat | null
  myName: string
  boards: PublicBoard[]
  onHost: () => void
  onJoin: (code: string) => void
  onLeave: () => void
  onClose: () => void
}

type RosterEntry = { seat: number; name: string; isSelf: boolean; open: boolean }

function buildRoster(mySeat: Seat | null, myName: string, boards: PublicBoard[]): RosterEntry[] {
  const bySeat = new Map<number, string>(boards.map((b) => [b.seat, b.name]))
  const entries: RosterEntry[] = []
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (seat === mySeat) entries.push({ seat, name: `${myName} (you)`, isSelf: true, open: false })
    else if (bySeat.has(seat)) entries.push({ seat, name: bySeat.get(seat)!, isSelf: false, open: false })
    else entries.push({ seat, name: 'Open', isSelf: false, open: true })
  }
  return entries
}

function MultiplayerModal({
  status,
  statusDetail,
  role,
  roomCode,
  mySeat,
  myName,
  boards,
  onHost,
  onJoin,
  onLeave,
  onClose,
}: Props) {
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)

  function copyCode() {
    if (!roomCode) return
    navigator.clipboard?.writeText(roomCode).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }

  const roster = buildRoster(mySeat, myName, boards)
  const seatedCount = roster.filter((r) => !r.open).length

  // `closed`/`error` pop this modal open on its own (see PlaytestView's wasConnectedRef
  // effect) rather than the player choosing to open it — so a click they were already
  // mid-gesture on elsewhere on the board can land on this backdrop and dismiss the
  // "why did my opponents vanish" explanation before it's been read. Require the explicit
  // Back/Close button for those two states instead of backdrop-click.
  const dismissOnBackdropClick = status !== 'closed' && status !== 'error'

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Multiplayer"
      onClick={dismissOnBackdropClick ? onClose : undefined}
    >
      <div className="modal-content mp-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Multiplayer</h2>

        {status === 'idle' && (
          <div className="mp-modal__section">
            <p className="mp-modal__intro">
              Play your decks against friends live, as a Commander pod. Host a game to get a code to share, or join with a
              friend's code.
            </p>
            <button type="button" className="mp-modal__primary" onClick={onHost}>
              Host Game
            </button>
            <div className="mp-modal__divider">or</div>
            <form
              className="mp-modal__join"
              onSubmit={(event) => {
                event.preventDefault()
                if (isValidRoomCode(code)) onJoin(code)
              }}
            >
              <input
                type="text"
                className="mp-modal__code-input"
                placeholder="Enter code"
                value={code}
                maxLength={6}
                autoFocus
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                aria-label="Room code"
              />
              <button type="submit" disabled={!isValidRoomCode(code)}>
                Join Game
              </button>
            </form>
          </div>
        )}

        {status === 'connecting' && (
          <div className="mp-modal__section">
            <p>Connecting…</p>
            <button type="button" onClick={onLeave}>
              Cancel
            </button>
          </div>
        )}

        {status === 'connected' && (
          <div className="mp-modal__section">
            {role === 'host' && roomCode && (
              <div className="mp-modal__code-display">
                <span className="mp-modal__code-label">Room code</span>
                <span className="mp-modal__code">{roomCode}</span>
                <button type="button" onClick={copyCode}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}
            <p className="mp-modal__intro">
              {role === 'host'
                ? `Share this code with up to ${MAX_PLAYERS - 1} friends. ${seatedCount} of ${MAX_PLAYERS} seated.`
                : `Connected to the pod. ${seatedCount} of ${MAX_PLAYERS} seated.`}
            </p>
            <ul className="mp-modal__roster">
              {roster.map((entry) => (
                <li key={entry.seat} className={`mp-modal__seat ${entry.isSelf ? 'is-self' : ''} ${entry.open ? 'is-open' : ''}`}>
                  <span className="mp-modal__seat-tag">Seat {entry.seat + 1}</span>
                  <span className="mp-modal__seat-name">{entry.name}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="mp-modal__leave" onClick={onLeave}>
              {role === 'host' ? 'End session' : 'Leave pod'}
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="mp-modal__section">
            <p className="mp-modal__error">{statusDetail ?? 'Something went wrong.'}</p>
            <button type="button" onClick={onLeave}>
              Back
            </button>
          </div>
        )}

        {status === 'closed' && (
          <div className="mp-modal__section">
            <p>{statusDetail ?? 'The session ended.'}</p>
            <button type="button" onClick={onLeave}>
              Back
            </button>
          </div>
        )}

        <button type="button" className="mp-modal__close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export default MultiplayerModal
