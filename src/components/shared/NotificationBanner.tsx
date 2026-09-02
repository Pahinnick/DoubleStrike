import { useEffect, useState } from 'react'
import { dismissNotification, subscribeNotifications, type AppNotification } from '../../notifications'

const AUTO_DISMISS_MS = 6000

/** Renders whatever's currently posted to notifications.ts as small stacked banners — mounted
 *  once in App.tsx, next to UpdateBanner. Auto-dismisses each after AUTO_DISMISS_MS, or sooner
 *  if the user closes it manually. */
function NotificationBanner() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  useEffect(() => subscribeNotifications(setNotifications), [])

  useEffect(() => {
    const timers = notifications.map((n) => setTimeout(() => dismissNotification(n.id), AUTO_DISMISS_MS))
    return () => timers.forEach(clearTimeout)
  }, [notifications])

  if (notifications.length === 0) return null

  return (
    <div className="notification-banner-stack">
      {notifications.map((n) => (
        <div key={n.id} className={`notification-banner notification-banner--${n.kind}`}>
          <span>{n.message}</span>
          <button type="button" className="notification-banner__dismiss" aria-label="Dismiss" onClick={() => dismissNotification(n.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

export default NotificationBanner
