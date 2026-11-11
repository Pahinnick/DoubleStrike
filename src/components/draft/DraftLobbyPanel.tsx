import { useEffect, useMemo, useState } from 'react'
import { getCardsByIdentifiers } from '../../api/scryfall'
import { toAutoPickInfo, type AutoPickInfo } from '../../draft/autoPick'
import { boosterLabelOf, buildSetPacks, buildSoloSetPacks, packSizeOf, recipeFor } from '../../draft/boosters'
import { DRAFT_TABLE_COUNT } from '../../draft/draftEngine'
import { buildPacks, buildSoloCubePacks, cubeCardsNeeded } from '../../draft/packBuilder'
import { listDraftableSets, loadSetBoosterPool, type DraftableSet } from '../../draft/setPool'
import type { CubeSummary, DraftConfig, DraftPackState } from '../../draft/types'
import { DRAFT_MIN_PLAYERS, type DraftSession } from '../../draft/useDraftSession'
import { useProfileSettings } from '../../hooks/useProfileSettings'
import { DRAFT_MAX_PLAYERS, isValidRoomCode, type Seat } from '../../net/protocol'
import { saveSnapshots } from '../../storage/cardCache'
import { listCubes, loadCube } from '../../storage/cubeRepository'
import { PrivacyNotice } from '../playtest/MultiplayerModal'
import { SEAT_COLORS } from '../playtest/podLayout'
import './draft.css'

type Props = {
  profileId: string
  session: DraftSession
  /** Bumped by the parent whenever the cube manager closes, so the cube list below refetches
   *  instead of staying stale from this component's initial mount. */
  cubesVersion: number
}

type SourceKind = 'set' | 'cube'

/** Bots are a testing aid for drafting alone: on in `npm run dev`, and in a packaged test build made
 *  with `VITE_DRAFT_BOTS=true` set at build time. A normal release build leaves them out — drafts
 *  are friends-only. */
const DEV_BOTS = import.meta.env.DEV || import.meta.env.VITE_DRAFT_BOTS === 'true'

const DEFAULT_CUBE_PACK_SIZE = 15
const DEFAULT_PACKS_PER_PLAYER = 3

/** A pack size or pack count typed into a number box. Always a whole number of at least 1: the
 *  draft engine counts rounds and slices packs with these, and a value like 2.5 made the "last
 *  round" test never come true, so the draft could not finish. */
function toWholeCount(raw: string): number {
  const value = Math.floor(Number(raw))
  return Number.isFinite(value) && value >= 1 ? value : 1
}

function setLabel(set: DraftableSet): string {
  return `${set.name} (${set.code.toUpperCase()}) · ${set.releasedAt.slice(0, 4)}`
}

function DraftLobbyPanel({ profileId, session, cubesVersion }: Props) {
  const { cardCacheEnabled } = useProfileSettings()
  const [code, setCode] = useState('')
  const [sourceKind, setSourceKind] = useState<SourceKind>('set')
  const [sets, setSets] = useState<DraftableSet[] | null>(null)
  const [setsError, setSetsError] = useState<string | null>(null)
  const [setQuery, setSetQuery] = useState('')
  const [selectedSetCode, setSelectedSetCode] = useState('')
  const [cubes, setCubes] = useState<CubeSummary[]>([])
  const [selectedCubeId, setSelectedCubeId] = useState('')
  const [cubePackSize, setCubePackSize] = useState(DEFAULT_CUBE_PACK_SIZE)
  const [packsPerPlayer, setPacksPerPlayer] = useState(DEFAULT_PACKS_PER_PLAYER)
  const [startStatus, setStartStatus] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  const isHost = session.role === 'host'
  const connected = session.status === 'connected'

  useEffect(() => {
    void listCubes(profileId).then((result) => {
      setCubes(result)
      if (result.length > 0) setSelectedCubeId((prev) => (result.some((c) => c.id === prev) ? prev : result[0].id))
    })
  }, [profileId, cubesVersion])

  // Only the host picks the packs, so only the host needs Scryfall's set list.
  useEffect(() => {
    if (!isHost || !connected || sets !== null) return
    let cancelled = false
    listDraftableSets()
      .then((result) => {
        if (cancelled) return
        setSets(result)
        setSelectedSetCode((prev) => prev || (result[0]?.code ?? ''))
      })
      .catch(() => {
        if (!cancelled) setSetsError("Couldn't load the set list from Scryfall — check your connection.")
      })
    return () => {
      cancelled = true
    }
  }, [isHost, connected, sets])

  const filteredSets = useMemo(() => {
    if (!sets) return []
    const q = setQuery.trim().toLowerCase()
    if (!q) return sets
    return sets.filter((set) => set.name.toLowerCase().includes(q) || set.code.toLowerCase() === q || set.releasedAt.startsWith(q))
  }, [sets, setQuery])

  const selectedSet = sets?.find((set) => set.code === selectedSetCode)
  const seatedSeats = Object.keys(session.roster).map((s) => Number(s) as Seat)
  const seatedCount = seatedSeats.length
  const lonelySeats = seatedSeats.filter((seat) => session.roster[(seat % 2 === 0 ? seat + 1 : seat - 1) as Seat] === undefined)
  const sourceReady = sourceKind === 'set' ? selectedSet !== undefined : selectedCubeId !== ''
  const canStart = isHost && seatedCount >= DRAFT_MIN_PLAYERS && sourceReady && startStatus === null
  const solo = seatedCount === 1

  async function handleStart() {
    if (!canStart) return
    setStartError(null)
    const seats = session.seatedSeats()
    try {
      let rounds: DraftPackState[][]
      let config: DraftConfig
      // Rarity/colors per card, used only if the host later chooses to pick for a player who
      // isn't coming back (see useDraftSession's autoPickNow).
      let autoPickInfo: AutoPickInfo = {}
      // A lone drafter is handed these instead of their own pack back (see buildSoloReserve).
      let soloReserve: DraftPackState[][] | undefined
      const soloSeat = seats.length === 1 ? seats[0] : null
      if (sourceKind === 'set') {
        const set = selectedSet as DraftableSet
        setStartStatus(`Loading ${set.name} from Scryfall…`)
        const { pool, cards } = await loadSetBoosterPool(set)
        setStartStatus('Opening packs…')
        // The host renders its own packs straight from the cache; guests fetch theirs on demand.
        if (cardCacheEnabled) await saveSnapshots(cards)
        if (soloSeat !== null) {
          const built = buildSoloSetPacks(pool, packsPerPlayer, soloSeat)
          rounds = built.rounds
          soloReserve = built.reserve
        } else {
          rounds = buildSetPacks(pool, packsPerPlayer, seats)
        }
        autoPickInfo = toAutoPickInfo(cards)
        config = {
          source: { kind: 'set', setCode: set.code, name: set.name, boosterType: set.boosterType },
          packSize: packSizeOf(pool.recipe),
          packsPerPlayer,
        }
      } else {
        setStartStatus('Loading cube…')
        const cube = await loadCube(profileId, selectedCubeId)
        if (!cube) throw new Error("Couldn't load that cube — try again.")
        const needed = cubeCardsNeeded({ packSize: cubePackSize, packsPerPlayer, seats })
        const have = cube.cards.reduce((sum, c) => sum + c.quantity, 0)
        if (have < needed) {
          throw new Error(
            soloSeat !== null
              ? `This cube only has ${have} cards — a solo draft of ${packsPerPlayer} packs × ${cubePackSize} cards needs ${needed}, since the packs you're passed come from the cube too. Lower the pack size or count, or add cards.`
              : `This cube only has ${have} cards — ${needed} are needed for ${seats.length} players × ${packsPerPlayer} packs × ${cubePackSize} cards.`,
          )
        }
        if (soloSeat !== null) {
          const built = buildSoloCubePacks(cube.cards, { packSize: cubePackSize, packsPerPlayer, seat: soloSeat })
          rounds = built.rounds
          soloReserve = built.reserve
        } else {
          rounds = buildPacks(cube.cards, { packSize: cubePackSize, packsPerPlayer, seats })
        }
        try {
          autoPickInfo = toAutoPickInfo(await getCardsByIdentifiers(cube.cards.map((c) => ({ id: c.scryfallId }))))
        } catch {
          // Optional: without it a host-made pick just takes each pack's first card.
        }
        config = { source: { kind: 'cube', cubeId: cube.id, name: cube.name }, packSize: cubePackSize, packsPerPlayer }
      }
      if (!session.startDraft(rounds, config, { autoPickInfo, soloReserve })) {
        throw new Error('Someone joined, left or changed seats while the packs were being opened — press Start again.')
      }
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Something went wrong starting the draft.')
    } finally {
      setStartStatus(null)
    }
  }

  if (session.status === 'idle') {
    return (
      <div className="draft-lobby">
        <p className="draft-lobby__intro">
          Draft real set boosters or one of your cubes with up to {DRAFT_MAX_PLAYERS - 1} friends, seated at {DRAFT_TABLE_COUNT} tables of two —
          whoever shares your table is your 1v1 opponent afterwards. Host to get a code, or join with one.
        </p>
        {session.savedRejoin && (
          <div className="draft-rejoin" role="status">
            <p>
              You were in a draft in room <strong>{session.savedRejoin.roomCode}</strong>. Rejoin to get your seat, packs and picks back.
            </p>
            <div className="draft-rejoin__actions">
              <button type="button" className="draft-lobby__primary" onClick={() => void session.rejoinSaved()}>
                Rejoin draft
              </button>
              <button type="button" onClick={session.forgetSaved}>
                Dismiss
              </button>
            </div>
          </div>
        )}
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
        <p>{session.statusDetail ?? 'Connecting…'}</p>
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
  return (
    <div className="draft-lobby draft-lobby--room">
      {session.roomCode && (
        <div className="draft-lobby__code-display">
          <span>Room code</span>
          <span className="draft-lobby__code">{session.roomCode}</span>
        </div>
      )}

      <section className="draft-tables" aria-label="Tables">
        <p className="draft-tables__hint">
          Click an open seat to sit there — whoever shares your table is your opponent after the draft. Packs pass around the
          room in seat order.
        </p>
        <div className="draft-tables__grid">
          {Array.from({ length: DRAFT_TABLE_COUNT }, (_, table) => (
            <div key={table} className="draft-table">
              <h3>Table {table + 1}</h3>
              {([table * 2, table * 2 + 1] as Seat[]).map((seat) => {
                const name = session.roster[seat]
                const isSelf = seat === session.seat
                return (
                  <div key={seat} className={['draft-seat', isSelf && 'is-self', !name && 'is-open'].filter(Boolean).join(' ')}>
                    <span className="draft-seat__dot" style={{ backgroundColor: SEAT_COLORS[seat] }} aria-hidden="true" />
                    <span className="draft-seat__label">Seat {seat + 1}</span>
                    {name ? (
                      <span className="draft-seat__name">
                        {name}
                        {isSelf && <span className="draft-seat__you"> (you)</span>}
                      </span>
                    ) : (
                      <button type="button" className="draft-seat__sit" onClick={() => session.chooseSeat(seat)}>
                        Sit here
                      </button>
                    )}
                    {/* Dev builds only: fill a seat with a bot to test drafting alone. */}
                    {DEV_BOTS && isHost && !name && (
                      <button type="button" className="draft-seat__sit" onClick={() => session.addBot(seat)}>
                        Add bot
                      </button>
                    )}
                    {DEV_BOTS && isHost && session.botSeats.includes(seat) && (
                      <button type="button" className="draft-seat__sit" onClick={() => session.removeBot(seat)}>
                        Remove
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </section>

      {isHost && (
        <section className="draft-lobby__setup" aria-label="Draft setup">
          <div className="draft-source-toggle" role="radiogroup" aria-label="Pack source">
            <button type="button" role="radio" aria-checked={sourceKind === 'set'} className={sourceKind === 'set' ? 'is-active' : ''} onClick={() => setSourceKind('set')}>
              Set boosters
            </button>
            <button type="button" role="radio" aria-checked={sourceKind === 'cube'} className={sourceKind === 'cube' ? 'is-active' : ''} onClick={() => setSourceKind('cube')}>
              Cube
            </button>
          </div>

          {sourceKind === 'set' && (
            <div className="draft-set-picker">
              {setsError && <p className="search-status search-status--error">{setsError}</p>}
              {!sets && !setsError && <p className="draft-lobby__muted">Loading sets…</p>}
              {sets && (
                <>
                  <input
                    type="search"
                    placeholder="Search sets by name, code or year"
                    value={setQuery}
                    onChange={(event) => setSetQuery(event.target.value)}
                    aria-label="Search sets"
                  />
                  <select size={8} value={selectedSetCode} onChange={(event) => setSelectedSetCode(event.target.value)} aria-label="Set">
                    {filteredSets.map((set) => (
                      <option key={set.code} value={set.code}>
                        {setLabel(set)}
                      </option>
                    ))}
                  </select>
                  {selectedSet && (
                    <p className="draft-lobby__muted">
                      {boosterLabelOf(recipeFor(selectedSet.code, selectedSet.boosterType))} · {packSizeOf(recipeFor(selectedSet.code, selectedSet.boosterType))} cards per pack
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {sourceKind === 'cube' && (
            <>
              <label>
                <span>Cube</span>
                {cubes.length === 0 ? (
                  <span className="draft-lobby__no-cubes">No cubes yet — create one with Manage Cubes first.</span>
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
                <input type="number" min={1} value={cubePackSize} onChange={(event) => setCubePackSize(toWholeCount(event.target.value))} />
              </label>
            </>
          )}

          <label>
            <span>Packs per player</span>
            <input type="number" min={1} max={6} value={packsPerPlayer} onChange={(event) => setPacksPerPlayer(Math.min(6, toWholeCount(event.target.value)))} />
          </label>

          {solo && (
            <p className="draft-lobby__muted">
              Solo draft: you make every pick a full table would — one per card in the pack. After each pick you're passed a fresh pack
              with one card fewer, as if the other drafters had taken theirs. Friends can still join with the code before you start.
            </p>
          )}
          {!solo && lonelySeats.length > 0 && (
            <p className="draft-lobby__muted">
              {lonelySeats.map((seat) => session.roster[seat]).join(', ')} {lonelySeats.length === 1 ? 'has' : 'have'} no opponent at
              {lonelySeats.length === 1 ? ' their table' : ' their tables'} — they'll still draft, but won't have a 1v1 match.
            </p>
          )}
          {startError && <p className="search-status search-status--error">{startError}</p>}
          <button type="button" className="draft-lobby__primary" onClick={() => void handleStart()} disabled={!canStart}>
            {startStatus ?? (solo ? 'Start Solo Draft' : `Start Draft (${seatedCount}/${DRAFT_MAX_PLAYERS} seated)`)}
          </button>
        </section>
      )}
      {!isHost && <p className="draft-lobby__waiting">Waiting for the host to choose the packs and start the draft…</p>}

      <button type="button" onClick={session.leave}>
        {isHost ? 'End session' : 'Leave'}
      </button>
    </div>
  )
}

export default DraftLobbyPanel
