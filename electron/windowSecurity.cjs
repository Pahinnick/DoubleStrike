// Window-creation and navigation guards, applied to every BrowserWindow this app opens.
//
// Electron's defaults are unsafe for any app that links out to the web at all, in two ways this
// app actually hit:
//
//   - `window.open()` with no setWindowOpenHandler creates a real BrowserWindow. In the
//     `about:blank` case specifically (which is what `window.open('', '_blank')` is), Chromium
//     skips browser-side navigation, so the child's webPreferences — INCLUDING this app's
//     preload and every ipcRenderer bridge it exposes — are copied wholesale from the parent,
//     and Electron documents that there is no way to override it afterwards. Navigating that
//     window on to a remote page (exactly what "Look Up Rulings" did: open a blank tab, then
//     point it at scryfall.com) therefore handed window.electronStorage & friends to whatever
//     site ended up loaded there.
//   - Nothing otherwise stops a window being navigated off the app's own origin, which would
//     put remote content inside the preload-bearing main window itself.
//
// So: deny every window-open request outright, route the allow-listed ones to the user's real
// browser via shell.openExternal, and pin each window to the origin it was loaded with.
const { ipcMain, shell } = require('electron')

// Hosts the app may hand to the OS browser. Deliberately exact-match and tiny: this is an
// allow-list, not a filter, so a new outbound link has to be added here on purpose. Everything
// that reaches shell.openExternal — including via the renderer IPC below — is checked against it,
// so a compromised renderer still can't turn this into a generic "open anything" primitive.
const ALLOWED_EXTERNAL_HOSTS = new Set(['scryfall.com', 'www.scryfall.com'])

/** True only for an https:// URL on an allow-listed host. Other schemes (file:, data:,
 *  javascript:) and other hosts are refused, as is anything unparseable. */
function isAllowedExternalUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  return url.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(url.hostname)
}

function isSameOrigin(rawUrl, appOrigin) {
  try {
    return new URL(rawUrl).origin === new URL(appOrigin).origin
  } catch {
    return false
  }
}

/** Opens an allow-listed URL in the user's real browser. Returns false and opens nothing for
 *  anything else — callers treat that as "silently do nothing", matching the renderer's own
 *  failure paths (a failed rulings lookup shouldn't interrupt the game it's attached to). */
function openExternalUrl(rawUrl) {
  if (!isAllowedExternalUrl(rawUrl)) {
    console.error('[windowSecurity] refused to open a URL that is not on the external allow-list:', rawUrl)
    return false
  }
  void shell.openExternal(rawUrl)
  return true
}

/**
 * Applies both guards to a window. `appOrigin` is the base URL the window was loaded with — the
 * app is a single-origin SPA (see main.cjs's serveDist), so any navigation off that origin is by
 * definition outbound and belongs in the user's browser, not in a window holding our preload.
 */
function hardenWindow(win, appOrigin) {
  // Nothing in this app legitimately needs a child BrowserWindow: the dedicated Playtest window
  // is created in the main process (see playtestWindow.cjs), and the only other window.open call
  // site is the plain-browser fallback in src/utils/playtestWindowBridge.ts, which never runs
  // under Electron. So deny unconditionally and treat the URL purely as "open this outside".
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isSameOrigin(url, appOrigin)) return
    event.preventDefault()
    openExternalUrl(url)
  })
}

/** Lets the renderer ask for an outbound link to be opened in the real browser. Re-validates
 *  against the same allow-list rather than trusting the caller. */
function registerShellIpc() {
  ipcMain.handle('shell:openExternal', (_event, url) => openExternalUrl(url))
}

module.exports = { hardenWindow, registerShellIpc, openExternalUrl, isAllowedExternalUrl }
