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

function storageRoot() {
  return app.getPath('userData')
}

function backupRoot() {
  return path.join(app.getPath('documents'), 'MTG Deck Builder Backups')
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

async function loadAppData() {
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
