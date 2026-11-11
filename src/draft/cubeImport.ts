import { resolveCardsByIdentifiers } from '../api/scryfall'
import type { ScryfallCard } from '../api/scryfallTypes'
import { saveSnapshots } from '../storage/cardCache'
import type { CubeCard } from './types'

export type ParsedCubeLine = { name: string; quantity: number; sourceLine: string }

const QUANTITY_PREFIX = /^(\d+)\s*x?\s+(.+)$/i

/** Parses a pasted cube list: one card per line, optional leading count ("3x Sol Ring" or
 *  "3 Sol Ring"), otherwise a bare name (quantity 1). Blank lines are ignored. */
export function parseCubeList(text: string): ParsedCubeLine[] {
  const lines: ParsedCubeLine[] = []
  for (const raw of text.split('\n')) {
    const sourceLine = raw.trim()
    if (!sourceLine) continue
    const match = sourceLine.match(QUANTITY_PREFIX)
    if (match) {
      lines.push({ name: match[2].trim(), quantity: parseInt(match[1], 10), sourceLine })
    } else {
      lines.push({ name: sourceLine, quantity: 1, sourceLine })
    }
  }
  return lines
}

export type ResolvedCubeList = {
  cards: CubeCard[]
  resolvedByName: Map<string, ScryfallCard>
  missing: ParsedCubeLine[]
}

/** Case- and accent-insensitive, so a name typed without its diacritics still matches. */
function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/** Thrown when Scryfall couldn't be reached for some of the list — as opposed to cards it
 *  looked up and didn't find, which come back in `missing`. */
export class CubeLookupError extends Error {}

/** Resolves parsed cube lines against Scryfall by name and caches the resolved cards locally,
 *  same as deck import already does. Lines that don't resolve are returned in `missing` for a
 *  fixup UI to offer suggestions on. Throws CubeLookupError if any lookup request failed: those
 *  cards aren't missing, and reporting them as "couldn't find" saved a quietly shorter cube. */
export async function resolveCubeList(lines: ParsedCubeLine[]): Promise<ResolvedCubeList> {
  // A line with a leading number is looked up both ways. "3 Sol Ring" is three Sol Rings, but
  // "1996 World Champion" and "50 Feet of Rope" are card names that start with a number, and
  // only Scryfall can say which reading is a real card.
  const names = new Set<string>()
  for (const line of lines) {
    names.add(line.name)
    if (line.sourceLine !== line.name) names.add(line.sourceLine)
  }
  const { cards: resolved, failed } = await resolveCardsByIdentifiers([...names].map((name) => ({ name })))
  if (failed.length > 0) throw new CubeLookupError('Scryfall lookup failed')

  // Keyed by full name and by front face: a double-faced card listed as "Delver of Secrets"
  // comes back named "Delver of Secrets // Insectile Aberration".
  const byName = new Map<string, ScryfallCard>()
  for (const card of resolved) {
    for (const key of [nameKey(card.name), nameKey(card.name.split(' // ')[0])]) {
      if (!byName.has(key)) byName.set(key, card)
    }
  }

  const cards: CubeCard[] = []
  const missing: ParsedCubeLine[] = []
  for (const line of lines) {
    const asCounted = byName.get(nameKey(line.name))
    const asWholeLine = line.sourceLine !== line.name ? byName.get(nameKey(line.sourceLine)) : undefined
    if (asCounted) {
      cards.push({ scryfallId: asCounted.id, quantity: line.quantity })
    } else if (asWholeLine) {
      cards.push({ scryfallId: asWholeLine.id, quantity: 1 })
    } else {
      missing.push(line)
    }
  }

  await saveSnapshots(resolved)
  return { cards, resolvedByName: byName, missing }
}
