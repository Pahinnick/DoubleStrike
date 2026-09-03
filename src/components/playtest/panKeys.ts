/** Held-key bookkeeping for the battlefield's WASD camera pan.
 *
 *  Split out of PlaytestView so the stuck-key edge cases (a release that arrives under a
 *  modifier, a release whose event.key no longer matches the press, a release that never
 *  arrives at all) can be tested without mounting the whole playtest surface.
 */

export type PanDirection = 'w' | 'a' | 's' | 'd'

/** The parts of a KeyboardEvent this cares about — so tests don't have to build real events. */
export interface PanKeyEvent {
  key: string
  code?: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

const DIRECTIONS = new Set<string>(['w', 'a', 's', 'd'])

export interface PanKeys {
  /** Records a press. Returns true only for a fresh press — an OS auto-repeat returns false,
   *  so the caller can cancel an in-flight camera glide exactly once per physical press. */
  press(event: PanKeyEvent): boolean
  release(event: PanKeyEvent): void
  clear(): void
  /** The directions currently held. Two physical keys mapped to the same direction count once,
   *  so a remapped keyboard can't pan at double speed. */
  directions(): Set<PanDirection>
  readonly size: number
}

export function createPanKeys(): PanKeys {
  // Keyed by the physical key (event.code), valued by the direction its event.key chose on the
  // way down. keydown and keyup don't always agree on event.key — hold W, then press Alt, and
  // the OS can report the release differently — but a key's code is identical on both edges, so
  // matching releases by code is what actually lets go of the pan. The direction still comes
  // from event.key, so a non-QWERTY layout pans from its own W/A/S/D characters.
  const held = new Map<string, PanDirection>()

  return {
    press(event) {
      // A modifier going down means the next click is a ping/highlight/shortcut, not camera
      // work. A pan can't *start* under a modifier, so it mustn't keep running under one
      // either: that asymmetry is what stranded the camera when you held W and Alt+clicked —
      // the release arrived while the pan was still spinning and matched nothing.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        held.clear()
        return false
      }
      const key = event.key.toLowerCase()
      if (!DIRECTIONS.has(key)) return false
      const code = event.code || key
      if (held.has(code)) return false
      held.set(code, key as PanDirection)
      return true
    },
    release(event) {
      held.delete(event.code || event.key.toLowerCase())
    },
    clear() {
      held.clear()
    },
    directions() {
      return new Set(held.values())
    },
    get size() {
      return held.size
    },
  }
}
