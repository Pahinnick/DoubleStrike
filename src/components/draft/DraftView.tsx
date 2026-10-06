import { useRef, useState } from 'react'
import { useDraftSession } from '../../draft/useDraftSession'
import { useProfiles } from '../../state/ProfileContext'
import CubeManagerModal from './CubeManagerModal'
import DraftDeckBuildingView from './DraftDeckBuildingView'
import DraftLobbyPanel from './DraftLobbyPanel'
import DraftProgressBar from './DraftProgressBar'
import PackView from './PackView'
import './draft.css'

type Props = {
  onClose: () => void
}

/** Draft mode's top-level view — behind the isDraftModeEnabled feature flag (see
 *  src/config/featureFlags.ts). Cube setup, the lobby, and pack drafting are implemented; pool
 *  deck-building and the post-draft dual 1v1 tables land in later work — for now a completed
 *  draft just shows the final pool. */
function DraftView({ onClose }: Props) {
  const { activeProfileId, profiles } = useProfiles()
  const playerName = profiles.find((p) => p.id === activeProfileId)?.name ?? 'Player'
  const playerIdRef = useRef<string>(crypto.randomUUID())
  const [cubeManagerOpen, setCubeManagerOpen] = useState(false)
  // Bumped whenever the cube manager closes, so the lobby's cube dropdown (fetched once on
  // mount) picks up anything just created/edited/deleted there instead of going stale.
  const [cubesVersion, setCubesVersion] = useState(0)

  const session = useDraftSession(playerIdRef.current, playerName)

  return (
    <div className="draft-view">
      <header className="draft-view__header">
        <h1>Draft</h1>
        {session.status === 'idle' && (
          <button type="button" onClick={() => setCubeManagerOpen(true)}>
            Manage Cubes
          </button>
        )}
        <button type="button" onClick={onClose}>
          Back to Deckbuilder
        </button>
      </header>
      <main className="draft-view__body">
        {session.phase === 'lobby' && <DraftLobbyPanel profileId={activeProfileId} session={session} cubesVersion={cubesVersion} />}

        {session.phase === 'drafting' && (
          <div className="draft-view__drafting">
            {/* The lobby panel is the only other place the connection's state is shown, and it
                isn't on screen any more. Without this a dropped connection looked exactly like
                waiting on a slow neighbour, indefinitely. */}
            {session.status === 'connecting' && (
              <p className="search-status">{session.statusDetail ?? 'Reconnecting to the draft…'}</p>
            )}
            {(session.status === 'closed' || session.status === 'error') && (
              <p className="search-status search-status--error">
                Lost the connection to this draft{session.statusDetail ? ` — ${session.statusDetail}` : '.'} Your picks so far are still below.
              </p>
            )}
            <DraftProgressBar roster={session.roster} picksBySeat={session.picksBySeat} mySeat={session.seat} />
            {session.pickError && <p className="search-status search-status--error">{session.pickError}</p>}
            <PackView pack={session.currentPack} myPool={session.myPool} onPick={session.pickCard} />
          </div>
        )}

        {session.phase === 'complete' && (
          <DraftDeckBuildingView
            cubeName={session.config?.cubeName ?? 'Draft'}
            myPool={session.myPool}
            onDone={() => {
              session.leave()
              onClose()
            }}
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
    </div>
  )
}

export default DraftView
