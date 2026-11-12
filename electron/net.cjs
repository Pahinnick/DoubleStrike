// Network fetches that the renderer can't make itself because of CORS, run in the main process
// (Node, no same-origin policy). Currently just Archidekt's deck API for link-based deck import.
const { ipcMain } = require('electron')

function registerNetIpc() {
  ipcMain.handle('net:fetchArchidektDeck', async (_event, deckId) => {
    // Only ever hit the decks endpoint with a numeric id — never interpolate arbitrary
    // renderer input into the URL.
    if (!/^\d+$/.test(String(deckId))) {
      throw new Error('Invalid Archidekt deck id')
    }
    const res = await fetch(`https://archidekt.com/api/decks/${deckId}/`)
    if (!res.ok) {
      throw new Error(`Archidekt returned ${res.status}`)
    }
    return res.json()
  })
}

// While a player is in a live game (multiplayer pod, draft, draft match), Chromium must not throttle
// this window in the background: its reconnect backoff and board heartbeat are timers, and a
// throttled window that's merely behind Discord could take a minute to come back after a network
// blip, invisible to everyone else meanwhile. Switched back on as soon as they leave the game.
function registerBackgroundIpc() {
  ipcMain.handle('net:setBackgroundActive', (event, active) => {
    event.sender.setBackgroundThrottling(!active)
  })
}

module.exports = { registerNetIpc, registerBackgroundIpc }
