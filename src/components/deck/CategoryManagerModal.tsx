import { useState } from 'react'
import { useDeck } from '../../state/DeckContext'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'
import './categoryManager.css'

type Props = {
  onClose: () => void
}

function CategoryManagerModal({ onClose }: Props) {
  useEscapeToClose(onClose)
  const { deck, dispatch } = useDeck()
  const [newCategory, setNewCategory] = useState('')
  const [renaming, setRenaming] = useState<{ original: string; draft: string } | null>(null)

  function handleAdd() {
    if (!newCategory.trim()) return
    dispatch({ type: 'ADD_CATEGORY', name: newCategory })
    setNewCategory('')
  }

  function commitRename() {
    if (renaming && renaming.draft.trim() && renaming.draft.trim() !== renaming.original) {
      dispatch({ type: 'RENAME_CATEGORY', oldName: renaming.original, newName: renaming.draft })
    }
    setRenaming(null)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Manage categories" onClick={onClose}>
      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <h2>Categories</h2>
        <ul className="category-manager-list">
          {deck.categories.map((category) => (
            <li key={category}>
              {renaming?.original === category ? (
                <input
                  type="text"
                  value={renaming.draft}
                  autoFocus
                  onChange={(event) => setRenaming({ original: category, draft: event.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename()
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      setRenaming(null)
                    }
                  }}
                />
              ) : (
                <button type="button" onClick={() => setRenaming({ original: category, draft: category })}>
                  {category}
                </button>
              )}
              <button
                type="button"
                aria-label={`Delete ${category}`}
                onClick={() => dispatch({ type: 'REMOVE_CATEGORY', name: category })}
              >
                Delete
              </button>
            </li>
          ))}
          {deck.categories.length === 0 && <li className="category-manager-empty">No categories yet.</li>}
        </ul>
        <div className="category-manager-create">
          <input
            type="text"
            placeholder="New category name"
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleAdd()}
          />
          <button type="button" onClick={handleAdd}>
            Add
          </button>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export default CategoryManagerModal
