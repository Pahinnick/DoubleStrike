import { useEffect, useState } from 'react'
import { MAX_PLAYERS, isValidRoomCode, type Seat } from '../../net/protocol'
import type { DraftSession } from '../../draft/useDraftSession'
import { listCubes, loadCube } from '../../storage/cubeRepository'
import type { CubeSummary } from '../../draft/types'
import { PrivacyNotice } from '../playtest/MultiplayerModal'
import './draft.css'

type Props = {
  profileId: string
  session: DraftSession
  /** Bumped by the parent whenever the cube manager closes, so the cube list below refetches
   *  instead of staying stale from this component's initial mount. */
  cubesVersion: number
}

const DEFAULT_PACK_SIZE = 15
const DEFAULT_PACKS_PER_PLAYER = 3

/** A pack size or pack count typed into a number box. Always a whole number of at least 1: the
 *  draft engine counts rounds and slices packs with these, and a value like 2.5 made the "last
 *  round" test never come true, so the draft could not finish. */
function toWholeCount(raw: string): number {
  const value = Math.floor(Number(raw))
  return Number.isFinite(value) && value >= 1 ? value : 1
}

function DraftLobbyPanel({ profileId, session, cubesVersion }: Props) {
  const [code, setCode] = useState('')
  const [cubes, setCubes] = useState<CubeSummary[]>([])
  const [selectedCubeId, setSelectedCubeId] = useState('')
  const [packSize, setPackSize] = useState(DEFAULT_PACK_SIZE)
  const [packsPerPlayer, setPacksPerPlayer] = useState(DEFAULT_PACKS_PER_PLAYER)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    void listCubes(profileId).then((result) => {
      setCubes(result)
      if (result.length > 0) setSelectedCubeId((prev) => (result.some((c) => c.id === prev) ? prev : result[0].id))
    })
  }, [profileId, cubesVersion])

  const seatedCount = Object.keys(session.roster).length
  const canStart = session.role === 'host' && seatedCount === MAX_PLAYERS && selectedCubeId !== ''

  async function handleStart() {
    if (!canStart) return
    setStarting(true)
    setStartError(null)
    const cube = await loadCube(profileId, selectedCubeId)
    setStarting(false)
    if (!cube) {
      setStartError("Couldn't load that cube — try again.")
      return
    }
    const needed = packsPerPlayer * MAX_PLAYERS * packSize
    const have = cube.cards.reduce((sum, c) => sum + c.quantity, 0)
    if (have < needed) {
      setStartError(`This cube only has ${have} cards — ${needed} are needed for ${MAX_PLAYERS} players × ${packsPerPlayer} packs × ${packSize} cards.`)
      return
    }
    session.startDraft(cube.cards, { cubeId: cube.id, cubeName: cube.name, packSize, packsPerPlayer })
  }

  if (session.status === 'idle') {
    return (
      <div className="draft-lobby">
        <p className="draft-lobby__intro">Draft a shared cube with up to {MAX_PLAYERS - 1} friends. Host to get a code, or join with one.</p>
        <button type="button" className="draft-lobby__primary" onClick={() => void session.host().catch(() => undefined)}>
          Host Draft
        </button>
        <div className="draft-lobby__divider">or</div>
        <form
          className="draft-lobby__join"
          onSubmit={(event) => {
            event.preventDefault()
            if (isValidRoomCode(code)) void session.join(code).catch(() => undefined)
          }}
        >
          <input
            type="text"
            placeholder="Enter code"
            value={code}
            maxLength={6}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            aria-label="Room code"
          />
          <button type="submit" disabled={!isValidRoomCode(code)}>
            Join Draft
          </button>
        </form>
        <PrivacyNotice />
      </div>
    )
  }

  if (session.status === 'connecting') {
    return (
      <div className="draft-lobby">
        <p>Connecting…</p>
        <button type="button" onClick={session.leave}>
          Cancel
        </button>
      </div>
    )
  }

  if (session.status === 'error' || session.status === 'closed') {
    return (
      <div className="draft-lobby">
        <p className="search-status search-status--error">{session.statusDetail ?? 'The session ended.'}</p>
        <button type="button" onClick={session.leave}>
          Back
        </button>
      </div>
    )
  }

  // connected
  const seats: Seat[] = [0, 1, 2, 3]
  return (
    <div className="draft-lobby">
      {session.role === 'host' && session.roomCode && (
        <div className="draft-lobby__code-display">
          <span>Room code</span>
          <span className="draft-lobby__code">{session.roomCode}</span>
        </div>
      )}
      <ul className="draft-lobby__roster">
        {seats.map((seat) => (
          <li key={seat} className={seat === session.seat ? 'is-self' : ''}>
            <span className="draft-lobby__seat-tag">Seat {seat + 1}</span>
            <span>{session.roster[seat] ?? 'Open'}</span>
          </li>
        ))}
      </ul>

      {session.role === 'host' && (
        <div className="draft-lobby__setup">
          <label>
            <span>Cube</span>
            {cubes.length === 0 ? (
              <span className="draft-lobby__no-cubes">No cubes yet — create one from the Draft menu first.</span>
            ) : (
              <select value={selectedCubeId} onChange={(event) => setSelectedCubeId(event.target.value)}>
                {cubes.map((cube) => (
                  <option key={cube.id} value={cube.id}>
                    {cube.name} ({cube.cardCount} cards)
                  </option>
                ))}
              </select>
            )}
          </label>
          <label>
            <span>Pack size</span>
            <input type="number" min={1} value={packSize} onChange={(event) => setPackSize(toWholeCount(event.target.value))} />
          </label>
          <label>
            <span>Packs per player</span>
            <input
              type="number"
              min={1}
              value={packsPerPlayer}
              onChange={(event) => setPacksPerPlayer(toWholeCount(event.target.value))}
            />
          </label>
          {startError && <p className="search-status search-status--error">{startError}</p>}
          <button type="button" onClick={handleStart} disabled={!canStart || starting}>
            {starting ? 'Starting…' : `Start Draft (${seatedCount}/${MAX_PLAYERS} seated)`}
          </button>
        </div>
      )}
      {session.role === 'guest' && <p className="draft-lobby__waiting">Waiting for the host to start the draft…</p>}

      <button type="button" onClick={session.leave}>
        {session.role === 'host' ? 'End session' : 'Leave'}
      </button>
    </div>
  )
}

export default DraftLobbyPanel
