import { useState } from 'react'
import { useDeckList } from '../../state/DeckListContext'
import ConfirmModal from '../shared/ConfirmModal'
import './deckManager.css'

type Props = {
  onClose: () => void
}

function DeckManagerModal({ onClose }: Props) {
  const { decks, activeDeckId, switchDeck, createDeck, deleteDeck, renameDeck } = useDeckList()
  const [newDeckName, setNewDeckName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

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
                  <span className="deck-manager-row__name">
                    {d.name}
                    {d.id === activeDeckId && <span className="deck-manager-row__badge">Active</span>}
                  </span>
                  <span className="deck-manager-row__meta">
                    {d.cardCount} cards{d.format ? ` · ${d.format}` : ''}
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
