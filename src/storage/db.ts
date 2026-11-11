import { createStore } from 'idb-keyval'

// Decks are keyed by `${profileId}::${deckId}` here (see deckRepository.ts) now that decks
// are profile-scoped. This store predates profiles, so pre-existing entries are keyed by
// bare deckId — profileRepository.ts migrates those into the default profile on first run.
export const decksStore = createStore('mtgdb-decks', 'decks')
export const cardSnapshotsStore = createStore('mtgdb-card-snapshots', 'snapshots')
export const tagIndexStore = createStore('mtgdb-tag-index', 'tags')
export const profilesStore = createStore('mtgdb-profiles', 'profiles')
export const soloGameStore = createStore('mtgdb-solo-game', 'saves')
export const saltScoresStore = createStore('mtgdb-salt-scores', 'salt')
export const commanderPopularityStore = createStore('mtgdb-commander-popularity', 'popularity')
// EDHREC's per-commander card recommendations, keyed by commander slug. Additive store, no
// SCHEMA_VERSION bump needed.
export const edhrecRecommendationsStore = createStore('mtgdb-edhrec-recommendations', 'recommendations')
// Draft mode — saved cubes, and later a resumable in-progress draft session. Additive store, no SCHEMA_VERSION bump needed.
export const cubesStore = createStore('mtgdb-cubes', 'cubes')

export const SCHEMA_VERSION = 1
export const SCHEMA_VERSION_KEY = 'mtgdb:schemaVersion'
export const APP_DATA_KEY = 'mtgdb:appData'
// Legacy pre-profile key: the single global "last opened deck" pointer, read once during
// migration so an upgrading user reopens the same deck they last had open.
export const LEGACY_LAST_OPENED_DECK_KEY = 'mtgdb:lastOpenedDeckId'
