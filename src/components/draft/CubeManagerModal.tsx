import { useEffect, useState } from 'react'
import { deleteCube, listCubes } from '../../storage/cubeRepository'
import type { CubeSummary } from '../../draft/types'
import ConfirmModal from '../shared/ConfirmModal'
import CubeEditorModal from './CubeEditorModal'
import './draft.css'

type Props = {
  profileId: string
  onClose: () => void
}

function CubeManagerModal({ profileId, onClose }: Props) {
  const [cubes, setCubes] = useState<CubeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [editingCubeId, setEditingCubeId] = useState<string | null | 'new'>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setCubes(await listCubes(profileId))
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  async function handleConfirmDelete() {
    if (deletingId) {
      await deleteCube(profileId, deletingId)
      await refresh()
    }
    setDeletingId(null)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Cube manager" onClick={onClose}>
      <div className="modal-content cube-manager" onClick={(event) => event.stopPropagation()}>
        <h2>Cubes</h2>
        <p className="cube-manager__hint">A cube is a custom card pool your group drafts from — packs are just this list shuffled and split evenly.</p>
        <ul className="cube-manager-list">
          {loading && <li className="cube-manager-empty">Loading…</li>}
          {!loading && cubes.length === 0 && <li className="cube-manager-empty">No cubes yet.</li>}
          {cubes.map((cube) => (
            <li key={cube.id} className="cube-manager-row">
              <button type="button" className="cube-manager-row__main" onClick={() => setEditingCubeId(cube.id)}>
                <span className="cube-manager-row__name">{cube.name}</span>
                <span className="cube-manager-row__meta">{cube.cardCount} cards</span>
              </button>
              <div className="cube-manager-row__actions">
                <button type="button" aria-label={`Edit ${cube.name}`} onClick={() => setEditingCubeId(cube.id)}>
                  Edit
                </button>
                <button type="button" aria-label={`Delete ${cube.name}`} onClick={() => setDeletingId(cube.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setEditingCubeId('new')}>
          New Cube
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {editingCubeId !== null && (
        <CubeEditorModal
          profileId={profileId}
          cubeId={editingCubeId === 'new' ? undefined : editingCubeId}
          onClose={() => {
            setEditingCubeId(null)
            void refresh()
          }}
        />
      )}
      {deletingId && (
        <ConfirmModal
          title="Delete cube"
          message={`Delete "${cubes.find((c) => c.id === deletingId)?.name}"? This can't be undone.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </div>
  )
}

export default CubeManagerModal
