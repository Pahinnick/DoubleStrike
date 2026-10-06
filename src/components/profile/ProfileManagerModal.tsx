import { useState } from 'react'
import { useProfiles } from '../../state/ProfileContext'
import ConfirmModal from '../shared/ConfirmModal'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'

type Props = {
  onClose: () => void
}

function ProfileManagerModal({ onClose }: Props) {
  useEscapeToClose(onClose)
  const { profiles, activeProfileId, defaultProfileId, switchProfile, createProfile, renameProfile, deleteProfile, setDefaultProfile } =
    useProfiles()
  const [newProfileName, setNewProfileName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleSwitch(id: string) {
    if (id === activeProfileId) return
    await switchProfile(id)
    onClose()
  }

  async function handleCreate() {
    const name = newProfileName.trim()
    if (!name) return
    await createProfile(name)
    setNewProfileName('')
    onClose()
  }

  function startEditing(id: string, currentName: string) {
    setEditingId(id)
    setEditingName(currentName)
  }

  async function commitRename() {
    const name = editingName.trim()
    if (editingId && name) await renameProfile(editingId, name)
    setEditingId(null)
  }

  async function handleConfirmDelete() {
    if (deletingId) await deleteProfile(deletingId)
    setDeletingId(null)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Profiles" onClick={onClose}>
      <div className="modal-content profile-manager" onClick={(event) => event.stopPropagation()}>
        <h2>Profiles</h2>
        <p className="profile-manager__hint">Each profile keeps its own separate set of decks.</p>
        <ul className="profile-manager-list">
          {profiles.map((profile) => (
            <li key={profile.id} className={profile.id === activeProfileId ? 'is-active' : ''}>
              {editingId === profile.id ? (
                <input
                  type="text"
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename()
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      setEditingId(null)
                    }
                  }}
                />
              ) : (
                <button type="button" className="profile-manager-list__name" onClick={() => handleSwitch(profile.id)}>
                  {profile.name}
                  {profile.id === defaultProfileId && <span className="profile-manager-list__badge">Default</span>}
                </button>
              )}
              <button type="button" aria-label={`Rename ${profile.name}`} onClick={() => startEditing(profile.id, profile.name)}>
                Rename
              </button>
              <button
                type="button"
                aria-label={`Make ${profile.name} the default profile`}
                disabled={profile.id === defaultProfileId}
                onClick={() => setDefaultProfile(profile.id)}
              >
                Set Default
              </button>
              <button
                type="button"
                aria-label={`Delete ${profile.name}`}
                disabled={profiles.length <= 1}
                title={profiles.length <= 1 ? 'At least one profile is required' : undefined}
                onClick={() => setDeletingId(profile.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="profile-manager-create">
          <input
            type="text"
            placeholder="New profile name"
            value={newProfileName}
            onChange={(event) => setNewProfileName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleCreate()
            }}
          />
          <button type="button" onClick={handleCreate}>
            Add Profile
          </button>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {deletingId && (
        <ConfirmModal
          title="Delete profile"
          message={`Delete "${profiles.find((p) => p.id === deletingId)?.name}"? Its decks will no longer appear in the app, but the files themselves (and their backups) are left on disk.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </div>
  )
}

export default ProfileManagerModal
