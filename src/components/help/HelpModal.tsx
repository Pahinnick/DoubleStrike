import { useEffect, useState } from 'react'
import { storage } from '../../storage/storage'
import type { StoragePaths } from '../../storage/storageAdapter'
import { useProfiles } from '../../state/ProfileContext'
import { useTutorialContext } from '../shared/TutorialContext'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'
import './help.css'

type Props = {
  onClose: () => void
}

function HelpModal({ onClose }: Props) {
  useEscapeToClose(onClose)
  const { activeProfileId } = useProfiles()
  const tutorial = useTutorialContext()
  const [paths, setPaths] = useState<StoragePaths | null>(null)

  useEffect(() => {
    let cancelled = false
    storage.getPaths(activeProfileId).then((result) => {
      if (!cancelled) setPaths(result)
    })
    return () => {
      cancelled = true
    }
  }, [activeProfileId])

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Help" onClick={onClose}>
      <div className="modal-content help-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Help</h2>

        <section className="help-modal__section">
          <h3>Profiles</h3>
          <p>
            Each profile (top-left of the header) keeps a completely separate set of decks — no password, just a
            name. Use the profile menu to switch, add, rename, or set which profile loads by default.
          </p>
        </section>

        <section className="help-modal__section">
          <h3>Controls</h3>
          <ul>
            <li>Click a search result to add it to the deck (mainboard).</li>
            <li>Drag a card between search results, mainboard, sideboard, or a category to move/add it.</li>
            <li>Hover any card to see a full-size preview.</li>
            <li>Right-click a card to find similar cards by Scryfall tag.</li>
            <li>In the deck list, use the ★ to set a commander, the →SB/→MB button to switch boards, and +/− to adjust quantity.</li>
            <li>The category dropdown on a deck row files it under a custom group (manage groups from the deck panel).</li>
          </ul>
        </section>

        <section className="help-modal__section">
          <h3>Playtest</h3>
          <p>
            Goldfish your deck solo: draws an opening hand, commanders start in the command zone. Click or drag a
            card from your hand onto the battlefield to play it; click a battlefield card to tap/untap it. Drag any
            card onto the Library, Graveyard, or Exile pile to move it there — click a pile to draw (Library) or
            browse its contents (Graveyard/Exile). Next Turn untaps everything and draws a card; Mulligan reshuffles
            your hand back in and draws one fewer.
          </p>
        </section>

        <section className="help-modal__section">
          <h3>Avg Turn</h3>
          <p>
            For each nonland card, this is the expected turn it first becomes castable — accounting for your deck's
            actual land count and color sources, not just its mana value. It's computed from the hypergeometric
            probability of having drawn enough lands (and enough of each required color) by each turn, assuming you're
            on the play. A value of "10+" means the deck doesn't reach 90% confidence of casting that card by turn 10
            with the current mana base.
          </p>
        </section>

        <section className="help-modal__section">
          <h3>Where your decks live</h3>
          {paths ? (
            <>
              <p>Decks for this profile are saved as individual files here, and updating the app never touches this folder:</p>
              <code className="help-modal__path">{paths.decksDir}</code>
              <p>A standing backup copy of every deck (across all profiles) is also kept here:</p>
              <code className="help-modal__path">{paths.backupDir}</code>
              <div className="help-modal__folder-buttons">
                <button type="button" onClick={() => storage.openDecksFolder(activeProfileId)}>
                  Open Decks Folder
                </button>
                <button type="button" onClick={() => storage.openBackupFolder()}>
                  Open Backup Folder
                </button>
              </div>
              <p className="help-modal__hint">
                Each deck is a plain JSON file named by deck ID. To share a deck with someone else, use the Export
                button instead — it produces an Archidekt-compatible plain-text list they can paste into Import.
              </p>
            </>
          ) : (
            <p className="help-modal__hint">
              Running in a browser tab, decks are stored in this browser's local data rather than as files. Use the
              desktop app to get decks saved as files on disk (and backed up automatically).
            </p>
          )}
        </section>

        <div className="help-modal__footer">
          <button
            type="button"
            onClick={() => {
              tutorial.start()
              onClose()
            }}
          >
            Replay Tour
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default HelpModal
