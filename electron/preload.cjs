const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronStorage', {
  loadAppData: () => ipcRenderer.invoke('storage:loadAppData'),
  createProfile: (name) => ipcRenderer.invoke('storage:createProfile', name),
  renameProfile: (id, name) => ipcRenderer.invoke('storage:renameProfile', id, name),
  deleteProfile: (id) => ipcRenderer.invoke('storage:deleteProfile', id),
  setDefaultProfile: (id) => ipcRenderer.invoke('storage:setDefaultProfile', id),
  setActiveProfile: (id) => ipcRenderer.invoke('storage:setActiveProfile', id),
  updateProfileSettings: (id, settings) => ipcRenderer.invoke('storage:updateProfileSettings', id, settings),
  getProfileMeta: (profileId) => ipcRenderer.invoke('storage:getProfileMeta', profileId),
  setLastOpenedDeckId: (profileId, deckId) => ipcRenderer.invoke('storage:setLastOpenedDeckId', profileId, deckId),
  listDecks: (profileId) => ipcRenderer.invoke('storage:listDecks', profileId),
  loadDeck: (profileId, deckId) => ipcRenderer.invoke('storage:loadDeck', profileId, deckId),
  saveDeck: (profileId, deck) => ipcRenderer.invoke('storage:saveDeck', profileId, deck),
  deleteDeck: (profileId, deckId) => ipcRenderer.invoke('storage:deleteDeck', profileId, deckId),
  openDecksFolder: (profileId) => ipcRenderer.invoke('storage:openDecksFolder', profileId),
  openBackupFolder: () => ipcRenderer.invoke('storage:openBackupFolder'),
  getPaths: (profileId) => ipcRenderer.invoke('storage:getPaths', profileId),
})

contextBridge.exposeInMainWorld('electronNet', {
  fetchArchidektDeck: (deckId) => ipcRenderer.invoke('net:fetchArchidektDeck', deckId),
})

contextBridge.exposeInMainWorld('electronShell', {
  // Hands an outbound link to the user's real browser instead of loading it in an Electron
  // window (which would carry this preload with it — see windowSecurity.cjs). The main process
  // re-checks the URL against its own allow-list, so this is not a general-purpose opener.
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
})

contextBridge.exposeInMainWorld('electronUpdater', {
  onUpdateDownloaded: (callback) => {
    const listener = (_event, info) => callback(info)
    ipcRenderer.on('updater:downloaded', listener)
    return () => ipcRenderer.removeListener('updater:downloaded', listener)
  },
  quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
})

contextBridge.exposeInMainWorld('electronPlaytest', {
  open: () => ipcRenderer.invoke('playtest:open'),
  switchToInline: () => ipcRenderer.invoke('playtest:switchToInline'),
  onSwitchToInline: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('playtest:openInline', listener)
    return () => ipcRenderer.removeListener('playtest:openInline', listener)
  },
})
