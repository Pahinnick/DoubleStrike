const { app, BrowserWindow, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { registerStorageIpc } = require('./storage.cjs')
const { registerNetIpc, registerBackgroundIpc } = require('./net.cjs')
const { registerUpdaterIpc } = require('./updater.cjs')
const { hardenWindow, registerShellIpc } = require('./windowSecurity.cjs')
const {
  registerPlaytestWindowIpc,
  maybeReopenPlaytestWindow,
  closePlaytestWindowIfOpen,
  markQuitting,
  setMainWindow,
} = require('./playtestWindow.cjs')

// Fixed rather than OS-assigned (port 0): Chromium's storage APIs (IndexedDB,
// localStorage) are partitioned by origin, and origin includes the port. An
// OS-assigned port would mean a new origin — and therefore empty storage — on
// every launch of the packaged app. Falls back to a random port only if this
// one is somehow already taken.
const PREFERRED_PORT = 51837

const isDev = !app.isPackaged

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// Loads the packaged build over a real http:// origin rather than file://.
// Chromium's storage APIs (IndexedDB, which this app relies on entirely for
// deck/card persistence) are unreliable or outright disabled for file://
// pages — serving locally sidesteps that instead of hoping it works.
function serveDist(distDir) {
  const root = path.resolve(distDir)

  function requestHandler(req, res) {
    // A malformed escape ("/%") makes decodeURIComponent throw, and an exception here is an
    // uncaught one in the main process — any local page or process can send such a request.
    let requestPath
    try {
      requestPath = decodeURIComponent(req.url.split('?')[0])
    } catch {
      res.writeHead(400)
      res.end('Bad request')
      return
    }
    const filePath = path.resolve(root, `.${requestPath === '/' ? '/index.html' : requestPath}`)

    // Stay inside distDir even if req.url tries to traverse out of it (e.g. "/../"). Compared
    // against `root + separator`, not a bare startsWith(root): path.join/resolve already
    // normalize away "..", but a plain prefix test also accepts any SIBLING directory whose
    // name merely starts with the root's (dist -> dist-anything), which is not inside it.
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA-style fallback: unknown paths (e.g. a refresh mid-route) still get the app shell.
        fs.readFile(path.join(distDir, 'index.html'), (fallbackErr, fallbackData) => {
          if (fallbackErr) {
            res.writeHead(404)
            res.end('Not found')
            return
          }
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(fallbackData)
        })
        return
      }
      const ext = path.extname(filePath)
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' })
      res.end(data)
    })
  }

  function listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer(requestHandler)
      server.listen(port, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${server.address().port}`)
      })
      server.on('error', reject)
    })
  }

  // Preferred port keeps the origin (and therefore IndexedDB/localStorage) stable
  // across launches of the packaged app. If it's taken (e.g. another instance
  // already running), fall back to an OS-assigned port rather than failing to launch.
  return listen(PREFERRED_PORT).catch((err) => {
    if (err.code !== 'EADDRINUSE') throw err
    return listen(0)
  })
}

// Resolved once at startup and reused for every window (main and Playtest) — calling
// serveDist more than once would spin up a second HTTP server and, if the preferred port
// were already taken, hand back a different origin, which would silently split
// IndexedDB/localStorage between windows instead of sharing it.
async function resolveBaseUrl() {
  if (isDev) return process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
  const distDir = path.join(__dirname, '..', 'dist')
  return serveDist(distDir)
}

// A packaged .exe already gets its taskbar/titlebar icon from the resource electron-builder
// embeds (from build.icon in package.json) — this option only actually matters in DEV, where an
// unpackaged Electron process otherwise shows the generic Electron icon instead of DoubleStrike's.
// Explicitly undefined once packaged rather than pointing at build/icon.png regardless: that path
// isn't part of build.files, so it wouldn't exist in a packaged app anyway (Electron would just
// silently ignore it) — being explicit here is clearer than relying on that silent fallback.
const APP_ICON = app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.png')

function createMainWindow(baseUrl) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
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
  hardenWindow(win, baseUrl)
  win.loadURL(baseUrl)
  // Closing the main window is "closing the app" in this single-window-by-default model —
  // take the Playtest window down with it, but mark it as having been open (not
  // user-closed) first so it comes back automatically on the next launch.
  win.on('close', () => markQuitting())
  win.on('closed', () => closePlaytestWindowIfOpen())
  setMainWindow(win)
  mainWindowRef = win
  return win
}

// A second copy of the app would find PREFERRED_PORT taken, fall back to a random port — a
// different origin, so empty IndexedDB/localStorage — and write the same profile and deck files
// as the first. Hand focus to the running instance instead.
let mainWindowRef = null
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return
    if (mainWindowRef.isMinimized()) mainWindowRef.restore()
    mainWindowRef.focus()
  })
}

app.whenReady().then(async () => {
  if (!hasInstanceLock) return
  // autoHideMenuBar (in createMainWindow) only hides the bar until Alt is pressed —
  // it doesn't remove it. Removing the menu entirely means Alt does nothing.
  Menu.setApplicationMenu(null)
  registerStorageIpc()
  registerNetIpc()
  registerBackgroundIpc()
  registerShellIpc()
  const baseUrl = await resolveBaseUrl()
  registerPlaytestWindowIpc(baseUrl)
  createMainWindow(baseUrl)
  maybeReopenPlaytestWindow(baseUrl)
  // Passed as a getter, not the window itself: on macOS the app outlives its window and
  // 'activate' below creates a new one, which a captured reference would never see.
  registerUpdaterIpc(() => mainWindowRef)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(baseUrl)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
