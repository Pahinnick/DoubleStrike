import { useState } from 'react'
import { useProfileSettings } from '../../hooks/useProfileSettings'
import ShortcutsModal from '../playtest/ShortcutsModal'
import ThemePicker from '../shared/ThemePicker'
import { useTutorialContext } from '../shared/TutorialContext'
import './settings.css'

type Props = {
  onClose: () => void
}

function SettingsModal({ onClose }: Props) {
  const { theme, setTheme, hoverPreviewMode, setHoverPreviewMode, soundVolume, setSoundVolume, goldfishStatsDefault, setGoldfishStatsDefault } =
    useProfileSettings()
  const tutorial = useTutorialContext()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Settings</h2>

        <section className="settings-modal__section">
          <h3>Theme</h3>
          <ThemePicker theme={theme} onChange={setTheme} />
        </section>

        <section className="settings-modal__section">
          <h3>Card hover preview</h3>
          <label className="settings-modal__radio-row">
            <input type="radio" name="hover-preview-mode" checked={hoverPreviewMode === 'always'} onChange={() => setHoverPreviewMode('always')} />
            Always show on hover
          </label>
          <label className="settings-modal__radio-row">
            <input type="radio" name="hover-preview-mode" checked={hoverPreviewMode === 'alt'} onChange={() => setHoverPreviewMode('alt')} />
            Hold Alt to preview (also how Alt+scroll resizes it)
          </label>
        </section>

        <section className="settings-modal__section">
          <h3>UI sound</h3>
          <label className="settings-modal__slider-row">
            <span>Sound volume</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(soundVolume * 100)}
              onChange={(event) => setSoundVolume(Number(event.target.value) / 100)}
            />
            <span className="settings-modal__slider-value">{Math.round(soundVolume * 100)}%</span>
          </label>
          <p className="settings-modal__hint">
            Hover/tap/draw/shuffle cues everywhere in the app, not the table radio — that has its own volume slider in the radio panel.
          </p>
        </section>

        <section className="settings-modal__section">
          <h3>Playtest</h3>
          <label className="settings-modal__checkbox-row">
            <input type="checkbox" checked={goldfishStatsDefault} onChange={(event) => setGoldfishStatsDefault(event.target.checked)} />
            Show goldfish practice stats by default
          </label>
        </section>

        <section className="settings-modal__section">
          <h3>Keybinds</h3>
          <button type="button" onClick={() => setShortcutsOpen(true)}>
            View keyboard/mouse shortcuts
          </button>
        </section>

        <section className="settings-modal__section">
          <h3>Help</h3>
          <button
            type="button"
            onClick={() => {
              tutorial.start()
              onClose()
            }}
          >
            Replay Tour
          </button>
        </section>

        <section className="settings-modal__section">
          <h3>About</h3>
          <p className="settings-modal__hint">DoubleStrike v{__APP_VERSION__}</p>
        </section>

        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}

export default SettingsModal
