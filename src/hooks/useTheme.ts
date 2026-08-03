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

// Theme lived as a single global localStorage value before settings became per-profile — read
// once as a fallback by useProfileSettings so an existing choice carries over instead of
// silently resetting to 'dark'. See useProfileSettings' migration effect.
export const LEGACY_THEME_KEY = 'mtgdb:theme'

const THEME_IDS = THEMES.map((t) => t.id)

export function isTheme(value: string | null | undefined): value is Theme {
  return value != null && (THEME_IDS as string[]).includes(value)
}
