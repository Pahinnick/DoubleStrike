// Filesystem-backed persistence for profiles and decks, run in the Electron main process.
//
// Everything lives under app.getPath('userData'), which survives app updates/reinstalls
// (it's separate from the install directory that gets replaced). Every deck write is also
// mirrored to a folder under the user's Documents as a standing backup, so an accidental
// delete or a corrupted userData directory doesn't lose anything.
const { app, ipcMain, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

// The app shipped as "MTG Deck Builder" before the DoubleStrike rename (2026-08-02). Electron
// derives userData from the app's *name* — but which name depends on how it's running, and that
// distinction is the whole reason this list has two entries instead of one:
//
//   - Packaged (the real installed .exe): Electron uses `build.productName`, "MTG Deck Builder".
//   - Unpackaged (`npm run electron:dev`, i.e. every day-to-day dev run): Electron ignores
//     `build.productName` entirely and falls back to the top-level package.json's own "name"
//     field, which was "claude-projects" (the very first name this project had, long before either
//     "MTG Deck Builder" or "DoubleStrike").
//
// The first migration attempt only checked the first of these and shipped believing it was the
// complete legacy story — it wasn't. Everyone whose actual usage was `electron:dev` (i.e. anyone
// who was never running an installed build) had their real profiles and decks sitting under
// "claude-projects" and got silently skipped: no error, just a fresh empty profile, which reads
// exactly like data loss even though the old folder was never touched.
//
// These constants exist purely so migrateLegacyStorage() can find the old locations; nothing else
// should reference them.
const LEGACY_APP_NAMES = ['MTG Deck Builder', 'claude-projects']
const LEGACY_BACKUP_DIR_NAME = 'MTG Deck Builder Backups'
const BACKUP_DIR_NAME = 'DoubleStrike Backups'

function storageRoot() {
  return app.getPath('userData')
}

function backupRoot() {
  return path.join(app.getPath('documents'), BACKUP_DIR_NAME)
}

function appDataFile() {
  return path.join(storageRoot(), 'app-data.json')
}

// profileId/deckId always come from crypto.randomUUID() in the renderer today, but the IPC
// boundary shouldn't rely on that staying true forever — anything reaching the preload's
// exposeInMainWorld surface is technically renderer-callable (e.g. from devtools), and this is
// the one place path traversal (a scryfallId/deckId of "../../../somewhere") could otherwise
// escape storageRoot() entirely. Reject anything that isn't a plain single path segment.
function assertSafePathSegment(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`Invalid ${label}`)
  }
}

function profileDir(profileId) {
  assertSafePathSegment(profileId, 'profileId')
  return path.join(storageRoot(), 'profiles', profileId)
}

function profileMetaFile(profileId) {
  return path.join(profileDir(profileId), 'profile.json')
}

function profileDecksDir(profileId) {
  return path.join(profileDir(profileId), 'decks')
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    if (err instanceof SyntaxError) {
      // A crash or power loss mid-write can leave a truncated/corrupted file. Previously this
      // rejected forever and the renderer had no error handling either, so the app was stuck on
      // an infinite "Loading profiles…" screen with no way to recover. Quarantine (never delete —
      // it may still be hand-recoverable) and fall back so the caller can reseed instead.
      console.error('[storage] corrupted JSON, quarantining and falling back to defaults:', file, err)
      try {
        await fs.rename(file, `${file}.corrupted-${Date.now()}`)
      } catch (renameErr) {
        console.error('[storage] failed to quarantine corrupted file', file, renameErr)
      }
      return fallback
    }
    throw err
  }
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
}

// Best-effort mirror to the backup folder — a failure here (e.g. Documents unavailable)
// must never block the real save from completing.
async function mirrorToBackup(relativePath, data) {
  try {
    await writeJson(path.join(backupRoot(), relativePath), data)
  } catch (err) {
    console.error('[storage] backup mirror failed for', relativePath, err)
  }
}

// Profile *identity* (the `profiles` list in app-data.json) and profile *data* (each profile's own
// folder under profiles/<id>/) can drift apart: app-data.json can be lost, corrupted (see readJson's
// quarantine above), or hand-edited/replaced (exactly what happened when a corrupted-file workaround
// wipes the profile list) while the actual deck folders survive untouched on disk. Recovers any such
// orphaned folder back into the profile list — never touching one the user deliberately deleted
// (tracked in `deletedProfileIds`, since deleteProfile intentionally leaves that folder on disk too).
async function recoverOrphanedProfiles(data) {
  const profilesRoot = path.join(storageRoot(), 'profiles')
  let entries
  try {
    entries = await fs.readdir(profilesRoot, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return false
    throw err
  }

  const known = new Set(data.profiles.map((p) => p.id))
  const deleted = new Set(data.deletedProfileIds ?? [])
  const orphanedIds = entries.filter((e) => e.isDirectory() && !known.has(e.name) && !deleted.has(e.name)).map((e) => e.name)
  if (orphanedIds.length === 0) return false

  console.error('[storage] recovering orphaned profile folders missing from app-data.json:', orphanedIds)
  let n = data.profiles.length + 1
  for (const id of orphanedIds) {
    data.profiles.push({ id, name: `Recovered Profile ${n}`, createdAt: new Date().toISOString() })
    n++
  }
  return true
}

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * One-time copy of the pre-rename userData and backup folders into their new DoubleStrike
 * locations. Copies rather than moves, and never deletes the originals — same "leave the old copy
 * recoverable by hand" philosophy as readJson's corrupted-file quarantine. If anything here throws
 * we log and continue: a failed migration must degrade to "looks like a fresh install with the old
 * data still safely on disk", never to a hard startup failure.
 *
 * Guarded on the absence of the NEW app-data.json, which is only sound because this runs before
 * loadAppData's own read (loadAppData seeds a default profile when it finds nothing, and that
 * would otherwise make the migration look unnecessary from the second launch onward). Tries each
 * of LEGACY_APP_NAMES in order and migrates from the first one that actually exists — on a given
 * machine at most one of them ever will, since a person was either running the packaged app or
 * running it from source, not both.
 */
let migrationPromise
async function migrateLegacyStorage() {
  const currentRoot = storageRoot()

  if (!(await pathExists(appDataFile()))) {
    for (const legacyName of LEGACY_APP_NAMES) {
      const legacyRoot = path.join(app.getPath('appData'), legacyName)
      if (legacyRoot === currentRoot || !(await pathExists(legacyRoot))) continue
      try {
        await fs.cp(legacyRoot, currentRoot, { recursive: true, force: false, errorOnExist: false })
        console.log('[storage] migrated legacy user data:', legacyRoot, '->', currentRoot)
      } catch (err) {
        console.error('[storage] legacy user-data migration failed (old data left untouched):', err)
      }
      break // Found and (attempted to) migrate one — later candidates would be red herrings.
    }
  }

  // Backups are a standing mirror rather than the source of truth, so this is best-effort too —
  // but it's the fallback someone reaches for precisely when userData went wrong, so it's worth
  // carrying across rather than stranding it under the old name.
  const currentBackups = backupRoot()
  const legacyBackups = path.join(app.getPath('documents'), LEGACY_BACKUP_DIR_NAME)
  if (legacyBackups !== currentBackups && !(await pathExists(currentBackups)) && (await pathExists(legacyBackups))) {
    try {
      await fs.cp(legacyBackups, currentBackups, { recursive: true, force: false, errorOnExist: false })
      console.log('[storage] migrated legacy backups:', legacyBackups, '->', currentBackups)
    } catch (err) {
      console.error('[storage] legacy backup migration failed (old backups left untouched):', err)
    }
  }
}

async function loadAppData() {
  // Every storage IPC funnels through here, so this is the one chokepoint that reliably runs
  // before anything reads or writes. Cached as a promise so concurrent calls share a single run.
  if (!migrationPromise) migrationPromise = migrateLegacyStorage()
  await migrationPromise

  const data = await readJson(appDataFile(), { profiles: [], defaultProfileId: null, lastActiveProfileId: null })
  const recovered = await recoverOrphanedProfiles(data)

  if (data.profiles.length === 0) {
    const profile = { id: crypto.randomUUID(), name: 'Player 1', createdAt: new Date().toISOString() }
    data.profiles.push(profile)
    data.defaultProfileId = profile.id
    data.lastActiveProfileId = profile.id
    await writeJson(appDataFile(), data)
  } else if (recovered) {
    if (!data.defaultProfileId) data.defaultProfileId = data.profiles[0].id
    if (!data.lastActiveProfileId) data.lastActiveProfileId = data.defaultProfileId
    await writeJson(appDataFile(), data)
  }
  return data
}

async function saveAppData(data) {
  await writeJson(appDataFile(), data)
}

function registerStorageIpc() {
  ipcMain.handle('storage:loadAppData', () => loadAppData())

  ipcMain.handle('storage:createProfile', async (_event, name) => {
    const data = await loadAppData()
    const profile = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }
    data.profiles.push(profile)
    await saveAppData(data)
    return profile
  })

  ipcMain.handle('storage:renameProfile', async (_event, id, name) => {
    const data = await loadAppData()
    const profile = data.profiles.find((p) => p.id === id)
    if (profile) profile.name = name
    await saveAppData(data)
  })

  ipcMain.handle('storage:deleteProfile', async (_event, id) => {
    const data = await loadAppData()
    data.profiles = data.profiles.filter((p) => p.id !== id)
    if (data.defaultProfileId === id) data.defaultProfileId = data.profiles[0]?.id ?? null
    if (data.lastActiveProfileId === id) data.lastActiveProfileId = data.defaultProfileId
    // Recorded so the next loadAppData()'s orphan-recovery scan doesn't resurrect this profile —
    // its folder is left on disk on purpose (below), which would otherwise look identical to an
    // accidentally-orphaned one.
    data.deletedProfileIds = [...new Set([...(data.deletedProfileIds ?? []), id])]
    await saveAppData(data)
    // Deck files themselves (and their backups) are left on disk — deleting a profile
    // hides its decks from the picker, it doesn't destroy the data.
  })

  ipcMain.handle('storage:setDefaultProfile', async (_event, id) => {
    const data = await loadAppData()
    data.defaultProfileId = id
    await saveAppData(data)
  })

  ipcMain.handle('storage:setActiveProfile', async (_event, id) => {
    const data = await loadAppData()
    data.lastActiveProfileId = id
    await saveAppData(data)
  })

  ipcMain.handle('storage:updateProfileSettings', async (_event, id, settings) => {
    const data = await loadAppData()
    const profile = data.profiles.find((p) => p.id === id)
    if (profile) profile.settings = settings
    await saveAppData(data)
  })

  ipcMain.handle('storage:getProfileMeta', async (_event, profileId) => {
    return readJson(profileMetaFile(profileId), { lastOpenedDeckId: null })
  })

  ipcMain.handle('storage:setLastOpenedDeckId', async (_event, profileId, deckId) => {
    await writeJson(profileMetaFile(profileId), { lastOpenedDeckId: deckId })
  })

  ipcMain.handle('storage:listDecks', async (_event, profileId) => {
    const dir = profileDecksDir(profileId)
    await ensureDir(dir)
    const files = await fs.readdir(dir)
    const decks = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const deck = await readJson(path.join(dir, file), null)
      if (deck) decks.push(deck)
    }
    return decks
  })

  ipcMain.handle('storage:loadDeck', async (_event, profileId, deckId) => {
    assertSafePathSegment(deckId, 'deckId')
    return readJson(path.join(profileDecksDir(profileId), `${deckId}.json`), undefined)
  })

  ipcMain.handle('storage:saveDeck', async (_event, profileId, deck) => {
    assertSafePathSegment(deck.id, 'deck.id')
    const decksDir = profileDecksDir(profileId) // also validates profileId
    const relative = path.relative(storageRoot(), path.join(decksDir, `${deck.id}.json`))
    await writeJson(path.join(storageRoot(), relative), deck)
    await mirrorToBackup(relative, deck)
  })

  ipcMain.handle('storage:deleteDeck', async (_event, profileId, deckId) => {
    assertSafePathSegment(deckId, 'deckId')
    await fs.rm(path.join(profileDecksDir(profileId), `${deckId}.json`), { force: true })
    // Backup copy is intentionally left in place — it's the recovery path for an
    // accidental delete, not a mirror that should track deletions too.
  })

  ipcMain.handle('storage:openDecksFolder', async (_event, profileId) => {
    const dir = profileDecksDir(profileId)
    await ensureDir(dir)
    await shell.openPath(dir)
  })

  ipcMain.handle('storage:openBackupFolder', async () => {
    await ensureDir(backupRoot())
    await shell.openPath(backupRoot())
  })

  ipcMain.handle('storage:getPaths', async (_event, profileId) => {
    return {
      decksDir: profileDecksDir(profileId),
      backupDir: backupRoot(),
    }
  })
}

module.exports = { registerStorageIpc }
