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
import { ALL_SEATS, DUEL_SEATS } from './podLayout'
import type { MultiplayerRole } from '../../net/useMultiplayer'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'

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
  /** Set at the table after a draft (see PlaytestView's tableGame): the current 1v1, and everyone
   *  else from the draft you can switch to for your next match. */
  draftMatch?: DraftMatchPanel | null
}

export type DraftMatchPanel = {
  opponentName: string | null
  opponentSeat: Seat | null
  players: { seat: Seat; name: string }[]
  onPlay: (seat: Seat) => void
  /** Set while you're in a match room whose two seats are both taken: who's playing, and whether
   *  a seat has opened up for you to take. */
  waitingForSeat: WaitingForSeat | null
}

export type WaitingForSeat = { seatedNames: string[]; canSit: boolean; onTakeSeat: () => void; onBackToDraft: () => void }

type RosterEntry = { seat: number; name: string; isSelf: boolean; open: boolean }

function buildRoster(mySeat: Seat | null, myName: string, boards: PublicBoard[], seats: readonly number[]): RosterEntry[] {
  const bySeat = new Map<number, string>(boards.map((b) => [b.seat, b.name]))
  const entries: RosterEntry[] = []
  for (const seat of seats) {
    if (seat === mySeat) entries.push({ seat, name: `${myName} (you)`, isSelf: true, open: false })
    else if (bySeat.has(seat)) entries.push({ seat, name: bySeat.get(seat)!, isSelf: false, open: false })
    else entries.push({ seat, name: 'Open', isSelf: false, open: true })
  }
  return entries
}

/** Players connect straight to each other (WebRTC), so everyone in a pod — and the free public
 *  PeerJS server that introduces them — can see each player's internet (IP) address. Nothing in
 *  the app can hide that short of relaying all traffic, so it's said plainly before anyone hosts
 *  or joins. Shared with the draft lobby, which connects the same way. */
export function PrivacyNotice() {
  return (
    <p className="mp-privacy-notice">
      <strong>Heads up:</strong> players connect directly to each other, so everyone in a game can see your internet (IP)
      address, which shows roughly where you are. Only play with people you trust, or use a VPN to hide it.
    </p>
  )
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
  draftMatch = null,
}: Props) {
  useEscapeToClose(onClose)
  const [code, setCode] = useState('')
  const draftOpponentName = draftMatch?.opponentName ?? null
  const waiting = draftMatch?.waitingForSeat ?? null
  const opponentHere = draftOpponentName !== null && boards.length > 0 && !waiting
  // The current draft match has dropped — e.g. the opponent moved on to their next match (which
  // a guest first sees as a lost host, retried a few times before giving up).
  const matchDropped =
    status === 'closed' || status === 'error' || status === 'idle' || (status === 'connecting' && /reconnecting/i.test(statusDetail ?? ''))
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

  // A draft match is a 1v1 table (see podLayout's DUEL_SEATS): list just its two seats.
  const roster = buildRoster(mySeat, myName, boards, draftMatch ? DUEL_SEATS : ALL_SEATS)
  const seatedCount = roster.filter((r) => !r.open).length

  // `closed`/`error` pop this modal open on its own (see PlaytestView's wasConnectedRef
  // effect) rather than the player choosing to open it — so a click they were already
  // mid-gesture on elsewhere on the board can land on this backdrop and dismiss the
  // "why did my opponents vanish" explanation before it's been read. Require the explicit
  // Back/Close button for those two states instead of backdrop-click.
  const dismissOnBackdropClick = status !== 'closed' && status !== 'error' && !waiting

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Multiplayer"
      onClick={dismissOnBackdropClick ? onClose : undefined}
    >
      <div className="modal-content mp-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{draftMatch ? (draftOpponentName ? `Draft match vs ${draftOpponentName}` : 'Draft matches') : 'Multiplayer'}</h2>

        {waiting && (
          <div className="mp-modal__section">
            <p className="mp-modal__intro">
              {waiting.canSit
                ? 'A seat just opened at this table — sit down to play.'
                : waiting.seatedNames.length >= 2
                  ? `Both seats at this table are taken — ${waiting.seatedNames.join(' is playing ')}. You're in the room, and can sit down as soon as one of them leaves.`
                  : 'Both seats at this table are taken. You can sit down as soon as one opens.'}
            </p>
            <button type="button" className="mp-modal__primary" onClick={waiting.onTakeSeat} disabled={!waiting.canSit}>
              {waiting.canSit ? 'Take the open seat' : 'Waiting for a seat…'}
            </button>
            <button type="button" onClick={waiting.onBackToDraft}>
              Back to draft
            </button>
          </div>
        )}

        {draftMatch && !waiting && !draftOpponentName && status === 'connected' && (
          <div className="mp-modal__section">
            <p className="mp-modal__intro">
              You're at the table on your own. Anyone from the draft who picks you sits down across from you — or pick someone below.
            </p>
          </div>
        )}

        {draftOpponentName && status === 'connected' && !waiting && (
          <div className="mp-modal__section">
            <p className="mp-modal__intro">
              {opponentHere
                ? `${draftOpponentName} is at the table — close this and play your match.`
                : `Waiting for ${draftOpponentName} to join this match. They'll arrive once they finish their deck or pick you as their next opponent.`}
            </p>
            {opponentHere && (
              <button type="button" className="mp-modal__primary" onClick={onClose}>
                Start playing
              </button>
            )}
          </div>
        )}

        {draftOpponentName && matchDropped && (
          <p className="mp-modal__intro">
            Not connected to {draftOpponentName} right now — if they've moved on to another match, pick who to play next below, or
            play them again.
          </p>
        )}

        {draftMatch && draftMatch.players.length > 0 && (
          <div className="mp-modal__section">
            <h3 className="mp-modal__subhead">{draftMatch.opponentSeat === null ? 'Pick an opponent' : 'Play someone else next'}</h3>
            <p className="mp-modal__hint">
              Picking someone ends your current match and starts a fresh game with your deck. If they're at a table, you join it —
              taking the open seat, or waiting in the room until one opens. Otherwise you're matched as soon as they pick you too.
            </p>
            <ul className="mp-modal__roster">
              {draftMatch.players.map((player) => (
                <li key={player.seat} className={`mp-modal__seat ${player.seat === draftMatch.opponentSeat ? 'is-self' : ''}`}>
                  <span className="mp-modal__seat-tag">Seat {player.seat + 1}</span>
                  <span className="mp-modal__seat-name">{player.name}</span>
                  {player.seat === draftMatch.opponentSeat && !matchDropped ? (
                    <span className="mp-modal__seat-current">Current match</span>
                  ) : (
                    <button type="button" onClick={() => draftMatch.onPlay(player.seat)}>
                      {player.seat === draftMatch.opponentSeat ? 'Play again' : `Play ${player.name}`}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {draftMatch && draftMatch.players.length === 0 && status === 'idle' && (
          <div className="mp-modal__section">
            <p className="mp-modal__intro">
              Everyone else in your draft was a bot. Bots make picks, but they can't play a match — so there's no one to play your
              draft deck against here. You can still play this table on your own (close this), or host or join a regular game
              below with friends.
            </p>
          </div>
        )}

        {status === 'idle' && (!draftMatch || draftMatch.players.length === 0) && (
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
            <PrivacyNotice />
          </div>
        )}

        {status === 'connecting' && (
          <div className="mp-modal__section">
            <p>{statusDetail ?? 'Connecting…'}</p>
            <button type="button" onClick={onLeave}>
              Cancel
            </button>
          </div>
        )}

        {status === 'connected' && (
          <div className="mp-modal__section">
            {role === 'host' && roomCode && !draftOpponentName && (
              <div className="mp-modal__code-display">
                <span className="mp-modal__code-label">Room code</span>
                <span className="mp-modal__code">{roomCode}</span>
                <button type="button" onClick={copyCode}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}
            {!draftOpponentName && (
              <p className="mp-modal__intro">
                {role === 'host'
                  ? `Share this code with up to ${MAX_PLAYERS - 1} friends. ${seatedCount} of ${MAX_PLAYERS} seated.`
                  : `Connected to the pod. ${seatedCount} of ${MAX_PLAYERS} seated.`}
              </p>
            )}
            <ul className="mp-modal__roster">
              {roster.map((entry) => (
                <li key={entry.seat} className={`mp-modal__seat ${entry.isSelf ? 'is-self' : ''} ${entry.open ? 'is-open' : ''}`}>
                  {/* A draft match's room seats aren't the draft's seat numbers — don't show both. */}
                  {!draftMatch && <span className="mp-modal__seat-tag">Seat {entry.seat + 1}</span>}
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
