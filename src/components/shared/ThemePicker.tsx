import { useEffect, useRef, useState } from 'react'
import { THEMES, type Theme } from '../../hooks/useTheme'
import './themePicker.css'

interface ThemePickerProps {
  theme: Theme
  onChange: (theme: Theme) => void
}

/** Header control for picking a theme: a swatch button that opens a dropdown of all
 *  themes (dark/light plus one per basic land type). Replaces the old dark/light toggle. */
export default function ThemePicker({ theme, onChange }: ThemePickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="theme-picker" ref={rootRef}>
      <button
        type="button"
        aria-label={`Theme: ${current.label}. Click to change.`}
        title={`Theme: ${current.label}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current.swatch}
      </button>
      {open && (
        <div className="theme-picker__menu" role="menu">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === theme}
              className={t.id === theme ? 'is-active' : ''}
              onClick={() => {
                onChange(t.id)
                setOpen(false)
              }}
            >
              <span className="theme-picker__swatch">{t.swatch}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
