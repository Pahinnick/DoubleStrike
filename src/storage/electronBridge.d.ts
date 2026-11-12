import type { AppData, Deck, Profile, ProfileSettings } from '../state/types'

export type ElectronStorageBridge = {
  loadAppData(): Promise<AppData>
  createProfile(name: string): Promise<Profile>
  renameProfile(id: string, name: string): Promise<void>
  deleteProfile(id: string): Promise<void>
  setDefaultProfile(id: string): Promise<void>
  setActiveProfile(id: string): Promise<void>
  updateProfileSettings(id: string, settings: ProfileSettings): Promise<void>
  getProfileMeta(profileId: string): Promise<{ lastOpenedDeckId: string | null }>
  setLastOpenedDeckId(profileId: string, deckId: string): Promise<void>
  listDecks(profileId: string): Promise<Deck[]>
  loadDeck(profileId: string, deckId: string): Promise<Deck | undefined>
  saveDeck(profileId: string, deck: Deck): Promise<void>
  deleteDeck(profileId: string, deckId: string): Promise<void>
  openDecksFolder(profileId: string): Promise<void>
  openBackupFolder(): Promise<void>
  getPaths(profileId: string): Promise<{ decksDir: string; backupDir: string }>
}

export type ElectronNetBridge = {
  /** Fetches https://archidekt.com/api/decks/{deckId}/ from the main process (bypasses CORS). */
  fetchArchidektDeck(deckId: string): Promise<unknown>
  /** Stops (true) or restores (false) Chromium's background throttling of this window — see
   *  src/net/keepActive.ts. Optional: absent in builds from before it existed. */
  setBackgroundActive?(active: boolean): Promise<void>
}

export type ElectronShellBridge = {
  /** Opens an outbound link in the user's real browser rather than an Electron window. The main
   *  process validates the URL against its own allow-list first (see electron/windowSecurity.cjs)
   *  and resolves false without opening anything if it isn't on it. */
  openExternal(url: string): Promise<boolean>
}

export type ElectronPlaytestBridge = {
  /** Opens (or focuses, if already open) the Playtest board's own OS window. */
  open(): Promise<void>
  /** Called from inside the dedicated Playtest window: tells the main window to switch to
   *  inline mode, then closes this window. */
  switchToInline(): Promise<void>
  /** Called from the main window: subscribes to "switch to inline" requests relayed from the
   *  dedicated Playtest window. Returns an unsubscribe function. */
  onSwitchToInline(callback: () => void): () => void
}

export type ElectronUpdaterBridge = {
  /** Subscribes to the main process finishing a background update download. Returns an
   *  unsubscribe function. */
  onUpdateDownloaded(callback: (info: { version: string }) => void): () => void
  /** Quits and relaunches into the version that's already been downloaded. */
  quitAndInstall(): Promise<void>
}

declare global {
  interface Window {
    electronStorage?: ElectronStorageBridge
    electronNet?: ElectronNetBridge
    electronShell?: ElectronShellBridge
    electronPlaytest?: ElectronPlaytestBridge
    electronUpdater?: ElectronUpdaterBridge
  }
}
