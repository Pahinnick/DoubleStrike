import type { StorageAdapter } from './storageAdapter'

/** Thin pass-through to the IPC bridge exposed by electron/preload.cjs. Only usable when window.electronStorage exists. */
export function createElectronAdapter(bridge: NonNullable<Window['electronStorage']>): StorageAdapter {
  return {
    loadAppData: () => bridge.loadAppData(),
    createProfile: (name) => bridge.createProfile(name),
    renameProfile: (id, name) => bridge.renameProfile(id, name),
    deleteProfile: (id) => bridge.deleteProfile(id),
    setDefaultProfile: (id) => bridge.setDefaultProfile(id),
    setActiveProfile: (id) => bridge.setActiveProfile(id),

    async getLastOpenedDeckId(profileId) {
      const meta = await bridge.getProfileMeta(profileId)
      return meta.lastOpenedDeckId ?? undefined
    },
    setLastOpenedDeckId: (profileId, deckId) => bridge.setLastOpenedDeckId(profileId, deckId),

    listDecks: (profileId) => bridge.listDecks(profileId),
    loadDeck: (profileId, deckId) => bridge.loadDeck(profileId, deckId),
    saveDeck: (profileId, deck) => bridge.saveDeck(profileId, deck),
    deleteDeck: (profileId, deckId) => bridge.deleteDeck(profileId, deckId),

    getPaths: (profileId) => bridge.getPaths(profileId),
    openDecksFolder: (profileId) => bridge.openDecksFolder(profileId),
    openBackupFolder: () => bridge.openBackupFolder(),
  }
}
