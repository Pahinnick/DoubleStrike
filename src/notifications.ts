/** Tiny module-level pub/sub for small dismissible warning/info banners (e.g. "Scryfall
 *  couldn't be reached") — mirrors the same "module state + subscribe callback" idiom
 *  components/shared/UpdateBanner.tsx already uses for its own update-ready flag, just
 *  generalized to a list so more than one source can post at once. No new dependency. */
export type AppNotification = {
  id: number
  kind: 'warning' | 'info'
  message: string
}

type Listener = (notifications: AppNotification[]) => void

let notifications: AppNotification[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener(notifications)
}

function push(kind: AppNotification['kind'], message: string): void {
  // Dedupe an identical message that's still showing, so a burst of retries/failures for the
  // same underlying problem doesn't stack up duplicate banners.
  if (notifications.some((n) => n.kind === kind && n.message === message)) return
  notifications = [...notifications, { id: nextId++, kind, message }]
  emit()
}

export function notifyWarning(message: string): void {
  push('warning', message)
}

export function notifyInfo(message: string): void {
  push('info', message)
}

export function dismissNotification(id: number): void {
  notifications = notifications.filter((n) => n.id !== id)
  emit()
}

/** Subscribes to the live notification list; returns an unsubscribe function. Calls
 *  `listener` immediately with the current list, same as UpdateBanner's onUpdateDownloaded. */
export function subscribeNotifications(listener: Listener): () => void {
  listeners.add(listener)
  listener(notifications)
  return () => {
    listeners.delete(listener)
  }
}
