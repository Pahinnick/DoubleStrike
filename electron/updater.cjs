// Background auto-update via electron-updater, checking GitHub Releases (see package.json's
// build.publish) for a newer *published* version. Draft releases (see .github/workflows/
// release.yml) are invisible to this on purpose — publishing the draft is the "go" signal.
const { app, ipcMain } = require('electron')

// Meaningless before the app is packaged: there's no signed installer feed to check against,
// and autoUpdater throws looking for a dev-app-update.yml that only `electron-builder` writes
// into a real build. Every export here is a no-op in dev, same as isDev elsewhere in main.cjs.
function registerUpdaterIpc(mainWindow) {
  if (!app.isPackaged) return

  const { autoUpdater } = require('electron-updater')
  // Applies only to the nsis installer target — the portable .exe has no install location to
  // overwrite, so those users simply keep re-downloading portables manually as before.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('updater:downloaded', { version: info.version })
  })
  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater]', err)
  })

  ipcMain.handle('updater:quitAndInstall', () => {
    autoUpdater.quitAndInstall()
  })

  // One check per launch, no polling loop — a user who leaves the app open for days just
  // picks up the new version on their next restart, same as most desktop apps. Errors here
  // (e.g. offline) are already caught by the 'error' listener above.
  autoUpdater.checkForUpdates().catch((err) => console.error('[autoUpdater] check failed', err))
}

module.exports = { registerUpdaterIpc }
