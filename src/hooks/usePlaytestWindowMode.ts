import { useEffect, useState } from 'react'

export type PlaytestWindowMode = 'window' | 'inline'

const MODE_KEY = 'mtgdb:playtestWindowMode'

function isMode(value: string | null): value is PlaytestWindowMode {
  return value === 'window' || value === 'inline'
}

/** Read fresh from storage rather than through the hook below — for the one-off "which way
 *  should this click open Playtest" check in App.tsx, which doesn't itself render the toggle
 *  and would otherwise risk acting on a stale value if the preference was last changed from
 *  the *other* window (main vs. the dedicated Playtest window are separate renderer
 *  processes, each with their own React state, though they do share localStorage). */
export function getPlaytestWindowMode(): PlaytestWindowMode {
  const stored = localStorage.getItem(MODE_KEY)
  return isMode(stored) ? stored : 'inline'
}

/** Whether clicking "Playtest" swaps the board in place inside the current window (default —
 *  works with just one monitor) or pops it out into its own OS window (better for a
 *  multi-monitor player who wants the deck editor and board visible side by side). Persisted
 *  like useTheme; takes effect the next time Playtest is opened, not retroactively on an
 *  already-open one. */
export function usePlaytestWindowMode(): [PlaytestWindowMode, (mode: PlaytestWindowMode) => void] {
  const [mode, setMode] = useState<PlaytestWindowMode>(getPlaytestWindowMode)

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode)
  }, [mode])

  return [mode, setMode]
}
