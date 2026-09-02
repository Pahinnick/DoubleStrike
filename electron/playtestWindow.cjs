// Manages the Playtest board's own OS window: opening/focusing it from the main window,
// and remembering its screen position/size (and whether it was left open) across app
// restarts so relaunching the app puts it right back where the player left it.
const { app, BrowserWindow, screen, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { hardenWindow } = require('./windowSecurity.cjs')

const DEFAULT_BOUNDS = { width: 1300, height: 860 }
const SAVE_DEBOUNCE_MS = 400
// See the matching constant/comment in main.cjs — only actually matters in dev (unpackaged) mode.
const APP_ICON = app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.png')

function stateFile() {
  return path.join(app.getPath('userData'), 'playtest-window.json')
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf-8'))
  } catch {
    return { wasOpen: false }
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf-8')
  } catch (err) {
    console.error('[playtestWindow] failed to save window state', err)
  }
}

// A saved position can go stale (e.g. the window was last on a second monitor that's since
// been unplugged) — only trust it if it still lands on some currently-connected display.
function boundsOnScreen(bounds) {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    )
  })
}

let playtestWin = null
let mainWin = null
let saveTimer = null
// Set true while the whole app is going down (main window closing) so the playtest
// window's own 'close' handler knows to record "was open" instead of "was closed" —
// see the win.on('close', ...) handler in openPlaytestWindow below.
let quitting = false

function markQuitting() {
  quitting = true
}

// Recorded so playtest:switchToInline (triggered from the dedicated window) knows which
// window to relay "open inline" to — there's no window.opener relationship between separate
// BrowserWindows the way there is for a window.open() popup in the browser dev fallback.
function setMainWindow(win) {
  mainWin = win
}

function persistBounds(win) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (win.isDestroyed()) return
    writeState({ ...win.getBounds(), wasOpen: true })
  }, SAVE_DEBOUNCE_MS)
}

function openPlaytestWindow(baseUrl) {
  if (playtestWin && !playtestWin.isDestroyed()) {
    playtestWin.focus()
    return playtestWin
  }

  const saved = readState()
  const candidate = {
    width: saved.width ?? DEFAULT_BOUNDS.width,
    height: saved.height ?? DEFAULT_BOUNDS.height,
    x: saved.x,
    y: saved.y,
  }
  const bounds = boundsOnScreen(candidate)
    ? candidate
    : { width: candidate.width, height: candidate.height }

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#16171a',
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  playtestWin = win
  // Same webPreferences (and therefore the same preload) as the main window, so it needs the
  // same window-open/navigation guards — see windowSecurity.cjs.
  hardenWindow(win, baseUrl)
  win.loadURL(`${baseUrl}?mode=playtest`)
  win.on('move', () => persistBounds(win))
  win.on('resize', () => persistBounds(win))
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    // quitting: the app is shutting down with this window still open, so the state
    // to remember is "reopen me next launch" (wasOpen: true), not "user closed me".
    writeState({ ...win.getBounds(), wasOpen: quitting })
  })
  win.on('closed', () => {
    if (playtestWin === win) playtestWin = null
  })

  writeState({ ...bounds, wasOpen: true })
  return win
}

function closePlaytestWindowIfOpen() {
  if (playtestWin && !playtestWin.isDestroyed()) playtestWin.close()
}

function maybeReopenPlaytestWindow(baseUrl) {
  if (readState().wasOpen) openPlaytestWindow(baseUrl)
}

function registerPlaytestWindowIpc(baseUrl) {
  ipcMain.handle('playtest:open', () => {
    openPlaytestWindow(baseUrl)
  })

  // The dedicated window is switching itself to inline mode: tell the main window to show
  // Playtest inline, then close this one. The renderer has already flushed the in-progress
  // game to the solo autosave before calling this, so the main window's own PlaytestView
  // mount picks it straight back up (same resume path an app relaunch already uses).
  ipcMain.handle('playtest:switchToInline', (event) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('playtest:openInline')
      mainWin.focus()
    }
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}

module.exports = {
  registerPlaytestWindowIpc,
  openPlaytestWindow,
  maybeReopenPlaytestWindow,
  closePlaytestWindowIfOpen,
  markQuitting,
  setMainWindow,
}
