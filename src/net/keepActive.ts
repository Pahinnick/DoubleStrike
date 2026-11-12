import { useEffect } from 'react'

/**
 * Keeps the desktop app's window running at full speed while it's in the background, for as long
 * as any live game connection needs it (see electron/net.cjs's net:setBackgroundActive). Counted,
 * because a draft match holds two at once — the draft and the match — and closing one mustn't
 * let the window throttle while the other is still live. A no-op in a plain browser.
 */
let holders = 0

function setActive(active: boolean) {
  void window.electronNet?.setBackgroundActive?.(active)?.catch(() => undefined)
}

/** Takes one hold; the returned function releases it (safe to call more than once). */
export function holdBackgroundActive(): () => void {
  holders += 1
  if (holders === 1) setActive(true)
  let released = false
  return () => {
    if (released) return
    released = true
    holders -= 1
    if (holders === 0) setActive(false)
  }
}

/** Holds the window awake while `active` is true (and releases it on unmount). */
export function useKeepActiveWhile(active: boolean): void {
  useEffect(() => {
    if (!active) return
    return holdBackgroundActive()
  }, [active])
}
