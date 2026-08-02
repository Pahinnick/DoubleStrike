import type { AppData, Deck, Profile } from '../state/types'

export type StoragePaths = {
  decksDir: string
  backupDir: string
}

export interface StorageAdapter {
  loadAppData(): Promise<AppData>
  createProfile(name: string): Promise<Profile>
  renameProfile(id: string, name: string): Promise<void>
  deleteProfile(id: string): Promise<void>
  setDefaultProfile(id: string): Promise<void>
  setActiveProfile(id: string): Promise<void>

  getLastOpenedDeckId(profileId: string): Promise<string | undefined>
  setLastOpenedDeckId(profileId: string, deckId: string): Promise<void>

  listDecks(profileId: string): Promise<Deck[]>
  loadDeck(profileId: string, deckId: string): Promise<Deck | undefined>
  saveDeck(profileId: string, deck: Deck): Promise<void>
  deleteDeck(profileId: string, deckId: string): Promise<void>

  /** null when this adapter has no on-disk location to show (e.g. the browser/IndexedDB fallback). */
  getPaths(profileId: string): Promise<StoragePaths | null>
  openDecksFolder(profileId: string): Promise<void>
  openBackupFolder(): Promise<void>
}
