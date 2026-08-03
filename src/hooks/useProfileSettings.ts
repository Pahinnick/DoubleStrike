import { useEffect, useRef } from 'react'
import { useProfiles } from '../state/ProfileContext'
import { setSoundVolume as applySoundVolume } from '../utils/sound'
import { isTheme, LEGACY_THEME_KEY, type Theme } from './useTheme'

export type HoverPreviewMode = 'always' | 'alt'

export type ResolvedSettings = {
  theme: Theme
  hoverPreviewMode: HoverPreviewMode
  soundVolume: number
  goldfishStatsDefault: boolean
}

/** Resolves the active profile's settings (with defaults for anything unset), applies the theme
 *  to <html data-theme="..."> as a side effect, and exposes setters that persist through
 *  ProfileContext.updateSettings. Safe to call from multiple components (AppShell keeps the
 *  theme effect always-on; the Settings modal and PlaytestView call it again purely to read/write
 *  values) — the DOM effect and one-time migration below are idempotent if they happen to run
 *  from more than one mounted instance at once. */
export function useProfileSettings() {
  const { activeProfile, updateSettings } = useProfiles()
  const stored = activeProfile?.settings
  const migratedRef = useRef(false)

  // Theme lived as a single global localStorage value before settings became per-profile (see
  // useTheme's LEGACY_THEME_KEY) — fall back to reading it so an existing choice carries over
  // instead of silently resetting to 'dark' the first time a profile's own settings are read.
  const theme: Theme = isTheme(stored?.theme) ? stored.theme : isTheme(localStorage.getItem(LEGACY_THEME_KEY)) ? (localStorage.getItem(LEGACY_THEME_KEY) as Theme) : 'dark'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // One-time carryover: once the profile has its own theme.settings.theme, this never fires
  // again for that profile (the `isTheme(stored?.theme)` branch above wins instead).
  useEffect(() => {
    if (!activeProfile || isTheme(stored?.theme) || migratedRef.current) return
    migratedRef.current = true
    void updateSettings({ theme })
    // theme/updateSettings excluded on purpose: this should run once per profile becoming
    // active, not re-fire whenever the resolved theme changes for other reasons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile?.id, stored?.theme])

  const hoverPreviewMode: HoverPreviewMode = stored?.hoverPreviewMode ?? 'always'
  const soundVolume = stored?.soundVolume ?? 1
  const goldfishStatsDefault = stored?.goldfishStatsDefault ?? false

  // Global, not Playtest-specific — UI sound cues (playCue) fire from the search/deck-list views
  // too, so this needs to apply regardless of which screen is showing. AppShell keeps this
  // effect always-on the same way it does for the theme effect above.
  useEffect(() => {
    applySoundVolume(soundVolume)
  }, [soundVolume])

  return {
    theme,
    hoverPreviewMode,
    soundVolume,
    goldfishStatsDefault,
    setTheme: (next: Theme) => updateSettings({ theme: next }),
    setHoverPreviewMode: (next: HoverPreviewMode) => updateSettings({ hoverPreviewMode: next }),
    setSoundVolume: (next: number) => updateSettings({ soundVolume: next }),
    setGoldfishStatsDefault: (next: boolean) => updateSettings({ goldfishStatsDefault: next }),
  }
}
