import { useState } from 'react'
import { useProfiles } from '../../state/ProfileContext'
import ProfileManagerModal from './ProfileManagerModal'
import './profile.css'

function ProfileSwitcher() {
  const { profiles, activeProfileId } = useProfiles()
  const [managerOpen, setManagerOpen] = useState(false)
  const activeProfile = profiles.find((p) => p.id === activeProfileId)

  return (
    <>
      <button type="button" className="profile-switcher" onClick={() => setManagerOpen(true)}>
        {activeProfile?.name ?? 'Profile'}
      </button>
      {managerOpen && <ProfileManagerModal onClose={() => setManagerOpen(false)} />}
    </>
  )
}

export default ProfileSwitcher
