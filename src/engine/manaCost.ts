import { WUBRG, type Color } from '../utils/colors'

export type HybridGroup = { options: Color[]; count: number }
export type PhyrexianGroup = { color: Color; count: number }
export type TwobridGroup = { color: Color; count: number }

export type PipRequirement = {
  generic: number
  colored: Partial<Record<Color, number>>
  hybrid: HybridGroup[]
  phyrexian: PhyrexianGroup[]
  twobrid: TwobridGroup[]
}

function isColor(token: string): token is Color {
  return (WUBRG as readonly string[]).includes(token)
}

function addToGroup<T extends { count: number }>(groups: T[], match: (g: T) => boolean, make: () => T): void {
  const existing = groups.find(match)
  if (existing) {
    existing.count += 1
  } else {
    groups.push(make())
  }
}

/**
 * Parses a Scryfall mana cost string (e.g. "{2}{U}{U}") into pip counts.
 *
 * Documented simplifications:
 * - {X}/{Y}/{Z} are treated as 0 (only affects castability, not correctness
 *   of the fixed portion of the cost).
 * - {C} (colorless) and {S} (snow) fold into `generic`, since any land
 *   satisfies them.
 * - {A/P} Phyrexian mana is assumed paid via life, contributing 0 to the
 *   colored-source requirement.
 * - {2/A} "twobrid" mana is tracked as needing 1 mana of any kind, payable
 *   by color A or by generic.
 */
export function parseManaCost(manaCost: string): PipRequirement {
  const result: PipRequirement = { generic: 0, colored: {}, hybrid: [], phyrexian: [], twobrid: [] }
  const tokens = manaCost.match(/\{([^}]+)\}/g) ?? []

  for (const raw of tokens) {
    const token = raw.slice(1, -1).toUpperCase()

    if (/^\d+$/.test(token)) {
      result.generic += Number(token)
      continue
    }
    if (token === 'X' || token === 'Y' || token === 'Z') {
      continue
    }
    if (token === 'C' || token === 'S') {
      result.generic += 1
      continue
    }
    if (isColor(token)) {
      result.colored[token] = (result.colored[token] ?? 0) + 1
      continue
    }

    const parts = token.split('/')
    if (parts.length === 2) {
      const [a, b] = parts
      if (isColor(a) && isColor(b)) {
        const sorted = [a, b].sort() as Color[]
        addToGroup(
          result.hybrid,
          (g) => g.options.length === 2 && g.options[0] === sorted[0] && g.options[1] === sorted[1],
          () => ({ options: sorted, count: 1 }),
        )
        continue
      }
      if (a === '2' && isColor(b)) {
        addToGroup(
          result.twobrid,
          (g) => g.color === b,
          () => ({ color: b, count: 1 }),
        )
        continue
      }
      if (isColor(a) && b === 'P') {
        addToGroup(
          result.phyrexian,
          (g) => g.color === a,
          () => ({ color: a, count: 1 }),
        )
        continue
      }
    }
    // Unrecognized symbol shape: not expected for real card costs, ignored.
  }

  return result
}

/** Total mana that must be paid with lands/mana sources (X assumed 0, Phyrexian pips assumed paid via life). */
export function totalManaValue(req: PipRequirement): number {
  const coloredSum = Object.values(req.colored).reduce<number>((sum, n) => sum + (n ?? 0), 0)
  const hybridSum = req.hybrid.reduce((sum, g) => sum + g.count, 0)
  const twobridSum = req.twobrid.reduce((sum, g) => sum + g.count, 0)
  return req.generic + coloredSum + hybridSum + twobridSum
}

/** Distinct colors this cost requires sources for (colored + hybrid + twobrid; Phyrexian excluded per simplification). */
export function requiredColors(req: PipRequirement): Color[] {
  const colors = new Set<Color>()
  for (const color of Object.keys(req.colored) as Color[]) {
    if (req.colored[color]) colors.add(color)
  }
  for (const group of req.hybrid) {
    for (const color of group.options) colors.add(color)
  }
  for (const group of req.twobrid) {
    colors.add(group.color)
  }
  return [...colors]
}

/** Canonical string key for a PipRequirement's "shape", used to memoize castability calculations across cards. */
export function pipShapeKey(req: PipRequirement): string {
  const coloredPart = WUBRG.filter((c) => req.colored[c]).map((c) => `${c}${req.colored[c]}`).join('')
  const hybridPart = req.hybrid
    .map((g) => `H(${g.options.join('/')})${g.count}`)
    .sort()
    .join('')
  const twobridPart = req.twobrid
    .map((g) => `T${g.color}${g.count}`)
    .sort()
    .join('')
  const phyrexianPart = req.phyrexian
    .map((g) => `P${g.color}${g.count}`)
    .sort()
    .join('')
  return `g${req.generic}|${coloredPart}|${hybridPart}|${twobridPart}|${phyrexianPart}`
}
