import { createElectronAdapter } from './electronAdapter'
import { indexedDbAdapter } from './indexedDbAdapter'
import type { StorageAdapter } from './storageAdapter'

// Electron's preload script exposes window.electronStorage; a plain browser (e.g. `npm run
// dev` opened outside Electron) never gets it, so it falls back to IndexedDB. This is the
// only place that branches on which environment is running.
export const storage: StorageAdapter = window.electronStorage
  ? createElectronAdapter(window.electronStorage)
  : indexedDbAdapter
