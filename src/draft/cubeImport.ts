import { getCardsByIdentifiers } from '../api/scryfall'
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

/** Resolves parsed cube lines against Scryfall by name (case-insensitive) and caches the
 *  resolved cards locally, same as deck import already does. Lines that don't resolve are
 *  returned in `missing` for a fixup UI to offer suggestions on. */
export async function resolveCubeList(lines: ParsedCubeLine[]): Promise<ResolvedCubeList> {
  const identifiers = lines.map((l) => ({ name: l.name }))
  const resolved = await getCardsByIdentifiers(identifiers)
  const byName = new Map(resolved.map((card) => [card.name.toLowerCase(), card]))

  const cards: CubeCard[] = []
  const missing: ParsedCubeLine[] = []
  for (const line of lines) {
    const card = byName.get(line.name.toLowerCase())
    if (card) {
      cards.push({ scryfallId: card.id, quantity: line.quantity })
    } else {
      missing.push(line)
    }
  }

  await saveSnapshots(resolved)
  return { cards, resolvedByName: byName, missing }
}
