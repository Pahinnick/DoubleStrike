/**
 * Tiny one-shot signal so the top-level "Multiplayer" button (deck editor header — see App.tsx)
 * can jump straight into Playtest with its Multiplayer modal already open, instead of requiring
 * "Playtest" then "Multiplayer" as two separate clicks.
 *
 * A plain localStorage flag rather than a prop threaded through PlaytestView: entering Playtest
 * can mean popping out into a whole separate dedicated-window renderer process (see
 * usePlaytestWindowMode/playtestWindowBridge), which a prop can't cross but localStorage — shared
 * across renderer windows in Electron, same as that hook's own mode preference — already does.
 * Consumed (and cleared) by PlaytestView's mount effect so it never re-fires on a later solo
 * resume that wasn't asked for.
 */
const FLAG_KEY = 'mtgdb:autoOpenMultiplayerOnPlaytestMount'

export function requestAutoOpenMultiplayer(): void {
  localStorage.setItem(FLAG_KEY, 'true')
}

/** True at most once per request — clears the flag as a side effect, so call this exactly once
 *  (PlaytestView's mount effect) rather than wherever convenient. */
export function consumeAutoOpenMultiplayerRequest(): boolean {
  const requested = localStorage.getItem(FLAG_KEY) === 'true'
  if (requested) localStorage.removeItem(FLAG_KEY)
  return requested
}
