// Cross-window plumbing for the Playtest "own window" vs "inline" toggle (see
// usePlaytestWindowMode) — opening the dedicated window, and relaying a "switch to inline"
// request from that window back to the main one. Electron: the dedicated Playtest window is
// its own BrowserWindow with no window.opener relationship to the main one, so this goes
// through the main process (see electron/playtestWindow.cjs). Browser dev fallback
// (`npm run dev` outside Electron): the dedicated window is a plain window.open() popup, so
// window.opener/postMessage does the same job directly, same-origin.
const SWITCH_TO_INLINE_MESSAGE = 'mtgdb:playtest:switchToInline'

// Set only on the dedicated Playtest window (see electron/playtestWindow.cjs, which loads
// this same app with ?mode=playtest) — a fresh mount of the whole tree, sharing storage with
// the main window via the same origin, that renders just the board instead of the deck
// editor. Read once: the query string never changes for the life of this window.
export const isPlaytestWindow = new URLSearchParams(window.location.search).get('mode') === 'playtest'

export function openDedicatedPlaytestWindow() {
  if (window.electronPlaytest) {
    void window.electronPlaytest.open()
    return
  }
  // No native window bounds to persist here, so just pop a same-sized new window; the named
  // target reuses it on repeat calls instead of spawning duplicates.
  window.open(`${window.location.pathname}?mode=playtest`, 'mtg-playtest', 'width=1300,height=860')
}

/** Tells the main window to switch Playtest to inline mode, then closes this (the dedicated)
 *  window — the window→inline half of the seamless toggle in PlaytestView. */
export function requestSwitchToInlineAndClose() {
  if (window.electronPlaytest) {
    void window.electronPlaytest.switchToInline()
    return
  }
  window.opener?.postMessage({ type: SWITCH_TO_INLINE_MESSAGE }, window.location.origin)
  window.close()
}

/** Subscribes the main window to "switch to inline" requests from the dedicated Playtest
 *  window. Returns an unsubscribe function. No-ops (returns a no-op unsubscribe) when called
 *  from the dedicated window itself — it only ever makes sense on the main window. */
export function onSwitchToInlineRequested(callback: () => void): () => void {
  if (window.electronPlaytest) {
    return window.electronPlaytest.onSwitchToInline(callback)
  }
  function handler(event: MessageEvent) {
    if (event.origin !== window.location.origin) return
    if (event.data?.type === SWITCH_TO_INLINE_MESSAGE) callback()
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}
