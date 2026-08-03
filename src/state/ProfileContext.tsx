import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import BootstrapError from '../components/shared/BootstrapError'
import {
  bootstrapProfiles,
  createProfile as createProfileInStore,
  deleteProfile as deleteProfileInStore,
  listProfiles,
  renameProfile as renameProfileInStore,
  setActiveProfile,
  setDefaultProfile as setDefaultProfileInStore,
  updateProfileSettings as updateProfileSettingsInStore,
} from '../storage/profileRepository'
import type { Profile, ProfileSettings } from './types'

type ProfileContextValue = {
  profiles: Profile[]
  activeProfileId: string
  /** Convenience lookup — the same object every call site would otherwise get via
   *  `profiles.find((p) => p.id === activeProfileId)`. undefined only for the brief window before
   *  bootstrapProfiles resolves (callers inside the tree render after that, per Workspace's own
   *  `!ready` gate, so in practice this is only ever undefined pre-mount). */
  activeProfile: Profile | undefined
  defaultProfileId: string | null
  switchProfile: (id: string) => Promise<void>
  createProfile: (name: string) => Promise<void>
  renameProfile: (id: string, name: string) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  setDefaultProfile: (id: string) => Promise<void>
  /** Merges `partial` into the ACTIVE profile's stored settings and persists it. Merges rather
   *  than replaces so callers (Settings page, useProfileSettings' one-time theme migration) only
   *  ever need to pass the field(s) they're actually changing. */
  updateSettings: (partial: Partial<ProfileSettings>) => Promise<void>
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

  // updateProfileSettingsInStore does its own read-modify-write (loadAppData then saveAppData) —
  // two overlapping calls (e.g. flipping the theme then immediately a checkbox, both from
  // Settings) can otherwise race: the slower one's loadAppData reads before the faster one's
  // saveAppData commits, so its write clobbers the other's field instead of merging with it. This
  // ref chains every write behind the previous one so each call's storage read only ever happens
  // after the prior write has actually landed, regardless of how quickly they fire.
  const settingsWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

  const updateSettings = useCallback(
    async (partial: Partial<ProfileSettings>) => {
      if (!activeProfileId) return
      const id = activeProfileId
      // Merge against the latest known settings rather than a possibly-stale closure value —
      // profiles is read fresh via the updater form so two quick successive updateSettings calls
      // (e.g. dragging a slider) can't clobber each other on the React-state side.
      let merged: ProfileSettings = {}
      setProfiles((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p
          merged = { ...p.settings, ...partial }
          return { ...p, settings: merged }
        }),
      )
      const next = settingsWriteQueueRef.current.then(() => updateProfileSettingsInStore(id, merged))
      // Swallow here so one failed write doesn't poison the queue for every write after it —
      // the queue only needs to serialize ordering, not propagate failures to unrelated callers.
      settingsWriteQueueRef.current = next.catch(() => {})
      await next
    },
    [activeProfileId],
  )

  const activeProfile = profiles.find((p) => p.id === activeProfileId)

  const value = useMemo(
    () => ({
      profiles,
      activeProfileId: activeProfileId ?? '',
      activeProfile,
      defaultProfileId,
      switchProfile,
      createProfile,
      renameProfile,
      deleteProfile,
      setDefaultProfile,
      updateSettings,
    }),
    [profiles, activeProfileId, activeProfile, defaultProfileId, switchProfile, createProfile, renameProfile, deleteProfile, setDefaultProfile, updateSettings],
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
