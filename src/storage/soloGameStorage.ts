import { get, set } from 'idb-keyval'
import type { GameState } from '../state/gameReducer'
import { soloGameStore } from './db'

/** One deck's autosaved solo game — see PlaytestView's solo-only autosave effect.
 *  `deckUpdatedAt` guards against resuming a save built from a decklist that's since been
 *  edited (deck.id never changes on edit, so id alone isn't enough to detect staleness). */
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
