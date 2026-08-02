import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light' | 'plains' | 'island' | 'swamp' | 'mountain' | 'forest' | 'vaporwave'

export const THEMES: { id: Theme; label: string; swatch: string }[] = [
  { id: 'dark', label: 'Dark', swatch: '🌙' },
  { id: 'light', label: 'Light', swatch: '☀️' },
  { id: 'plains', label: 'Plains', swatch: '⚪' },
  { id: 'island', label: 'Island', swatch: '🔵' },
  { id: 'swamp', label: 'Swamp', swatch: '⚫' },
  { id: 'mountain', label: 'Mountain', swatch: '🔴' },
  { id: 'forest', label: 'Forest', swatch: '🟢' },
  { id: 'vaporwave', label: 'Vaporwave', swatch: '🌆' },
]

const THEME_KEY = 'mtgdb:theme'
const THEME_IDS = THEMES.map((t) => t.id)

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEME_IDS as string[]).includes(value)
}

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  return isTheme(stored) ? stored : 'dark'
}

/** Applies the theme to <html data-theme="..."> (see index.css's :root[data-theme="..."]
 *  override blocks) and persists the choice. Read once at module load / component mount so
 *  the theme is already correct on first paint rather than flashing dark-then-light. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(getStoredTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  return [theme, setTheme]
}
