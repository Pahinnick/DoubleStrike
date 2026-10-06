// A one-keypress diagnostic for the Playtest table (F9 — see PlaytestView).
//
// It exists for one elusive report: in a pod, a player's own hand and battlefield cards stopped
// responding to clicks and drags while everyone else could still move them. That could not be
// reproduced on demand, so instead of guessing, this captures what the page looked like at the
// moment it was stuck: what is actually under the cursor, whether the browser still thinks a drag
// is in progress, which mouse events have (and have not) been arriving, and what layers are open.
//
// Everything here only reads. Nothing in it changes game state or sends anything anywhere — the
// result goes to the clipboard for the player to paste wherever they want.

type InputEventRecord = {
  /** Milliseconds before the snapshot was taken. Filled in at snapshot time. */
  msAgo?: number
  at: number
  type: string
  target: string
  x?: number
  y?: number
  buttons?: number
  key?: string
  mods?: string
  defaultPrevented?: boolean
}

const RECORDED_EVENTS = [
  'mousedown',
  'mouseup',
  'click',
  'contextmenu',
  'dragstart',
  'dragend',
  'drop',
  'keydown',
  'keyup',
  'blur',
  'focus',
  'visibilitychange',
] as const

const MAX_EVENTS = 40

let recentEvents: InputEventRecord[] = []
let lastMouseMove: { at: number; x: number; y: number; buttons: number } | null = null
let lastDragOver: { at: number; x: number; y: number; target: string } | null = null

/** A short, stable description of an element: tag, id and classes. */
export function describeElement(el: EventTarget | Element | null): string {
  if (!(el instanceof Element)) return el === window ? 'window' : el === document ? 'document' : String(el)
  const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 4).join('.') : ''
  const label = el.getAttribute('aria-label')
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes ? `.${classes}` : ''}${label ? `[${label.slice(0, 40)}]` : ''}`
}

function modifiers(event: Event): string | undefined {
  const e = event as Partial<KeyboardEvent & MouseEvent>
  const held = [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.metaKey && 'meta'].filter(Boolean)
  return held.length > 0 ? held.join('+') : undefined
}

/**
 * Starts recording the last few input events, in the capture phase so they are seen even when a
 * handler further down stops them. Returns the function that stops recording. Kept deliberately
 * cheap: one small object per discrete event, and mousemove/dragover only overwrite a single slot.
 */
export function startInputRecording(): () => void {
  recentEvents = []
  lastMouseMove = null
  lastDragOver = null

  function record(event: Event) {
    const mouse = event as Partial<MouseEvent>
    recentEvents.push({
      at: Date.now(),
      type: event.type,
      target: describeElement(event.target),
      x: typeof mouse.clientX === 'number' ? Math.round(mouse.clientX) : undefined,
      y: typeof mouse.clientY === 'number' ? Math.round(mouse.clientY) : undefined,
      buttons: typeof mouse.buttons === 'number' ? mouse.buttons : undefined,
      key: (event as Partial<KeyboardEvent>).key,
      mods: modifiers(event),
    })
    if (recentEvents.length > MAX_EVENTS) recentEvents.shift()
  }
  function onMouseMove(event: MouseEvent) {
    lastMouseMove = { at: Date.now(), x: Math.round(event.clientX), y: Math.round(event.clientY), buttons: event.buttons }
  }
  function onDragOver(event: DragEvent) {
    lastDragOver = { at: Date.now(), x: Math.round(event.clientX), y: Math.round(event.clientY), target: describeElement(event.target) }
  }

  for (const type of RECORDED_EVENTS) window.addEventListener(type, record, true)
  window.addEventListener('mousemove', onMouseMove, true)
  window.addEventListener('dragover', onDragOver, true)
  return () => {
    for (const type of RECORDED_EVENTS) window.removeEventListener(type, record, true)
    window.removeEventListener('mousemove', onMouseMove, true)
    window.removeEventListener('dragover', onDragOver, true)
  }
}

/** Everything at a screen point, topmost first, with the styles that decide who gets the click. */
function stackAt(x: number, y: number): { el: string; pointerEvents: string; zIndex: string; position: string }[] {
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return []
  return document
    .elementsFromPoint(x, y)
    .slice(0, 8)
    .map((el) => {
      const style = getComputedStyle(el)
      return { el: describeElement(el), pointerEvents: style.pointerEvents, zIndex: style.zIndex, position: style.position }
    })
}

/** For one of the player's own cards: is the card itself what a click at its centre would hit? */
function probeCard(card: Element): { card: string; onScreen: boolean; hit: 'card' | string; draggable: string | null; disabled: boolean } {
  const rect = card.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const onScreen = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
  const top = onScreen ? document.elementFromPoint(x, y) : null
  return {
    card: describeElement(card),
    onScreen,
    hit: !onScreen ? 'offscreen' : top && (top === card || card.contains(top)) ? 'card' : describeElement(top),
    draggable: card.getAttribute('draggable'),
    disabled: (card as HTMLButtonElement).disabled === true,
  }
}

/** Elements big enough to cover most of the window that would take a click — the usual suspects
 *  for "nothing responds". The table surface itself is expected to be in this list. */
function largeInteractiveLayers(): { el: string; zIndex: string; position: string; opacity: string }[] {
  const layers: { el: string; zIndex: string; position: string; opacity: string }[] = []
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect()
    if (rect.width < window.innerWidth * 0.8 || rect.height < window.innerHeight * 0.5) continue
    const style = getComputedStyle(el)
    if (style.pointerEvents === 'none' || style.visibility === 'hidden' || style.display === 'none') continue
    if (style.position !== 'fixed' && style.position !== 'absolute') continue
    layers.push({ el: describeElement(el), zIndex: style.zIndex, position: style.position, opacity: style.opacity })
  }
  return layers.slice(0, 20)
}

/** The page-level half of the snapshot — everything that can be read straight off the DOM. */
export function buildDomSnapshot(): Record<string, unknown> {
  const now = Date.now()
  const pointer = lastMouseMove
  const ownHand = [...document.querySelectorAll('.playtest__hand-card > button.playtest-card')]
  const ownBattlefield = [...document.querySelectorAll('.playtest__battlefield-card > button.playtest-card')]
  return {
    takenAt: new Date(now).toISOString(),
    window: {
      size: [window.innerWidth, window.innerHeight],
      hasFocus: document.hasFocus(),
      visibility: document.visibilityState,
      activeElement: describeElement(document.activeElement),
      userAgent: navigator.userAgent,
    },
    pointer: pointer
      ? {
          // A large number here while the mouse is being moved means mouse events are not
          // reaching the page at all — the signature of the browser being stuck mid-drag.
          lastMouseMoveMsAgo: now - pointer.at,
          position: [pointer.x, pointer.y],
          buttonsHeld: pointer.buttons,
          stackUnderPointer: stackAt(pointer.x, pointer.y),
        }
      : 'no mousemove seen since Playtest opened',
    lastDragOver: lastDragOver ? { msAgo: now - lastDragOver.at, position: [lastDragOver.x, lastDragOver.y], target: lastDragOver.target } : null,
    recentEvents: recentEvents.map((e) => ({ ...e, msAgo: now - e.at, at: undefined })),
    dialogsOpen: [...document.querySelectorAll('[role="dialog"], [role="menu"]')].map((el) => describeElement(el)),
    largeInteractiveLayers: largeInteractiveLayers(),
    ownHandCards: ownHand.map(probeCard),
    ownBattlefieldCards: ownBattlefield.map(probeCard),
  }
}

/** Puts the snapshot on the clipboard. Resolves false if the clipboard refused it. */
export async function copySnapshot(snapshot: unknown): Promise<boolean> {
  const text = JSON.stringify(snapshot, null, 2)
  // Always left here too, so it can be fetched from the developer console if the clipboard fails.
  ;(window as unknown as { __doubleStrikeDebugSnapshot?: string }).__doubleStrikeDebugSnapshot = text
  console.info('[playtest] debug snapshot\n', text)
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
