import { get, set } from 'idb-keyval'
import type { GameState } from '../state/gameReducer'
import { soloGameStore } from './db'

/** One deck's autosaved board — see PlaytestView's autosave effect. Covers solo AND pod play
 *  alike (only the pod's room membership itself isn't resumable, not your own board — see that
 *  effect's doc). `deckUpdatedAt` guards against resuming a save built from a decklist that's
 *  since been edited (deck.id never changes on edit, so id alone isn't enough to detect staleness). */
export type SoloGameSave = {
  state: GameState
  deckUpdatedAt: string
}

export async function getSoloGameSave(deckId: string): Promise<SoloGameSave | undefined> {
  return get<SoloGameSave>(deckId, soloGameStore)
}

export async function saveSoloGameSave(deckId: string, save: SoloGameSave): Promise<void> {
  await set(deckId, save, soloGameStore)
}
