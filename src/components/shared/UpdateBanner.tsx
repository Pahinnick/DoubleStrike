import { useEffect, useState } from 'react'

/** A small "update ready" banner — appears once electron/updater.cjs finishes downloading a new
 *  version in the background, letting the user restart into it now instead of waiting for their
 *  next natural quit (autoInstallOnAppQuit already covers that path on its own, so dismissing
 *  this is safe). No-ops entirely outside Electron or in dev, where window.electronUpdater is
 *  never exposed (see registerUpdaterIpc's app.isPackaged guard). */
function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!window.electronUpdater) return
    return window.electronUpdater.onUpdateDownloaded((info) => setVersion(info.version))
  }, [])

  if (!version) return null

  return (
    <div className="update-banner">
      <span>DoubleStrike {version} is ready to install.</span>
      <button type="button" onClick={() => window.electronUpdater?.quitAndInstall()}>
        Restart to update
      </button>
      <button type="button" className="update-banner__dismiss" aria-label="Dismiss" onClick={() => setVersion(null)}>
        ✕
      </button>
    </div>
  )
}

export default UpdateBanner
