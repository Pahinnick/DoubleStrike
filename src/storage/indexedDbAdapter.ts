import { del, entries, get, set } from 'idb-keyval'
import type { AppData, Deck, Profile } from '../state/types'
import { APP_DATA_KEY, decksStore, profilesStore } from './db'
import type { StorageAdapter } from './storageAdapter'

const EMPTY_APP_DATA: AppData = { profiles: [], defaultProfileId: null, lastActiveProfileId: null }

function deckKey(profileId: string, deckId: string): string {
  return `${profileId}::${deckId}`
}

function lastOpenedKey(profileId: string): string {
  return `mtgdb:lastOpenedDeckId:${profileId}`
}

function profileIdFromDeckKey(key: string): string | null {
  const idx = key.indexOf('::')
  return idx === -1 ? null : key.slice(0, idx)
}

/** Ids that have data (a deck) but aren't in the known profile list and weren't deliberately
 *  deleted — i.e. orphaned rather than intentionally gone. Exported for testing. */
export function findOrphanedProfileIds(
  candidateIds: Iterable<string>,
  knownIds: ReadonlySet<string>,
  deletedIds: ReadonlySet<string>,
): string[] {
  const found = new Set<string>()
  for (const id of candidateIds) {
    if (!knownIds.has(id) && !deletedIds.has(id)) found.add(id)
  }
  return [...found]
}

/**
 * `profilesStore`'s app-data entry (the profile list) and `decksStore`'s deck rows can drift apart —
 * the app-data entry can be lost or reset independently of the decks (e.g. clearing just that key via
 * devtools, or the exact failure this recovers from: an app-data.json workaround on the Electron build
 * wiping the profile list while decks survive). Recovers any profile id with decks on record but
 * missing from the list — never one the user deliberately deleted (`deletedProfileIds`), since
 * `deleteProfile` intentionally leaves that profile's decks in place too.
 */
async function recoverOrphanedProfiles(data: AppData): Promise<AppData | null> {
  const rows = await entries<string, Deck>(decksStore)
  const candidateIds = rows.map(([key]) => profileIdFromDeckKey(key)).filter((id): id is string => id !== null)
  const known = new Set(data.profiles.map((p) => p.id))
  const deleted = new Set(data.deletedProfileIds ?? [])
  const orphanedIds = findOrphanedProfileIds(candidateIds, known, deleted)
  if (orphanedIds.length === 0) return null

  const recovered: Profile[] = orphanedIds.map((id, i) => ({
    id,
    name: `Recovered Profile ${data.profiles.length + i + 1}`,
    createdAt: new Date().toISOString(),
  }))
  const merged: AppData = { ...data, profiles: [...data.profiles, ...recovered] }
  if (!merged.defaultProfileId) merged.defaultProfileId = merged.profiles[0].id
  if (!merged.lastActiveProfileId) merged.lastActiveProfileId = merged.defaultProfileId
  return merged
}

async function loadAppData(): Promise<AppData> {
  const stored = (await get<AppData>(APP_DATA_KEY, profilesStore)) ?? EMPTY_APP_DATA
  const recovered = await recoverOrphanedProfiles(stored)
  const data = recovered ?? stored

  if (data.profiles.length === 0) {
    const profile: Profile = { id: crypto.randomUUID(), name: 'Player 1', createdAt: new Date().toISOString() }
    const seeded: AppData = { profiles: [profile], defaultProfileId: profile.id, lastActiveProfileId: profile.id }
    await set(APP_DATA_KEY, seeded, profilesStore)
    return seeded
  }
  if (recovered) await set(APP_DATA_KEY, recovered, profilesStore)
  return data
}

async function saveAppData(data: AppData): Promise<void> {
  await set(APP_DATA_KEY, data, profilesStore)
}

/** Browser/dev fallback used whenever window.electronStorage isn't present (i.e. not running inside Electron). */
export const indexedDbAdapter: StorageAdapter = {
  loadAppData,

  async createProfile(name) {
    const data = await loadAppData()
    const profile: Profile = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }
    data.profiles.push(profile)
    await saveAppData(data)
    return profile
  },

  async renameProfile(id, name) {
    const data = await loadAppData()
    const profile = data.profiles.find((p) => p.id === id)
    if (profile) profile.name = name
    await saveAppData(data)
  },

  async deleteProfile(id) {
    const data = await loadAppData()
    data.profiles = data.profiles.filter((p) => p.id !== id)
    if (data.defaultProfileId === id) data.defaultProfileId = data.profiles[0]?.id ?? null
    if (data.lastActiveProfileId === id) data.lastActiveProfileId = data.defaultProfileId
    // Recorded so the next loadAppData()'s orphan-recovery scan doesn't resurrect this profile —
    // its decks are left in decksStore on purpose (see listDecks/loadDeck), which would otherwise
    // look identical to an accidentally-orphaned profile.
    data.deletedProfileIds = [...new Set([...(data.deletedProfileIds ?? []), id])]
    await saveAppData(data)
  },

  async setDefaultProfile(id) {
    const data = await loadAppData()
    data.defaultProfileId = id
    await saveAppData(data)
  },

  async setActiveProfile(id) {
    const data = await loadAppData()
    data.lastActiveProfileId = id
    await saveAppData(data)
  },

  async getLastOpenedDeckId(profileId) {
    return localStorage.getItem(lastOpenedKey(profileId)) ?? undefined
  },

  async setLastOpenedDeckId(profileId, deckId) {
    localStorage.setItem(lastOpenedKey(profileId), deckId)
  },

  async listDecks(profileId) {
    const prefix = deckKey(profileId, '')
    const rows = await entries<string, Deck>(decksStore)
    return rows.filter(([key]) => key.startsWith(prefix)).map(([, deck]) => deck)
  },

  async loadDeck(profileId, deckId) {
    return get<Deck>(deckKey(profileId, deckId), decksStore)
  },

  async saveDeck(profileId, deck) {
    await set(deckKey(profileId, deck.id), deck, decksStore)
  },

  async deleteDeck(profileId, deckId) {
    await del(deckKey(profileId, deckId), decksStore)
  },

  async getPaths() {
    return null
  },

  async openDecksFolder() {
    // No filesystem to open outside Electron.
  },

  async openBackupFolder() {
    // No filesystem to open outside Electron.
  },
}
