import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import BootstrapError from '../components/shared/BootstrapError'
import {
  bootstrapProfiles,
  createProfile as createProfileInStore,
  deleteProfile as deleteProfileInStore,
  listProfiles,
  renameProfile as renameProfileInStore,
  setActiveProfile,
  setDefaultProfile as setDefaultProfileInStore,
} from '../storage/profileRepository'
import type { Profile } from './types'

type ProfileContextValue = {
  profiles: Profile[]
  activeProfileId: string
  defaultProfileId: string | null
  switchProfile: (id: string) => Promise<void>
  createProfile: (name: string) => Promise<void>
  renameProfile: (id: string, name: string) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  setDefaultProfile: (id: string) => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function useProfiles(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfiles must be used within a ProfileProvider')
  return ctx
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [defaultProfileId, setDefaultProfileIdState] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    bootstrapProfiles()
      .then((result) => {
        if (cancelled) return
        setProfiles(result.profiles)
        setActiveProfileId(result.activeProfileId)
        setDefaultProfileIdState(result.defaultProfileId)
        setReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Without this, any failure here (corrupted storage, a filesystem error in the
        // desktop app, etc.) left the app on an infinite, silent "Loading profiles…"
        // screen forever — no error, no way to retry, nothing to report.
        console.error('[profiles] failed to load', err)
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [retryToken])

  const switchProfile = useCallback(async (id: string) => {
    await setActiveProfile(id)
    setActiveProfileId(id)
  }, [])

  const createProfile = useCallback(async (name: string) => {
    const profile = await createProfileInStore(name)
    setProfiles((prev) => [...prev, profile])
    await setActiveProfile(profile.id)
    setActiveProfileId(profile.id)
  }, [])

  const renameProfile = useCallback(async (id: string, name: string) => {
    await renameProfileInStore(id, name)
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
  }, [])

  const deleteProfile = useCallback(
    async (id: string) => {
      await deleteProfileInStore(id)
      const remaining = await listProfiles()
      setProfiles(remaining)
      if (id === activeProfileId) {
        const fallback = remaining[0]?.id
        if (fallback) {
          setActiveProfileId(fallback)
          await setActiveProfile(fallback)
        }
      }
      if (id === defaultProfileId) {
        setDefaultProfileIdState(remaining[0]?.id ?? null)
      }
    },
    [activeProfileId, defaultProfileId],
  )

  const setDefaultProfile = useCallback(async (id: string) => {
    await setDefaultProfileInStore(id)
    setDefaultProfileIdState(id)
  }, [])

  const value = useMemo(
    () => ({
      profiles,
      activeProfileId: activeProfileId ?? '',
      defaultProfileId,
      switchProfile,
      createProfile,
      renameProfile,
      deleteProfile,
      setDefaultProfile,
    }),
    [profiles, activeProfileId, defaultProfileId, switchProfile, createProfile, renameProfile, deleteProfile, setDefaultProfile],
  )

  if (error) {
    return (
      <BootstrapError
        message="Couldn't load your profiles."
        detail={error}
        onRetry={() => setRetryToken((n) => n + 1)}
      />
    )
  }

  if (!ready || !activeProfileId) {
    return <div className="app-loading">Loading profiles…</div>
  }

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}
