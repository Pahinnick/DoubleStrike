import { useEffect, useState } from 'react'
import { useDeckList } from '../../state/DeckListContext'
import ConfirmModal from '../shared/ConfirmModal'
import DeckManagerCommanders from './DeckManagerCommanders'
import { getSnapshots, type CardSnapshot } from '../../storage/cardCache'
import { colorStripeBackground, WUBRG, type Color } from '../../utils/colors'
import './deckManager.css'

/** Union of every commander's color identity for one deck, in WUBRG order — feeds the row's color
 *  stripe. Falls back to empty (rendered as colorless) for non-commander decks or before the
 *  commander's snapshot has loaded. */
function getDeckColorIdentity(commanderIds: string[], snapshots: Map<string, CardSnapshot>): Color[] {
  const identity = new Set<Color>()
  for (const id of commanderIds) {
    for (const c of snapshots.get(id)?.color_identity ?? []) {
      if ((WUBRG as readonly string[]).includes(c)) identity.add(c as Color)
    }
  }
  return WUBRG.filter((c) => identity.has(c))
}

type Props = {
  onClose: () => void
}

function DeckManagerModal({ onClose }: Props) {
  const { decks, activeDeckId, switchDeck, createDeck, deleteDeck, renameDeck } = useDeckList()
  const [newDeckName, setNewDeckName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [snapshots, setSnapshots] = useState<Map<string, CardSnapshot>>(new Map())

  // Commander art is cached locally alongside the rest of the deck's cards, so this is purely a
  // local IndexedDB lookup, not a network call — cheap enough to redo whenever the deck list changes.
  useEffect(() => {
    const ids = [...new Set(decks.flatMap((d) => d.commanderIds))]
    if (ids.length === 0) {
      setSnapshots(new Map())
      return
    }
    let cancelled = false
    void getSnapshots(ids).then((results) => {
      if (cancelled) return
      setSnapshots(new Map(results.filter((s): s is CardSnapshot => !!s).map((s) => [s.id, s])))
    })
    return () => {
      cancelled = true
    }
  }, [decks])

  async function handleCreate() {
    await createDeck(newDeckName.trim() || 'New Deck')
    setNewDeckName('')
    onClose()
  }

  async function handleSwitch(id: string) {
    await switchDeck(id)
    onClose()
  }

  async function handleConfirmDelete() {
    if (deletingId) await deleteDeck(deletingId)
    setDeletingId(null)
  }

  function startEditing(id: string, currentName: string) {
    setEditingId(id)
    setEditingName(currentName)
  }

  async function commitRename() {
    const name = editingName.trim()
    if (editingId && name) await renameDeck(editingId, name)
    setEditingId(null)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Deck manager" onClick={onClose}>
      <div className="modal-content deck-manager" onClick={(event) => event.stopPropagation()}>
        <h2>Your Decks</h2>
        <ul className="deck-manager-list">
          {decks.map((d) => (
            <li key={d.id} className={`deck-manager-row ${d.id === activeDeckId ? 'is-active' : ''}`}>
              {editingId === d.id ? (
                <input
                  type="text"
                  className="deck-manager-row__name-input"
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename()
                    if (event.key === 'Escape') setEditingId(null)
                  }}
                />
              ) : (
                <button type="button" className="deck-manager-row__main" onClick={() => handleSwitch(d.id)}>
                  <DeckManagerCommanders commanderIds={d.commanderIds} snapshots={snapshots} />
                  <span className="deck-manager-row__text">
                    <span className="deck-manager-row__name">
                      <span className="deck-manager-row__name-text">{d.name}</span>
                      {d.id === activeDeckId && <span className="deck-manager-row__badge">Active</span>}
                    </span>
                    <span
                      className="deck-manager-row__color-stripe"
                      style={{ background: colorStripeBackground(getDeckColorIdentity(d.commanderIds, snapshots)) }}
                    />
                    <span className="deck-manager-row__meta">
                      {d.format ? <span className="deck-manager-row__format">{d.format}</span> : null}
                      {d.cardCount} cards
                    </span>
                  </span>
                </button>
              )}
              <div className="deck-manager-row__actions">
                <button type="button" aria-label={`Rename ${d.name}`} onClick={() => startEditing(d.id, d.name)}>
                  Rename
                </button>
                <button type="button" aria-label={`Delete ${d.name}`} onClick={() => setDeletingId(d.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
          {decks.length === 0 && <li className="deck-manager-empty">No decks yet.</li>}
        </ul>
        <div className="deck-manager-create">
          <input
            type="text"
            placeholder="New deck name"
            value={newDeckName}
            onChange={(event) => setNewDeckName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleCreate()
            }}
          />
          <button type="button" onClick={handleCreate}>
            Create Deck
          </button>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {deletingId && (
        <ConfirmModal
          title="Delete deck"
          message={`Delete "${decks.find((d) => d.id === deletingId)?.name}"? This can't be undone from within the app.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </div>
  )
}

export default DeckManagerModal
