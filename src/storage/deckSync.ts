// Tells this app's other windows that a deck was just written to storage.
//
// The main window and the dedicated Playtest window are two separate mounts of the app, each
// holding its own in-memory copy of the open deck and each autosaving the whole deck. Without
// this, whichever window saved last overwrote the other's edits with its stale copy — set a card
// mark in the Playtest window's tray and the cards just added in the main window were gone.
//
// BroadcastChannel reaches every same-origin window, which covers both shapes this takes: two
// Electron BrowserWindows, and the window.open() popup of the plain-browser build.

export type DeckSavedMessage = { profileId: string; deckId: string; updatedAt: string }

const CHANNEL_NAME = 'doublestrike:deck-saved'

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
}

let outbound: BroadcastChannel | null | undefined

export function announceDeckSaved(message: DeckSavedMessage): void {
  if (outbound === undefined) outbound = openChannel()
  outbound?.postMessage(message)
}

/** Calls `onSaved` for every deck another window saves. Returns the unsubscribe function. */
export function subscribeToDeckSaves(onSaved: (message: DeckSavedMessage) => void): () => void {
  // A channel never hears its own posts, but a second channel in the same window would — this one
  // is separate from `outbound` on purpose, and a window's own saves are filtered out by the
  // caller (they carry the updatedAt it already has).
  const channel = openChannel()
  if (!channel) return () => undefined
  channel.onmessage = (event: MessageEvent<DeckSavedMessage>) => onSaved(event.data)
  return () => channel.close()
}
