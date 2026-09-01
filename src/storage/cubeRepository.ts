import { del, get, keys, set } from 'idb-keyval'
import type { Cube, CubeSummary } from '../draft/types'
import { cubesStore } from './db'

/** Cubes are keyed `${profileId}::${cubeId}`, same convention as decks — profile-scoped, no
 *  separate index store (list is derived by prefix scan, same tradeoff soloGameStorage-style
 *  direct stores already accept: no Electron folder-backup parity for v1). */
function cubeKey(profileId: string, cubeId: string): string {
  return `${profileId}::${cubeId}`
}

export async function listCubes(profileId: string): Promise<CubeSummary[]> {
  const allKeys = await keys(cubesStore)
  const prefix = `${profileId}::`
  const summaries: CubeSummary[] = []
  for (const key of allKeys) {
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue
    const cube = await get<Cube>(key, cubesStore)
    if (!cube) continue
    summaries.push({
      id: cube.id,
      name: cube.name,
      cardCount: cube.cards.reduce((sum, c) => sum + c.quantity, 0),
      updatedAt: cube.updatedAt,
    })
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function loadCube(profileId: string, id: string): Promise<Cube | undefined> {
  return get<Cube>(cubeKey(profileId, id), cubesStore)
}

export async function saveCube(profileId: string, cube: Cube): Promise<void> {
  await set(cubeKey(profileId, cube.id), cube, cubesStore)
}

export async function deleteCube(profileId: string, id: string): Promise<void> {
  await del(cubeKey(profileId, id), cubesStore)
}
