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

module.exports = { registerNetIpc }
