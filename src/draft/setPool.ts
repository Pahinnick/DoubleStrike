/**
 * Fetching side of set drafts: which sets can be drafted, and loading one set's booster contents
 * from Scryfall into a SetBoosterPool (see boosters.ts for the pure collation rules).
 */
import { getAllSets, ScryfallApiError, searchAllPrints, searchCards } from '../api/scryfall'
import type { ScryfallCard, ScryfallSet } from '../api/scryfallTypes'
import { bonusSetsOf, boosterTypeFor, makeSetBoosterPool, poolProblem, recipeFor, type SetBoosterPool } from './boosters'
import type { BoosterType } from './types'

export type DraftableSet = {
  code: string
  name: string
  releasedAt: string
  setType: string
  boosterType: BoosterType
}

/** Set types that were sold in draftable boosters. Excludes commander precons, supplemental
 *  products, promos, tokens, digital-only sets and the like. */
const DRAFTABLE_SET_TYPES: ReadonlySet<string> = new Set(['core', 'expansion', 'masters', 'draft_innovation'])

/** Below this a "set" is a tiny supplemental release, not a pack you could draft. */
const MIN_SET_SIZE = 100

/** Products Scryfall files under a draftable set type that were never sold as draft boosters (or
 *  can't be opened as one): The List (a reprint sheet, not a set), Jumpstart's pre-built themed
 *  half-decks, Assassin's Creed (Beyond Boosters only), March of the Machine: The Aftermath (Set and
 *  Collector Boosters only), Summer Magic (recalled before release) and Mystery Booster 2 (its own
 *  one-of-everything sheet, which Scryfall doesn't mark as booster contents). */
const NOT_DRAFTABLE_CODES: ReadonlySet<string> = new Set(['plst', 'acr', 'mat', 'sum', 'mb2'])
const NOT_DRAFTABLE = (set: ScryfallSet) => NOT_DRAFTABLE_CODES.has(set.code) || set.name.startsWith('Jumpstart')

/** Scryfall can take months to mark which cards of a new set come in boosters; until it does, the
 *  set can't open real packs. Sets this recent get checked before they're offered. */
const RECENT_SET_DAYS = 400

/** Pure: the sets offered in the picker, newest first. Unreleased sets are left out — Scryfall
 *  lists spoiler-season sets whose booster data isn't complete yet. */
export function toDraftableSets(sets: readonly ScryfallSet[], today: string): DraftableSet[] {
  return sets
    .filter(
      (set) =>
        DRAFTABLE_SET_TYPES.has(set.set_type) &&
        !NOT_DRAFTABLE(set) &&
        !set.digital &&
        !set.parent_set_code &&
        set.card_count >= MIN_SET_SIZE &&
        set.released_at !== undefined &&
        set.released_at <= today,
    )
    .map((set) => ({
      code: set.code,
      name: set.name,
      releasedAt: set.released_at as string,
      setType: set.set_type,
      boosterType: boosterTypeFor(set.released_at as string),
    }))
    .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt))
}

/** Pure: the sets released recently enough that their booster data needs checking. */
export function recentSetCodes(sets: readonly DraftableSet[], today: string, days = RECENT_SET_DAYS): string[] {
  const cutoff = new Date(Date.parse(today) - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return sets.filter((set) => set.releasedAt >= cutoff).map((set) => set.code)
}

/** True if Scryfall lists any booster contents for this set. Errors other than "no cards" count as
 *  yes, so a network hiccup can't hide a set (choosing it still reports a clear problem). */
async function hasBoosterData(code: string): Promise<boolean> {
  try {
    const result = await searchCards(`set:${code} is:booster`)
    return (result.total_cards ?? result.data.length) > 0
  } catch (err) {
    return !(err instanceof ScryfallApiError && err.status === 404)
  }
}

let draftableSetsPromise: Promise<DraftableSet[]> | null = null

/** The picker's set list: every draftable set, minus recent ones Scryfall has no booster data for
 *  yet. Cached for the session (a failed load isn't, so it can be retried). */
export function listDraftableSets(): Promise<DraftableSet[]> {
  draftableSetsPromise ??= (async () => {
    const today = new Date().toISOString().slice(0, 10)
    const sets = toDraftableSets(await getAllSets(), today)
    const missing = new Set<string>()
    for (const code of recentSetCodes(sets, today)) {
      if (!(await hasBoosterData(code))) missing.add(code)
    }
    return sets.filter((set) => !missing.has(set.code))
  })().catch((err: unknown) => {
    draftableSetsPromise = null
    throw err
  })
  return draftableSetsPromise
}

export type LoadedSetPool = {
  pool: SetBoosterPool
  /** Every card that can show up in a pack — the host caches these locally so its own packs render
   *  instantly; guests fetch theirs on demand (see hooks/useDraftCardArt). */
  cards: ScryfallCard[]
}

/** Loads everything needed to open boosters for one set: its booster-eligible printings (Scryfall's
 *  `is:booster`), its basic lands if its packs have a land slot (some sets' basics aren't tagged as
 *  booster cards), and any bonus-sheet sets its recipe draws from (see boosters.ts). Throws with a
 *  readable message if the set can't fill a pack. */
export async function loadSetBoosterPool(set: DraftableSet): Promise<LoadedSetPool> {
  const code = set.code.toLowerCase()
  const recipe = recipeFor(code, set.boosterType)
  const boosterCards = await searchAllPrints(`set:${code} is:booster`)
  const hasBasics = boosterCards.some((card) => card.type_line.includes('Basic') && card.type_line.includes('Land'))
  const recipeText = JSON.stringify(recipe)
  const needsBasics = !hasBasics && (recipeText.includes('"basic":true') || recipeText.includes('"b"'))
  const basics = needsBasics ? await searchAllPrints(`set:${code} t:basic`) : []

  const bonusCards: ScryfallCard[] = []
  for (const bonusCode of bonusSetsOf(recipe)) bonusCards.push(...(await searchAllPrints(`set:${bonusCode}`)))

  const pool = makeSetBoosterPool(code, set.boosterType, [...boosterCards, ...basics], bonusCards)
  const problem = poolProblem(pool)
  if (problem) throw new Error(problem)
  return { pool, cards: [...boosterCards, ...basics, ...bonusCards] }
}
