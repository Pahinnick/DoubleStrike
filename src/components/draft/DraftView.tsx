import { useRef, useState } from 'react'
import { draftTableOf, opponentSeatOf } from '../../draft/draftEngine'
import { useDraftSession } from '../../draft/useDraftSession'
import { matchRoomCode, type Seat } from '../../net/protocol'
import { useProfiles } from '../../state/ProfileContext'
import PlaytestView, { type TableGame } from '../playtest/PlaytestView'
import ConfirmModal from '../shared/ConfirmModal'
import CubeManagerModal from './CubeManagerModal'
import DraftDeckBuilder, { type DraftMatchEntry } from './DraftDeckBuilder'
import DraftLobbyPanel from './DraftLobbyPanel'
import DraftProgressBar from './DraftProgressBar'
import PackView from './PackView'
import './draft.css'

type Props = {
  onClose: () => void
}

/** The game table currently open inside Draft mode. `key` remounts it for each new match. */
type OpenMatch = { opponentSeat: Seat | null; key: number }

/** Draft mode's top-level view, and home base for the whole event: lobby (three 1v1 tables, set
 *  or cube) → drafting → building a Limited deck from your pool → matches. The game table opens
 *  *inside* this view ("Back to draft" returns here), so the draft connection — and with it the
 *  Matches panel showing who's free, waiting or playing — lasts until the player leaves the draft. */
function DraftView({ onClose }: Props) {
  const { activeProfileId, profiles } = useProfiles()
  const playerName = profiles.find((p) => p.id === activeProfileId)?.name ?? 'Player'
  const playerIdRef = useRef<string>(crypto.randomUUID())
  const [cubeManagerOpen, setCubeManagerOpen] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [match, setMatch] = useState<OpenMatch | null>(null)
  // Who we've sat down against so far, and whether we've been to the table and come back — from
  // then on the deck builder asks which seat to play next rather than defaulting to the tablemate.
  const [playedSeats, setPlayedSeats] = useState<Seat[]>([])
  const [backFromTable, setBackFromTable] = useState(false)
  // Bumped whenever the cube manager closes, so the lobby's cube dropdown (fetched once on
  // mount) picks up anything just created/edited/deleted there instead of going stale.
  const [cubesVersion, setCubesVersion] = useState(0)

  const session = useDraftSession(playerIdRef.current, playerName)

  const mySeat = session.seat
  const opponentSeat = mySeat !== null ? opponentSeatOf(mySeat) : null
  const opponentName = opponentSeat !== null ? session.roster[opponentSeat] ?? null : null
  const tableNumber = mySeat !== null ? draftTableOf(mySeat) + 1 : null
  // A dev-mode bot (or a player the host took over picking for) drafts but can't play a match.
  const isBot = (seat: Seat) => session.autoPickingSeats.includes(seat) && !session.awaySeats.includes(seat)
  const opponentIsBot = opponentSeat !== null && isBot(opponentSeat)
  // Everyone else from the draft who can play a match.
  const otherPlayers = Object.entries(session.roster)
    .map(([seat, name]) => ({ seat: Number(seat) as Seat, name: name ?? 'Player' }))
    .filter((p) => p.seat !== mySeat && !isBot(p.seat))
    .sort((a, b) => a.seat - b.seat)
  const nameOf = (seat: Seat | null) => (seat === null ? null : (session.roster[seat] ?? `Seat ${seat + 1}`))

  /** The Matches panel: what each other player is doing right now, and who's waiting for us. */
  const matches: DraftMatchEntry[] = otherPlayers.map((player) => {
    const status = session.matchStatuses[player.seat]
    const away = session.awaySeats.includes(player.seat)
    const waitingForMe = !away && status?.state === 'waiting' && status.opponentSeat === mySeat
    let activity: string
    if (away) activity = 'Disconnected'
    else if (!status || status.state === 'building') activity = 'Building their deck'
    else if (waitingForMe) activity = 'Waiting for you at the table'
    else if (status.state === 'waiting') activity = status.opponentSeat === null ? 'At the table, free to play' : `Waiting for ${nameOf(status.opponentSeat)}`
    else activity = `Playing ${nameOf(status.opponentSeat)}`
    // Mid-match with someone else: picking them means joining their table and waiting for a seat.
    const busy = !away && status?.state === 'playing' && status.opponentSeat !== mySeat
    return { seat: player.seat, name: player.name, activity, waitingForMe, away, played: playedSeats.includes(player.seat), busy }
  })

  /** Where a match against `target` happens: the table they're already at (we take its open
   *  seat, or wait in the room for one), else a fresh room for the two of us. */
  function roomFor(target: Seat): string {
    const status = session.matchStatuses[target]
    const atTable = status && status.state !== 'building' && status.room && !session.awaySeats.includes(target)
    if (atTable && status.room) return status.room
    return matchRoomCode(session.roomCode ?? '', mySeat ?? 0, target)
  }

  function enterMatch(opponent: Seat | null) {
    setMatch({ opponentSeat: opponent, key: Date.now() })
    if (opponent !== null) setPlayedSeats((prev) => (prev.includes(opponent) ? prev : [...prev, opponent]))
    session.reportMatchStatus({ state: 'waiting', opponentSeat: opponent })
  }

  function backToDraft() {
    setMatch(null)
    setBackFromTable(true)
    session.reportMatchStatus({ state: 'building', opponentSeat: null })
  }

  /** The main button: whoever's already waiting for us, else our tablemate, else on our own. */
  function goToTable() {
    const waiting = matches.find((m) => m.waitingForMe)
    if (waiting) enterMatch(waiting.seat)
    else enterMatch(opponentName && !opponentIsBot ? opponentSeat : null)
  }

  function exit(next: () => void) {
    session.leave()
    next()
  }

  function handleBack() {
    // Leaving mid-draft abandons everyone's packs; leaving afterwards drops you out of the
    // group's matches — make sure either is intended.
    if (session.phase === 'drafting' || (session.phase === 'complete' && otherPlayers.length > 0)) setConfirmLeave(true)
    else exit(onClose)
  }

  const tableGame: TableGame | null =
    match && session.roomCode && mySeat !== null
      ? { draftCode: session.roomCode, mySeat, players: otherPlayers, opponentSeat: match.opponentSeat, roomFor }
      : null

  return (
    <>
      {/* Kept mounted (just hidden) during a match: the deck builder owns the drafted deck. */}
      <div className="draft-view" hidden={tableGame !== null}>
        <header className="draft-view__header">
          <h1>Draft{session.config ? ` — ${session.config.source.name}` : ''}</h1>
          {session.status === 'idle' && (
            <button type="button" onClick={() => setCubeManagerOpen(true)}>
              Manage Cubes
            </button>
          )}
          <button type="button" onClick={handleBack}>
            {session.phase === 'complete' ? 'Leave draft' : 'Back to Deckbuilder'}
          </button>
        </header>
        <main className="draft-view__body">
          {session.phase === 'lobby' && <DraftLobbyPanel profileId={activeProfileId} session={session} cubesVersion={cubesVersion} />}

          {session.phase === 'drafting' && (
            <div className="draft-view__drafting">
              <DraftProgressBar
                roster={session.roster}
                picksBySeat={session.picksBySeat}
                mySeat={mySeat}
                round={session.currentPack?.round ?? null}
                awaySeats={session.awaySeats}
                autoPickingSeats={session.autoPickingSeats}
                onPickForSeat={session.role === 'host' ? session.autoPickNow : undefined}
              />
              {session.role === 'guest' && session.status === 'connecting' && (
                <div className="draft-connection-banner" role="status">
                  <p>Lost connection to the host — reconnecting… Your packs wait for you, and your picks are safe.</p>
                </div>
              )}
              {session.role === 'guest' && (session.status === 'closed' || session.status === 'error') && (
                <div className="draft-connection-banner" role="alert">
                  <p>
                    Couldn't reach the host. If they're still drafting, try again — you'll get your seat, packs and picks back. If the
                    host has left, you can build a deck from your {session.myPool.length} picks.
                  </p>
                  <button type="button" onClick={() => void session.retryConnection()}>
                    Try again
                  </button>
                  <button type="button" onClick={session.finishWithCurrentPool}>
                    Build with my picks
                  </button>
                </div>
              )}
              {session.pickError && <p className="search-status search-status--error">{session.pickError}</p>}
              <PackView pack={session.currentPack} myPool={session.myPool} onPick={session.pickCard} />
            </div>
          )}

          {session.phase === 'complete' && (
            <DraftDeckBuilder
              pool={session.myPool}
              config={session.config}
              opponentName={opponentName}
              opponentIsBot={opponentIsBot}
              hasOtherPlayers={otherPlayers.length > 0}
              tableNumber={tableNumber}
              matches={matches}
              onGoToTable={goToTable}
              onPlay={(seat) => enterMatch(seat)}
              choosingNext={backFromTable}
            />
          )}
        </main>
        {cubeManagerOpen && (
          <CubeManagerModal
            profileId={activeProfileId}
            onClose={() => {
              setCubeManagerOpen(false)
              setCubesVersion((v) => v + 1)
            }}
          />
        )}
        {confirmLeave && (
          <ConfirmModal
            title="Leave the draft?"
            message={
              session.phase === 'complete'
                ? "You'll leave this draft group and can't start new matches with them. Your deck stays in My Decks."
                : session.role === 'host'
                  ? 'The draft is still in progress, and it runs on your app — leaving ends it for everyone. Their picks so far can still be built into decks.'
                  : "The draft is still in progress. Leaving gives up your seat: your packs will wait until the host picks for you, and your picks so far won't be saved."
            }
            onConfirm={() => exit(onClose)}
            onCancel={() => setConfirmLeave(false)}
          />
        )}
      </div>

      {tableGame && match && (
        <PlaytestView
          key={match.key}
          tableGame={tableGame}
          closeLabel="Back to draft"
          onClose={backToDraft}
          onDraftMatchStatus={session.reportMatchStatus}
        />
      )}
    </>
  )
}

export default DraftView
