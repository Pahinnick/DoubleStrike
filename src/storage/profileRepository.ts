import { del, entries } from 'idb-keyval'
import type { AppData, Deck, Profile } from '../state/types'
import { decksStore, LEGACY_LAST_OPENED_DECK_KEY } from './db'
import { storage } from './storage'

const MIGRATION_FLAG_KEY = 'mtgdb:migratedLegacyDecks'

// Pre-profile decks were saved directly under their bare deckId; profile-scoped keys always
// look like `${profileId}::${deckId}` (see deckKey() in indexedDbAdapter.ts). One-time move
// of any such leftovers into the default profile so shipping profiles never hides a deck
// someone already had — this runs regardless of which storage backend is active, since the
// legacy data always lives in this renderer-side IndexedDB store.
async function migrateLegacyDecks(defaultProfileId: string): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG_KEY)) return
  const rows = await entries<string, Deck>(decksStore)
  const legacy = rows.filter(([key]) => !key.includes('::'))
  const legacyLastOpenedId = localStorage.getItem(LEGACY_LAST_OPENED_DECK_KEY)

  for (const [key, deck] of legacy) {
    await storage.saveDeck(defaultProfileId, deck)
    await del(key, decksStore)
  }
  if (legacyLastOpenedId && legacy.some(([, deck]) => deck.id === legacyLastOpenedId)) {
    await storage.setLastOpenedDeckId(defaultProfileId, legacyLastOpenedId)
  }
  localStorage.setItem(MIGRATION_FLAG_KEY, 'true')
}

function resolveActiveProfileId(appData: AppData): string {
  const candidates = [appData.lastActiveProfileId, appData.defaultProfileId, appData.profiles[0]?.id]
  const validId = candidates.find((id) => id && appData.profiles.some((p) => p.id === id))
  // storage.loadAppData() always seeds at least one profile, so a valid id always exists.
  return validId as string
}

export type ProfileBootstrap = {
  profiles: Profile[]
  defaultProfileId: string | null
  activeProfileId: string
}

export async function bootstrapProfiles(): Promise<ProfileBootstrap> {
  const appData = await storage.loadAppData()
  try {
    await migrateLegacyDecks(appData.defaultProfileId ?? appData.profiles[0].id)
  } catch (err) {
    // This is a one-time legacy-deck sweep gated by a localStorage flag that only gets set on
    // success — a transient IndexedDB hiccup here (stale connection, blocked version-change
    // transaction) must not brick the whole profiles screen when appData itself loaded fine.
    // Leaving the flag unset just means it retries on the next bootstrap.
    console.error('[profiles] legacy deck migration failed, will retry next launch', err)
  }
  return {
    profiles: appData.profiles,
    defaultProfileId: appData.defaultProfileId,
    activeProfileId: resolveActiveProfileId(appData),
  }
}

export async function listProfiles(): Promise<Profile[]> {
  const appData = await storage.loadAppData()
  return appData.profiles
}

export async function createProfile(name: string): Promise<Profile> {
  return storage.createProfile(name)
}

export async function renameProfile(id: string, name: string): Promise<void> {
  await storage.renameProfile(id, name)
}

export async function deleteProfile(id: string): Promise<void> {
  await storage.deleteProfile(id)
}

export async function setDefaultProfile(id: string): Promise<void> {
  await storage.setDefaultProfile(id)
}

export async function setActiveProfile(id: string): Promise<void> {
  await storage.setActiveProfile(id)
}
