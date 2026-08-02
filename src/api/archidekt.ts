// Archidekt's deck API (https://archidekt.com/api/decks/{id}/) does not send permissive CORS
// headers, so the renderer can't fetch it directly. Two escape hatches, picked at runtime:
//   - Packaged/Electron app: the main process (no CORS) fetches it over IPC (window.electronNet).
//   - Browser dev (`npm run dev`): Vite's server.proxy forwards /archidekt/* server-side.
// A plain hosted browser build (neither of the above) can't reach it — surfaced as an error.
export async function fetchArchidektDeckJson(deckId: string): Promise<unknown> {
  if (window.electronNet?.fetchArchidektDeck) {
    return window.electronNet.fetchArchidektDeck(deckId)
  }
  if (import.meta.env.DEV) {
    const res = await fetch(`/archidekt/api/decks/${deckId}/`)
    if (!res.ok) throw new Error(`Archidekt returned ${res.status}`)
    return res.json()
  }
  throw new Error('Link import needs the desktop app')
}
