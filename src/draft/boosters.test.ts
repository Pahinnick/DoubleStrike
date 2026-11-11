import { describe, expect, it } from 'vitest'
import type { Seat } from '../net/protocol'
import {
  bonusSetsOf,
  boosterLabelOf,
  boosterTypeFor,
  buildSetPacks,
  buildSoloSetPacks,
  hasOwnRecipe,
  makeSetBoosterPool,
  openBooster,
  packSizeOf,
  poolProblem,
  recipeFor,
  type BoosterRecipe,
  type BoosterSourceCard,
  type PickNode,
  type RecipeSlot,
  type SetBoosterPool,
} from './boosters'
import recipesJson from './data/boosterRecipes.json'
import { parseDraftCardKey } from './draftCard'
import type { BoosterType } from './types'

/** Deterministic PRNG so failures reproduce. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function cards(prefix: string, count: number, rarity: string, extra: Partial<BoosterSourceCard> = {}): BoosterSourceCard[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    name: `${prefix} card ${i}`,
    rarity,
    type_line: 'Creature — Test',
    layout: 'normal',
    collector_number: String(i + 1),
    ...extra,
  }))
}

const GAIN_LAND = { type_line: 'Land', oracle_text: 'This land enters tapped.\nWhen this land enters, you gain 1 life.\n{T}: Add {W} or {U}.' }

/** A typical modern set: 80 commons, 10 common gain lands, 100 uncommons, 60 rares, 20 mythics. */
function modernSet(setCode: string): BoosterSourceCard[] {
  return [
    ...cards('c', 80, 'common', { set: setCode }),
    ...cards('cl', 10, 'common', { ...GAIN_LAND, set: setCode }),
    ...cards('u', 100, 'uncommon', { set: setCode }),
    ...cards('r', 60, 'rare', { set: setCode }),
    ...cards('m', 20, 'mythic', { set: setCode }),
    ...cards('b', 15, 'common', { type_line: 'Basic Land — Forest', set: setCode }),
  ]
}

function poolFor(setCode: string, boosterType: BoosterType, setCards = modernSet(setCode), bonus: BoosterSourceCard[] = []): SetBoosterPool {
  return makeSetBoosterPool(setCode, boosterType, setCards, bonus)
}

/** Which bucket a key's card came from, by its test id prefix. */
function bucket(key: string): string {
  return parseDraftCardKey(key).scryfallId.replace(/\d+$/, '')
}

function openMany(pool: SetBoosterPool, n: number, seed = 1): string[][] {
  const random = seeded(seed)
  return Array.from({ length: n }, () => openBooster(pool, random))
}

/** Average count per pack of keys matching `test`. */
function perPack(packs: string[][], test: (key: string) => boolean): number {
  return packs.reduce((sum, pack) => sum + pack.filter(test).length, 0) / packs.length
}

const isFoil = (key: string) => parseDraftCardKey(key).foil
const nonFoil = (prefix: string) => (key: string) => !isFoil(key) && bucket(key) === prefix
const foilOf = (prefix: string) => (key: string) => isFoil(key) && bucket(key) === prefix

describe('boosterTypeFor', () => {
  it('splits eras at Murders at Karlov Manor and Shards of Alara', () => {
    expect(boosterTypeFor('2024-02-09')).toBe('play')
    expect(boosterTypeFor('2023-11-17')).toBe('draft')
    expect(boosterTypeFor('2008-10-03')).toBe('draft')
    expect(boosterTypeFor('2007-10-12')).toBe('classic')
  })
})

describe('recipe data', () => {
  const recipes = recipesJson as unknown as Record<string, BoosterRecipe>
  const RARITIES = new Set(['b', 'c', 'u', 'r', 'm', 's'])

  function leaves(slots: RecipeSlot[], out: PickNode[] = []): PickNode[] {
    for (const slot of slots) {
      if ('choice' in slot) slot.choice.forEach((c) => leaves(c.slots, out))
      else {
        const visit = (node: PickNode) => ('leaf' in node ? out.push(node) : node.of.forEach((o) => visit(o.n)))
        visit(slot.pick)
      }
    }
    return out
  }

  it('has a recipe for every era of set, never for products that were never draft boosters', () => {
    for (const code of ['dsk', 'fdn', 'mkm', 'neo', 'm19', 'isd', 'rav', 'lea', 'atq', '2xm', 'cmr', 'clb', 'cns']) expect(hasOwnRecipe(code)).toBe(true)
    for (const code of ['acr', 'mat', 'sum', 'mb2', 'plst']) expect(hasOwnRecipe(code)).toBe(false)
  })

  it('is well-formed: positive weights, known rarities, sensible pack sizes', () => {
    for (const [code, recipe] of Object.entries(recipes)) {
      expect(recipe.variants.length, code).toBeGreaterThan(0)
      for (const variant of recipe.variants) expect(variant.chance, code).toBeGreaterThan(0)
      for (const node of recipe.variants.flatMap((v) => leaves(v.slots))) {
        if (!('leaf' in node)) continue
        for (const r of node.leaf.r ?? []) expect(RARITIES.has(r), `${code} rarity ${r}`).toBe(true)
        // A class with no constraints at all would match any card in the set.
        expect(Object.keys(node.leaf).length, `${code} empty class`).toBeGreaterThan(0)
      }
      const size = packSizeOf(recipe)
      expect(size, code).toBeGreaterThanOrEqual(8)
      expect(size, code).toBeLessThanOrEqual(20)
    }
  })

  it('opens every pack of a set at the same size, so every drafter ends with the same pool size', () => {
    const sizes = (slots: RecipeSlot[]): Set<number> => {
      let totals = new Set([0])
      for (const slot of slots) {
        const options = 'choice' in slot ? new Set(slot.choice.flatMap((c) => [...sizes(c.slots)])) : new Set([slot.n])
        totals = new Set([...totals].flatMap((a) => [...options].map((b) => a + b)))
      }
      return totals
    }
    for (const [code, recipe] of Object.entries(recipes)) {
      const all = new Set(recipe.variants.flatMap((v) => [...sizes(v.slots)]))
      expect([...all], code).toHaveLength(1)
    }
  })

  it('describes the real products', () => {
    expect(boosterLabelOf(recipeFor('dsk', 'play'))).toBe('Play Booster')
    expect(packSizeOf(recipeFor('dsk', 'play'))).toBe(14)
    expect(boosterLabelOf(recipeFor('neo', 'draft'))).toBe('Draft Booster')
    expect(packSizeOf(recipeFor('neo', 'draft'))).toBe(15)
    expect(packSizeOf(recipeFor('cmr', 'draft'))).toBe(20)
    expect(packSizeOf(recipeFor('atq', 'classic'))).toBe(8)
  })

  it('falls back to the era template for a set newer than the data', () => {
    expect(hasOwnRecipe('zzz')).toBe(false)
    expect(packSizeOf(recipeFor('zzz', 'play'))).toBe(14)
    expect(packSizeOf(recipeFor('zzz', 'draft'))).toBe(15)
  })

  it('lists the bonus-sheet sets a recipe needs, but not Special Guests or The List', () => {
    expect(bonusSetsOf(recipeFor('tla', 'play'))).toContain('tle')
    expect(bonusSetsOf(recipeFor('stx', 'draft'))).toContain('sta')
    expect(bonusSetsOf(recipeFor('dsk', 'play'))).not.toContain('spg')
    expect(bonusSetsOf(recipeFor('mkm', 'play'))).not.toContain('plst')
  })
})

describe('Play Booster (Duskmourn recipe)', () => {
  const packs = openMany(poolFor('dsk', 'play'), 20000)

  it('always has 14 cards with exactly one foil-slot card', () => {
    for (const pack of packs.slice(0, 500)) {
      expect(pack).toHaveLength(14)
      // The foil slot, plus a foil land in about 1 pack in 5.
      expect(pack.filter(isFoil).length).toBeGreaterThanOrEqual(1)
      expect(pack.filter(isFoil).length).toBeLessThanOrEqual(2)
    }
  })

  it('puts a mythic in the rare slot 1 time in 7, and the wildcard adds more rares and uncommons', () => {
    // Rare slot (1 per pack) + wildcard (15.1% rare-or-mythic), each 6:1 rare:mythic. Tolerance is
    // ~4 standard deviations at 20,000 packs.
    expect(Math.abs(perPack(packs, nonFoil('m')) - (1 + 0.151) / 7)).toBeLessThan(0.012)
    expect(perPack(packs, nonFoil('r'))).toBeCloseTo((1 + 0.151) * (6 / 7), 1)
    // Three uncommon slots + the wildcard's 67% uncommon share.
    expect(perPack(packs, nonFoil('u'))).toBeCloseTo(3 + 671 / 1003, 1)
  })

  it('splits the foil slot 58% common / 32% uncommon / 10% rare-or-mythic', () => {
    expect(perPack(packs, foilOf('c'))).toBeCloseTo(0.58, 1)
    expect(perPack(packs, foilOf('u'))).toBeCloseTo(0.32, 1)
    expect(perPack(packs, (k) => foilOf('r')(k) || foilOf('m')(k))).toBeCloseTo(0.1, 1)
  })

  it('fills the land slot half with common duals, half with basics, foil 1 time in 5', () => {
    const lands = (k: string) => bucket(k) === 'cl' || bucket(k) === 'b'
    expect(perPack(packs, lands)).toBeCloseTo(1, 5)
    expect(perPack(packs, (k) => bucket(k) === 'cl')).toBeCloseTo(0.5, 1)
    expect(perPack(packs, (k) => lands(k) && isFoil(k))).toBeCloseTo(0.2, 1)
  })

  it('never repeats a card within a pack (apart from a foil copy)', () => {
    for (const pack of packs.slice(0, 2000)) expect(new Set(pack).size).toBe(pack.length)
  })

  it('fills the Special Guests slot with a common, since that sheet is not loaded', () => {
    expect(packs.every((pack) => pack.length === 14)).toBe(true)
  })
})

describe('Draft Booster (Core Set 2019 recipe — before foils became 1 in 3)', () => {
  const packs = openMany(poolFor('m19', 'draft'), 20000)

  it('has 15 cards, a foil in 22.5% of packs', () => {
    expect(packs.every((pack) => pack.length === 15)).toBe(true)
    expect(perPack(packs, isFoil)).toBeCloseTo(0.225, 1)
  })

  it('prints each rare twice per mythic, so mythic odds follow the set size', () => {
    // 60 rares x2 vs 20 mythics x1: 20/140 = 1 in 7.
    const rareSlot = perPack(packs, (k) => nonFoil('r')(k) || nonFoil('m')(k))
    expect(rareSlot).toBeCloseTo(1, 5)
    expect(Math.abs(perPack(packs, nonFoil('m')) - 20 / 140)).toBeLessThan(0.012)
  })
})

describe('Neon Dynasty recipe', () => {
  it('foils 1 pack in 3 and gives a gain land or basic in the land slot', () => {
    const packs = openMany(poolFor('neo', 'draft'), 9000)
    expect(perPack(packs, isFoil)).toBeCloseTo(1 / 3, 1)
    expect(perPack(packs, (k) => !isFoil(k) && (bucket(k) === 'cl' || bucket(k) === 'b'))).toBeCloseTo(1, 1)
  })
})

describe('Double Masters recipe', () => {
  it('has two rares and two foils in every pack', () => {
    const packs = openMany(poolFor('2xm', 'draft'), 2000)
    for (const pack of packs) {
      expect(pack).toHaveLength(15)
      expect(pack.filter((k) => !isFoil(k) && (bucket(k) === 'r' || bucket(k) === 'm'))).toHaveLength(2)
      expect(pack.filter(isFoil)).toHaveLength(2)
    }
  })
})

describe('Antiquities recipe (8-card pack, rares on the uncommon sheet)', () => {
  const setCards = [...cards('c', 40, 'common', { set: 'atq' }), ...cards('u', 30, 'uncommon', { set: 'atq' }), ...cards('r', 30, 'rare', { set: 'atq' })]

  it('opens 6 commons and 2 uncommon-sheet cards, each rare printed a third as often', () => {
    const packs = openMany(poolFor('atq', 'classic', setCards), 20000)
    expect(packs.every((pack) => pack.length === 8)).toBe(true)
    expect(perPack(packs, nonFoil('c'))).toBeCloseTo(6, 5)
    // Per slot: 30 rares x1 vs 30 uncommons x3 → a rare 1 time in 4.
    expect(perPack(packs, nonFoil('r'))).toBeCloseTo(2 * (30 / 120), 1)
  })
})

describe('Guilds of Ravnica recipe', () => {
  it('puts a guildgate in the land slot instead of a basic', () => {
    const gates = cards('g', 10, 'common', { type_line: 'Land — Gate', set: 'grn' })
    const packs = openMany(poolFor('grn', 'draft', [...modernSet('grn'), ...gates]), 3000)
    expect(perPack(packs, nonFoil('g'))).toBeCloseTo(1, 1)
    expect(perPack(packs, nonFoil('b'))).toBe(0)
  })
})

describe('bonus sheets', () => {
  it("draw from the companion set's numbered range (Avatar's Source Material)", () => {
    const tle = [...cards('tle', 61, 'rare', { set: 'tle' }), ...cards('tlx', 12, 'rare', { set: 'tle', collector_number: '70' })]
    const packs = openMany(poolFor('tla', 'play', modernSet('tla'), tle), 20000)
    expect(perPack(packs, (k) => bucket(k) === 'tle')).toBeGreaterThan(0.02)
    expect(perPack(packs, (k) => bucket(k) === 'tlx')).toBe(0)
    expect(packs.every((pack) => pack.length === 14)).toBe(true)
  })
})

describe('poolProblem / buildSetPacks', () => {
  it('rejects a set Scryfall has no booster data for', () => {
    const tiny = makeSetBoosterPool('tny', 'play', cards('c', 5, 'common', { set: 'tny' }))
    expect(poolProblem(tiny)).toMatch(/enough booster cards/)
    expect(() => buildSetPacks(tiny, 3, [0, 2])).toThrow(/enough booster cards/)
  })

  it('opens packsPerPlayer packs per seat, dealt by round', () => {
    const seats: Seat[] = [0, 1, 4]
    const rounds = buildSetPacks(poolFor('dsk', 'play'), 3, seats, seeded(7))
    expect(rounds).toHaveLength(3)
    for (const round of rounds) {
      expect(round.map((p) => p.holderSeat)).toEqual(seats)
      for (const pack of round) expect(pack.cards).toHaveLength(14)
    }
  })
})

describe('buildSoloSetPacks', () => {
  it('opens real boosters for the reserve, cut down to one card fewer each pick', () => {
    const { rounds, reserve } = buildSoloSetPacks(poolFor('dsk', 'play'), 3, 0, seeded(3))
    expect(rounds.map((r) => r.map((p) => p.cards.length))).toEqual([[14], [14], [14]])
    for (const round of reserve) expect(round.map((p) => p.cards.length)).toEqual(Array.from({ length: 13 }, (_, k) => 13 - k))
  })
})
