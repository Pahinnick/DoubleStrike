/**
 * Opens set boosters the way real packs were collated — slot by slot, with each set's own rarity
 * odds — instead of the cube approach of shuffling a list and splitting it evenly.
 *
 * Every draftable set has a "recipe" in data/boosterRecipes.json (see data/README.md for where it
 * comes from): its pack variants (e.g. "1 pack in 3 has a foil in place of a common"), and for each
 * slot a weighted mix of card classes ("rare or mythic, a rare printed twice per mythic", "a
 * common dual land or a basic", "the wildcard: 18% common / 67% uncommon / 15% rare-or-mythic").
 * Card classes are matched against the set's Scryfall cards here. A set without a recipe — one
 * released after the data was generated — gets its era's standard template (PLAY/DRAFT/CLASSIC
 * below), built from the same data.
 *
 * Pure: plain card data in (BoosterSourceCard, a structural subset of ScryfallCard) and an
 * injectable `random`, so every rule is unit-testable. Fetching a set's cards lives in setPool.ts.
 */
import type { Seat } from '../net/protocol'
import recipesJson from './data/boosterRecipes.json'
import { draftCardKey } from './draftCard'
import { buildSoloReserve, dealPacks } from './packBuilder'
import type { BoosterType, DraftPackState } from './types'

// --- recipes ------------------------------------------------------------------------------------

/** 'b' is a basic land (a rarity of its own in collation data); 's' is "special" (e.g. Time
 *  Spiral's timeshifted sheet, Commander Legends' Prismatic Piper). */
export type RarityCode = 'b' | 'c' | 'u' | 'r' | 'm' | 's'

/** Which cards a slot can hold. Every field narrows the match; an absent field doesn't. */
export type CardClass = {
  r?: RarityCode[]
  basic?: boolean
  land?: boolean
  dfc?: boolean
  legendary?: boolean
  background?: boolean
  /** Tapped dual lands that gain 1 life on entering (Khans/Ikoria/Neon Dynasty-style gain lands). */
  gainland?: boolean
  types?: string[]
  notTypes?: string[]
  kinds?: CardKind[]
  notKinds?: CardKind[]
  /** Card name contains every word (RVR's signets, DGM's Maze's End). */
  nameWords?: string[]
  /** A bonus sheet from a companion set (e.g. 'otp' Breaking News, 'tle' Avatar Source Material),
   *  optionally limited to a collector-number range. Without it, cards come from the set itself. */
  bonus?: string
  numbers?: [number, number]
}

export type CardKind = 'draft' | 'colorshifted' | 'triome' | 'shockland' | 'basictype' | 'guildgate' | 'fetchland'

/** A weighted choice. 'chance' weights are each option's share of the slot; 'rate' weights are
 *  per card (so an option's share grows with how many cards it has — e.g. rares at 2 and mythics
 *  at 1 means each rare was printed twice as often as each mythic). */
export type PickNode = { leaf: CardClass; foil?: boolean } | { mix: 'chance' | 'rate'; of: { w: number; n: PickNode }[] }

export type RecipeSlot = { n: number; pick: PickNode } | { choice: { chance: number; slots: RecipeSlot[] }[] }

export type BoosterRecipe = {
  /** Which product the recipe describes: 'play' / 'draft' boosters, or 'default' for the pre-1997
   *  boosters that predate draft-specific products. */
  kind: 'play' | 'draft' | 'default'
  variants: { chance: number; slots: RecipeSlot[] }[]
}

const RECIPES = recipesJson as unknown as Record<string, BoosterRecipe>

const leaf = (cls: CardClass, foil = false): PickNode => (foil ? { leaf: cls, foil: true } : { leaf: cls })
const chance = (...of: [number, PickNode][]): PickNode => ({ mix: 'chance', of: of.map(([w, n]) => ({ w, n })) })
const rate = (...of: [number, PickNode][]): PickNode => ({ mix: 'rate', of: of.map(([w, n]) => ({ w, n })) })
const rareMythic = (foil = false) => chance([6, leaf({ r: ['r'] }, foil)], [1, leaf({ r: ['m'] }, foil)])

/** Play Booster template (as in Bloomburrow/Duskmourn): 14 cards. */
const PLAY_TEMPLATE: BoosterRecipe = {
  kind: 'play',
  variants: [
    {
      chance: 1,
      slots: [
        {
          choice: [
            { chance: 4, slots: [{ n: 1, pick: chance([1, leaf({ basic: true })], [1, leaf({ r: ['c'], land: true })]) }] },
            { chance: 1, slots: [{ n: 1, pick: chance([1, leaf({ basic: true }, true)], [1, leaf({ r: ['c'], land: true }, true)]) }] },
          ],
        },
        { n: 7, pick: leaf({ r: ['c'], land: false }) },
        { n: 3, pick: leaf({ r: ['u'] }) },
        { n: 1, pick: rareMythic() },
        { n: 1, pick: chance([200, leaf({ r: ['c'], land: false })], [645, leaf({ r: ['u'] })], [155, rareMythic()]) },
        { n: 1, pick: chance([580, leaf({ r: ['c'], land: false }, true)], [320, leaf({ r: ['u'] }, true)], [100, rareMythic(true)]) },
      ],
    },
  ],
}

const DRAFT_FOIL = chance([12, leaf({ r: ['b', 'c'] }, true)], [5, leaf({ r: ['u'] }, true)], [3, rate([2, leaf({ r: ['r'] }, true)], [1, leaf({ r: ['m'] }, true)])])

/** Draft Booster template (Core Set 2020 onward): 15 cards, a foil in place of a common 1 pack in 3. */
const DRAFT_TEMPLATE: BoosterRecipe = {
  kind: 'draft',
  variants: [
    {
      chance: 2,
      slots: [
        { n: 1, pick: leaf({ r: ['b'] }) },
        { n: 10, pick: leaf({ r: ['c'] }) },
        { n: 3, pick: leaf({ r: ['u'] }) },
        { n: 1, pick: rate([2, leaf({ r: ['r'] })], [1, leaf({ r: ['m'] })]) },
      ],
    },
    {
      chance: 1,
      slots: [
        { n: 1, pick: leaf({ r: ['b'] }) },
        { n: 9, pick: leaf({ r: ['c'] }) },
        { n: 3, pick: leaf({ r: ['u'] }) },
        { n: 1, pick: rate([2, leaf({ r: ['r'] })], [1, leaf({ r: ['m'] })]) },
        { n: 1, pick: DRAFT_FOIL },
      ],
    },
  ],
}

/** Pre-mythic booster template: 15 cards, 1 rare, 3 uncommons, 11 commons. */
const CLASSIC_TEMPLATE: BoosterRecipe = {
  kind: 'default',
  variants: [
    {
      chance: 1,
      slots: [
        { n: 11, pick: leaf({ r: ['c'] }) },
        { n: 3, pick: leaf({ r: ['u'] }) },
        { n: 1, pick: leaf({ r: ['r'] }) },
      ],
    },
  ],
}

const TEMPLATES: Record<BoosterType, BoosterRecipe> = { play: PLAY_TEMPLATE, draft: DRAFT_TEMPLATE, classic: CLASSIC_TEMPLATE }

/** Murders at Karlov Manor — the first set sold in Play Boosters instead of Draft Boosters. */
const PLAY_BOOSTER_START = '2024-02-09'
/** Shards of Alara — introduced mythic rares and the basic-land slot. */
const MYTHIC_ERA_START = '2008-10-03'

export function boosterTypeFor(releasedAt: string): BoosterType {
  if (releasedAt >= PLAY_BOOSTER_START) return 'play'
  if (releasedAt >= MYTHIC_ERA_START) return 'draft'
  return 'classic'
}

/** The set's own recipe, or its era's template if the data predates the set. */
export function recipeFor(setCode: string, boosterType: BoosterType): BoosterRecipe {
  return RECIPES[setCode.toLowerCase()] ?? TEMPLATES[boosterType]
}

export function hasOwnRecipe(setCode: string): boolean {
  return setCode.toLowerCase() in RECIPES
}

/** Companion sets whose cards a recipe draws from (bonus sheets). The Special Guests and The List
 *  sheets are left out: they span hundreds of cards across every set for a ~1-12% slot, so packs
 *  just get the common that slot otherwise holds. */
const UNLOADED_BONUS_SETS: ReadonlySet<string> = new Set(['spg', 'plst'])

export function bonusSetsOf(recipe: BoosterRecipe): string[] {
  const codes = new Set<string>()
  const visit = (node: PickNode) => {
    if ('leaf' in node) {
      if (node.leaf.bonus && !UNLOADED_BONUS_SETS.has(node.leaf.bonus)) codes.add(node.leaf.bonus)
    } else node.of.forEach((o) => visit(o.n))
  }
  const visitSlots = (slots: RecipeSlot[]) => {
    for (const slot of slots) {
      if ('choice' in slot) slot.choice.forEach((c) => visitSlots(c.slots))
      else visit(slot.pick)
    }
  }
  recipe.variants.forEach((v) => visitSlots(v.slots))
  return [...codes].sort()
}

function slotsSize(slots: RecipeSlot[]): number {
  let total = 0
  for (const slot of slots) {
    if ('choice' in slot) {
      const sum = slot.choice.reduce((s, c) => s + c.chance, 0)
      total += slot.choice.reduce((s, c) => s + (c.chance / sum) * slotsSize(c.slots), 0)
    } else total += slot.n
  }
  return total
}

/** Cards in a typical pack of this recipe (pack variants can differ by a card or so). */
export function packSizeOf(recipe: BoosterRecipe): number {
  const sum = recipe.variants.reduce((s, v) => s + v.chance, 0)
  return Math.round(recipe.variants.reduce((s, v) => s + (v.chance / sum) * slotsSize(v.slots), 0))
}

export function boosterLabelOf(recipe: BoosterRecipe): string {
  return recipe.kind === 'play' ? 'Play Booster' : recipe.kind === 'draft' ? 'Draft Booster' : 'Booster'
}

// --- card pool ----------------------------------------------------------------------------------

/** The minimum card data booster collation needs — satisfied by ScryfallCard. */
export type BoosterSourceCard = {
  id: string
  name: string
  rarity?: string
  type_line: string
  layout: string
  set?: string
  collector_number?: string
  oracle_text?: string
  frame_effects?: string[]
  card_faces?: { oracle_text?: string; type_line?: string }[]
}

type PoolCard = {
  id: string
  set: string
  number: number | null
  r: RarityCode
  name: string
  typeLine: string
  layout: string
  oracle: string
  frameEffects: readonly string[]
}

export type SetBoosterPool = {
  setCode: string
  recipe: BoosterRecipe
  cards: readonly PoolCard[]
  /** Memo of class -> matching cards, filled as packs are opened. */
  matches: Map<string, PoolCard[]>
}

const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']

function isBasicLand(typeLine: string): boolean {
  return typeLine.includes('Basic') && typeLine.includes('Land')
}

function rarityCodeOf(card: BoosterSourceCard): RarityCode {
  if (isBasicLand(card.type_line)) return 'b'
  switch (card.rarity) {
    case 'uncommon':
      return 'u'
    case 'rare':
      return 'r'
    case 'mythic':
      return 'm'
    case 'special':
    case 'bonus':
      return 's'
    default:
      return 'c'
  }
}

function toPoolCard(card: BoosterSourceCard, fallbackSet: string): PoolCard {
  const faceText = (card.card_faces ?? []).map((f) => f.oracle_text ?? '').join('\n')
  const number = Number.parseInt(card.collector_number ?? '', 10)
  return {
    id: card.id,
    set: (card.set ?? fallbackSet).toLowerCase(),
    number: Number.isFinite(number) ? number : null,
    r: rarityCodeOf(card),
    name: card.name.toLowerCase(),
    typeLine: card.type_line,
    layout: card.layout,
    oracle: `${card.oracle_text ?? ''}\n${faceText}`,
    frameEffects: card.frame_effects ?? [],
  }
}

/** Builds the pool packs are opened from: the set's booster cards and basics, plus any bonus-sheet
 *  sets its recipe uses (see bonusSetsOf). Duplicate printings are dropped. */
export function makeSetBoosterPool(
  setCode: string,
  boosterType: BoosterType,
  cards: readonly BoosterSourceCard[],
  bonusCards: readonly BoosterSourceCard[] = [],
): SetBoosterPool {
  const code = setCode.toLowerCase()
  const seen = new Set<string>()
  const pool: PoolCard[] = []
  for (const card of [...cards, ...bonusCards]) {
    if (seen.has(card.id)) continue
    seen.add(card.id)
    pool.push(toPoolCard(card, code))
  }
  return { setCode: code, recipe: recipeFor(code, boosterType), cards: pool, matches: new Map() }
}

// --- matching -----------------------------------------------------------------------------------

const isLand = (c: PoolCard) => /\bLand\b/.test(c.typeLine)
const isDoubleFaced = (c: PoolCard) => c.layout === 'transform' || c.layout === 'modal_dfc' || c.layout === 'meld'
const basicTypesOf = (c: PoolCard) => BASIC_LAND_TYPES.filter((t) => c.typeLine.includes(t)).length
const hasType = (c: PoolCard, type: string) => new RegExp(`\\b${type}\\b`, 'i').test(c.typeLine)

function isGainland(c: PoolCard): boolean {
  return isLand(c) && c.r !== 'b' && /you gain 1 life/i.test(c.oracle) && /enters( the battlefield)? tapped/i.test(c.oracle)
}

const KIND_TESTS: Record<CardKind, (c: PoolCard) => boolean> = {
  draft: (c) => hasType(c, 'conspiracy') || /\bdraft/i.test(c.oracle),
  colorshifted: (c) => c.frameEffects.includes('colorshifted'),
  triome: (c) => isLand(c) && basicTypesOf(c) === 3,
  shockland: (c) => isLand(c) && /pay 2 life/i.test(c.oracle),
  basictype: (c) => isLand(c) && c.r !== 'b' && basicTypesOf(c) > 0,
  guildgate: (c) => isLand(c) && hasType(c, 'gate'),
  fetchland: (c) => isLand(c) && /pay 1 life, sacrifice/i.test(c.oracle),
}

function matchesClass(card: PoolCard, cls: CardClass, setCode: string): boolean {
  if (cls.bonus) {
    if (card.set !== cls.bonus) return false
    if (cls.numbers && (card.number === null || card.number < cls.numbers[0] || card.number > cls.numbers[1])) return false
  } else if (card.set !== setCode) return false
  if (cls.r && !cls.r.includes(card.r)) return false
  if (cls.basic !== undefined && (card.r === 'b') !== cls.basic) return false
  if (cls.land !== undefined && isLand(card) !== cls.land) return false
  if (cls.dfc !== undefined && isDoubleFaced(card) !== cls.dfc) return false
  if (cls.legendary !== undefined && hasType(card, 'legendary') !== cls.legendary) return false
  if (cls.background !== undefined && hasType(card, 'background') !== cls.background) return false
  if (cls.gainland !== undefined && isGainland(card) !== cls.gainland) return false
  if (cls.types && !cls.types.every((t) => hasType(card, t))) return false
  if (cls.notTypes && cls.notTypes.some((t) => hasType(card, t))) return false
  if (cls.kinds && !cls.kinds.every((k) => KIND_TESTS[k](card))) return false
  if (cls.notKinds && cls.notKinds.some((k) => KIND_TESTS[k](card))) return false
  if (cls.nameWords && !cls.nameWords.every((w) => card.name.includes(w))) return false
  return true
}

function cardsFor(pool: SetBoosterPool, cls: CardClass): PoolCard[] {
  const key = JSON.stringify(cls)
  let found = pool.matches.get(key)
  if (!found) {
    found = pool.cards.filter((card) => matchesClass(card, cls, pool.setCode))
    pool.matches.set(key, found)
  }
  return found
}

/** How many cards a node can produce — what 'rate' weights multiply. */
function nodeSize(pool: SetBoosterPool, node: PickNode): number {
  if ('leaf' in node) return cardsFor(pool, node.leaf).length
  return node.of.reduce((sum, o) => sum + nodeSize(pool, o.n), 0)
}

function weighted<T>(options: readonly { weight: number; value: T }[], random: () => number): T | null {
  const usable = options.filter((o) => o.weight > 0)
  const total = usable.reduce((sum, o) => sum + o.weight, 0)
  if (total <= 0) return null
  let roll = random() * total
  for (const o of usable) {
    roll -= o.weight
    if (roll < 0) return o.value
  }
  return usable[usable.length - 1].value
}

/** Resolves a slot's pick to one concrete card class (plus foil), skipping options the set has no
 *  cards for — e.g. a bonus sheet that isn't loaded — so their share goes to the others. */
function resolvePick(pool: SetBoosterPool, node: PickNode, random: () => number): { cls: CardClass; foil: boolean } | null {
  if ('leaf' in node) return cardsFor(pool, node.leaf).length > 0 ? { cls: node.leaf, foil: !!node.foil } : null
  const options = node.of.map((o) => {
    const size = nodeSize(pool, o.n)
    return { weight: size === 0 ? 0 : node.mix === 'rate' ? o.w * size : o.w, value: o.n }
  })
  const picked = weighted(options, random)
  return picked ? resolvePick(pool, picked, random) : null
}

// --- opening ------------------------------------------------------------------------------------

/** Why a set can't be drafted (too few cards to fill a pack), or null if it can. */
export function poolProblem(pool: SetBoosterPool): string | null {
  const own = pool.cards.filter((c) => c.set === pool.setCode)
  const count = (r: RarityCode) => own.filter((c) => c.r === r).length
  const commons = count('c')
  const uncommons = count('u')
  const rares = count('r') + count('m')
  if (commons < 8 || uncommons < 2) {
    return `Scryfall doesn't list enough booster cards for this set to open real packs (${commons} commons, ${uncommons} uncommons, ${rares} rares).`
  }
  return null
}

/** Display order once opened: rares first, then uncommons, commons, special cards, lands, foils. */
function displayRank(card: PoolCard, foil: boolean): number {
  if (foil) return 6
  switch (card.r) {
    case 'm':
    case 'r':
      return 0
    case 'u':
      return 1
    case 'c':
      return isLand(card) ? 4 : 2
    case 's':
      return 3
    case 'b':
      return 5
  }
}

const FALLBACK_COMMON: CardClass = { r: ['c'], land: false }

/** Opens one booster. Returns draft card keys (see draftCard.ts). */
export function openBooster(pool: SetBoosterPool, random: () => number = Math.random): string[] {
  const used = new Set<string>()
  const opened: { card: PoolCard; foil: boolean }[] = []

  // A real pack never has two of the same card from one print sheet, so draw without replacement
  // within a pack — allowing a repeat only if a tiny pool has run dry.
  function draw(cls: CardClass, foil: boolean): void {
    const list = cardsFor(pool, cls)
    if (list.length === 0) return
    const fresh = list.filter((c) => !used.has(draftCardKey(c.id, foil)))
    const source = fresh.length > 0 ? fresh : list
    const card = source[Math.floor(random() * source.length)]
    used.add(draftCardKey(card.id, foil))
    opened.push({ card, foil })
  }

  function fill(slots: RecipeSlot[]): void {
    for (const slot of slots) {
      if ('choice' in slot) {
        const picked = weighted(slot.choice.map((c) => ({ weight: c.chance, value: c.slots })), random)
        if (picked) fill(picked)
        continue
      }
      for (let i = 0; i < slot.n; i++) {
        const resolved = resolvePick(pool, slot.pick, random)
        // Nothing in this set fits (e.g. an unloaded bonus sheet): the slot's usual common instead.
        if (resolved) draw(resolved.cls, resolved.foil)
        else draw(cardsFor(pool, FALLBACK_COMMON).length > 0 ? FALLBACK_COMMON : { r: ['c'] }, false)
      }
    }
  }

  const variant = weighted(pool.recipe.variants.map((v) => ({ weight: v.chance, value: v })), random)
  if (variant) fill(variant.slots)
  return opened
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => displayRank(a.card, a.foil) - displayRank(b.card, b.foil) || a.index - b.index)
    .map(({ card, foil }) => draftCardKey(card.id, foil))
}

/** Opens `packsPerPlayer` boosters for every seat and deals them as `[round][seatIndex]`. */
export function buildSetPacks(
  pool: SetBoosterPool,
  packsPerPlayer: number,
  seats: readonly Seat[],
  random: () => number = Math.random,
): DraftPackState[][] {
  const problem = poolProblem(pool)
  if (problem) throw new Error(problem)
  const packs: string[][] = []
  for (let i = 0; i < packsPerPlayer * seats.length; i++) packs.push(openBooster(pool, random))
  return dealPacks(packs, packsPerPlayer, seats)
}

/** Solo set draft: the opening boosters plus the reserve packs handed over after each pick — real
 *  boosters of this set, cut down to one card fewer each time (see packBuilder's buildSoloReserve). */
export function buildSoloSetPacks(
  pool: SetBoosterPool,
  packsPerPlayer: number,
  seat: Seat,
  random: () => number = Math.random,
): { rounds: DraftPackState[][]; reserve: DraftPackState[][] } {
  const rounds = buildSetPacks(pool, packsPerPlayer, [seat], random)
  return { rounds, reserve: buildSoloReserve(rounds, () => openBooster(pool, random), random) }
}
