/**
 * Just enough to walk back into a draft after the tab refreshes or the app restarts: the room
 * code, and the player id the host knows this seat by (the host hands a returning player id its
 * old seat, packs and pool — see DraftResumeMessage). Kept in localStorage rather than
 * sessionStorage so an app restart counts too. Guests only: if the host's own app goes away,
 * so does the draft.
 */
const STORAGE_KEY = 'mtgdb:draft:rejoin'

/** A draft long since abandoned shouldn't keep offering itself. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000

export type SavedDraftRejoin = { roomCode: string; playerId: string; name: string; savedAt: number }

export function saveDraftRejoin(rejoin: Omit<SavedDraftRejoin, 'savedAt'>, now = Date.now()): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rejoin, savedAt: now }))
  } catch {
    // Storage blocked or full — rejoining after a refresh just won't be offered.
  }
}

export function loadDraftRejoin(now = Date.now()): SavedDraftRejoin | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<SavedDraftRejoin>
    const valid =
      typeof saved.roomCode === 'string' &&
      saved.roomCode !== '' &&
      typeof saved.playerId === 'string' &&
      saved.playerId !== '' &&
      typeof saved.savedAt === 'number' &&
      now - saved.savedAt < MAX_AGE_MS
    if (!valid) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return { roomCode: saved.roomCode as string, playerId: saved.playerId as string, name: saved.name ?? '', savedAt: saved.savedAt as number }
  } catch {
    return null
  }
}

export function clearDraftRejoin(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
