/**
 * Regenerates src/draft/data/boosterRecipes.json — how each set's real booster was collated, at
 * rarity level — from the booster definitions in taw/magic-search-engine (MIT; the data behind
 * mtg.wtf's pack simulator, sourced from Wizards' "Collecting …" articles and pack-opening data).
 *
 * Usage (from the repo root; js-yaml is only needed for this one-off step, so it isn't a dependency):
 *   npm i --no-save js-yaml
 *   git clone --depth 1 https://github.com/taw/magic-search-engine.git ../magic-search-engine
 *   node scripts/convert-boosters.mjs ../magic-search-engine/data/boosters [setCodes.txt]
 * setCodes.txt is one code per line; without it, the sets already in boosterRecipes.json are redone.
 * (On Windows the `con` folder can't be checked out — read it with `git show` into con_draft.yaml;
 * flat `<code>_<kind>.yaml` files next to common.yaml are accepted too.)
 *
 * Showcase/borderless/alt-art tiers are collapsed: they're the same cards (and rarities) in other
 * frames, so only the rarity-level structure survives — slots, pack variants, rarity weights,
 * foils, land slots and bonus sheets. Card classes are evaluated against Scryfall data at runtime
 * (see src/draft/boosters.ts).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.cwd(), 'package.json'))
let yaml
try {
  yaml = require('js-yaml')
} catch {
  console.error('js-yaml not found — run `npm i --no-save js-yaml` first.')
  process.exit(1)
}

const OUT_FILE = path.join(process.cwd(), 'src', 'draft', 'data', 'boosterRecipes.json')
/** Never sold as draftable boosters — kept out even if a definition exists (see setPool.ts). */
const EXCLUDED = new Set(['plst', 'acr', 'mat', 'sum', 'mb2'])

const [yamlDir, setCodesFile] = process.argv.slice(2)
if (!yamlDir) {
  console.error('usage: node scripts/convert-boosters.mjs <magic-search-engine/data/boosters> [setCodes.txt]')
  process.exit(1)
}
const setCodes = setCodesFile
  ? fs.readFileSync(setCodesFile, 'utf8').split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean)
  : Object.keys(JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')))
const common = yaml.load(fs.readFileSync(path.join(yamlDir, 'common.yaml'), 'utf8'))
const unknownTokens = new Map()
const notes = []

function fileFor(code) {
  for (const kind of ['draft', 'play', 'default']) {
    for (const f of [path.join(yamlDir, code, `${kind}.yaml`), path.join(yamlDir, `${code}_${kind}.yaml`)]) {
      if (fs.existsSync(f)) return { f, kind }
    }
  }
  return null
}

// --- query -> card class -------------------------------------------------------------------
function tokenize(q) {
  const out = []
  let i = 0
  while (i < q.length) {
    if (q[i] === ' ') { i++; continue }
    let start = i
    let depth = 0
    let inQuote = false
    while (i < q.length) {
      const ch = q[i]
      if (ch === '"') inQuote = !inQuote
      else if (!inQuote && ch === '(') depth++
      else if (!inQuote && ch === ')') depth--
      else if (!inQuote && depth === 0 && ch === ' ') break
      i++
    }
    out.push(q.slice(start, i))
  }
  return out
}

const RARITY_CODES = { c: 'c', common: 'c', u: 'u', uncommon: 'u', r: 'r', rare: 'r', m: 'm', mythic: 'm', b: 'b', basic: 'b', s: 's', special: 's' }
const ORDER = ['b', 'c', 'u', 'r', 'm', 's']

function rarityToken(tok) {
  let m = tok.match(/^r(:|=|<=|>=|<|>)([a-z]+)$/i)
  if (!m) return null
  const op = m[1]
  const r = RARITY_CODES[m[2].toLowerCase()]
  if (!r) return null
  const idx = ORDER.indexOf(r)
  if (op === ':' || op === '=') return [r]
  if (op === '<=') return ORDER.slice(0, idx + 1).filter((x) => x !== 's')
  if (op === '>=') return ORDER.slice(idx)
  if (op === '<') return ORDER.slice(0, idx)
  if (op === '>') return ORDER.slice(idx + 1)
  return null
}

/** Returns a class object, or null if this query only selects showcase/special printings that
 *  can't be told apart at rarity level (to be dropped when collapsing). */
function classify(query, raw) {
  const cls = {}
  let sawRarity = false
  let showcaseOnly = false
  for (let tok of tokenize(query)) {
    let neg = false
    if (tok.startsWith('-')) { neg = true; tok = tok.slice(1) }
    if (tok === 'or') continue
    if (tok.startsWith('(') && tok.endsWith(')')) {
      const inner = tok.slice(1, -1)
      // (r:c or r:s) style unions of rarities
      const parts = inner.split(/\s+or\s+/)
      const rs = parts.map((p) => rarityToken(p.trim()))
      if (!neg && rs.every(Boolean)) {
        cls.r = [...new Set(rs.flat())]
        sawRarity = true
        continue
      }
      if (neg && /\bt:land\b/.test(inner)) { cls.land = false; continue }
      // A substituted named query, e.g. "(r:u -cid)": fold its constraints in.
      if (!neg && !/\sor\s/.test(inner) && !/promo:|frame:|number|border:|is:fullart|is:borderless|is:showcase/.test(inner)) {
        const sub = classify(inner, false)
        if (sub) {
          if (sub.r) sawRarity = true
          Object.assign(cls, mergeClass(cls, sub))
        }
        continue
      }
      if (!neg && /\bt:land\b/.test(inner)) { cls.land = true; continue }
      // showcase groupings, name lists, etc.
      if (!neg && /promo:|frame:|number|border:|is:fullart|is:borderless|is:showcase/.test(inner)) showcaseOnly = true
      continue
    }
    const rs = rarityToken(tok)
    if (rs) {
      if (neg) cls.r = (cls.r ?? ORDER).filter((x) => !rs.includes(x))
      else cls.r = cls.r ? cls.r.filter((x) => rs.includes(x)) : rs
      sawRarity = true
      continue
    }
    let m
    if ((m = tok.match(/^t:"legendary creature"$/i))) {
      cls.legendary = !neg
      if (!neg) cls.types = [...(cls.types ?? []), 'creature']
      continue
    }
    if ((m = tok.match(/^(is|not):(draft|colorshifted|triome|shockland|basictype|guildgate|fetchland|gainland)$/i))) {
      const kind = m[2].toLowerCase()
      const negated = neg !== (m[1].toLowerCase() === 'not')
      if (kind === 'gainland') cls.gainland = !negated
      else cls[negated ? 'notKinds' : 'kinds'] = [...(cls[negated ? 'notKinds' : 'kinds'] ?? []), kind]
      continue
    }
    if ((m = tok.match(/^t:"?([a-z]+)"?$/i))) {
      const t = m[1].toLowerCase()
      if (t === 'land') cls.land = !neg
      else if (t === 'basic') cls.basic = !neg
      else if (t === 'legendary') cls.legendary = !neg
      else if (t === 'background') cls.background = !neg
      else {
        cls[neg ? 'notTypes' : 'types'] = [...(cls[neg ? 'notTypes' : 'types'] ?? []), t]
      }
      continue
    }
    if ((m = tok.match(/^is:([a-z]+)$/i))) {
      const k = m[1].toLowerCase()
      if (k === 'dfc' || k === 'transform' || k === 'mdfc' || k === 'modaldfc') cls.dfc = !neg
      else if (k === 'sfc') cls.dfc = neg
      else if (k === 'gainland' || k === 'dual') cls.gainland = !neg
      else if (k === 'paper' || k === 'booster' || k === 'foilonly' || k === 'etched' || k === 'fullart' || k === 'borderless' || k === 'showcase' || k === 'extendedart' || k === 'promo') {
        if (!neg && (k === 'borderless' || k === 'showcase' || k === 'extendedart' || k === 'promo')) showcaseOnly = true
      } else unknownTokens.set(`is:${k}`, (unknownTokens.get(`is:${k}`) ?? 0) + 1)
      continue
    }
    // "cards that also have a showcase version" — a sub-tier of cards another leaf already covers.
    if (!neg && tok.startsWith('alt:')) { cls.altTier = true; continue }
    if (/^(alt|promo|frame|number|e|border|has|prints|variant|sheet|not|b):/.test(tok) || /^number[<>=]/.test(tok) || /^prints[<>=]/.test(tok)) {
      if (!neg && /^(promo|frame|number|border|variant)/.test(tok) && raw) showcaseOnly = true
      continue
    }
    // bare words = card name fragments (e.g. -terramorphic, Jin-Gitaxias). A query made only of a
    // name word (RVR's "signet") selects cards by name.
    if (/^[A-Za-z',"-]+$/.test(tok)) {
      if (!neg && /^[a-z]+$/.test(tok)) cls.nameWords = [...(cls.nameWords ?? []), tok.toLowerCase()]
      continue
    }
    unknownTokens.set(tok, (unknownTokens.get(tok) ?? 0) + 1)
  }
  // Name words only matter when nothing else describes the cards ("signet"); otherwise they're
  // exclusions/qualifiers on top of real filters.
  if (cls.nameWords?.includes('gainland')) { cls.gainland = true; delete cls.nameWords }
  if (cls.nameWords && (sawRarity || cls.kinds || cls.types || cls.land !== undefined)) delete cls.nameWords
  if (raw && showcaseOnly && !cls.basic) return null
  const structural = cls.basic !== undefined || cls.land !== undefined || cls.kinds || cls.types || cls.dfc !== undefined
  if (!sawRarity && raw && !structural) return null
  return cls
}

/** Top-level "A or B" (e.g. "r:c or r:s"): union of rarities when the parts differ only there. */
function classifyOr(query, raw) {
  const toks = tokenize(query)
  if (!toks.includes('or')) return classify(query, raw)
  const parts = []
  let cur = []
  for (const t of toks) {
    if (t === 'or') {
      parts.push(cur.join(' '))
      cur = []
    } else cur.push(t)
  }
  parts.push(cur.join(' '))
  const classes = parts.map((p) => classify(p, raw))
  if (classes.some((c) => !c)) return classify(query, raw)
  const strip = (c) => JSON.stringify({ ...c, r: undefined })
  if (classes.every((c) => strip(c) === strip(classes[0]))) {
    return { ...classes[0], r: [...new Set(classes.flatMap((c) => c.r ?? []))] }
  }
  return classify(query, raw)
}

// --- sheet resolution --------------------------------------------------------------------------
let currentSheet = ''
function resolveSheet(name, doc, depth = 0) {
  if (depth > 12) throw new Error(`sheet recursion: ${name}`)
  const def = doc.sheets?.[name] ?? common[name]
  if (!def) return { missing: name }
  const outer = currentSheet
  currentSheet = name
  try {
    return resolveDef(def, doc, depth)
  } finally {
    currentSheet = outer
  }
}

/** A bonus sheet drawn from a companion set (e.g. "e:tle number:1-61", "e:wot r:u number<64"). */
function bonusLeaf(q) {
  const e = q.match(/\be:([a-z0-9]+)\b/i)
  if (!e || e[1] === '{set}') return null
  const leaf = { bonus: e[1].toLowerCase() }
  const range = q.match(/\bnumber:(\d+)-(\d+)/)
  const lt = q.match(/\bnumber<(=?)(\d+)/)
  if (range) leaf.numbers = [Number(range[1]), Number(range[2])]
  else if (lt) leaf.numbers = [1, Number(lt[2]) - (lt[1] ? 0 : 1)]
  const rs = q.match(/(^|\s)r:([cur m])/i)
  if (rs) leaf.r = [RARITY_CODES[rs[2].toLowerCase()]]
  return leaf
}

function substitute(q, doc) {
  // Expand {query_name} references from the file's queries section (but not {set}).
  return q.replace(/\{([a-z_]+)\}/g, (all, k) => (k === 'set' ? all : doc.queries?.[k] !== undefined ? `(${doc.queries[k]})` : all))
}

function resolveDef(def, doc, depth) {
  let node
  const rawRef = def.rawquery !== undefined && String(def.rawquery).trim().match(/^\{([a-z_]+)\}$/)
  if (def.set) node = { leaf: { bonus: String(def.set).toLowerCase() } }
  else if (def.code !== undefined && def.query === undefined && def.rawquery === undefined && !def.any && !def.use) {
    // Pre-1996 print sheets. Rares in the 8-card era (no rare slot) sat on the uncommon sheet
    // printed once to an uncommon's three times; packs with a rare slot ("R") keep them apart.
    const code = String(def.code).toUpperCase()
    if (code === 'C') node = { leaf: { r: ['c'] } }
    else if (code === 'R') node = { leaf: { r: ['r'] } }
    else if (code === 'U') node = doc.pack && JSON.stringify(doc.pack).includes('"rare"') ? { leaf: { r: ['u'] } } : { mix: 'rate', of: [{ w: 3, n: { leaf: { r: ['u'] } } }, { w: 1, n: { leaf: { r: ['r'] } } }] }
    else node = null
  } else if (rawRef && /basic|land/.test(rawRef[1])) node = { leaf: { basic: true } }
  else if (def.any) {
    const hasChance = def.any.some((o) => o.chance !== undefined)
    const mode = hasChance ? 'chance' : 'rate'
    const of = []
    for (const opt of def.any) {
      const sub = resolveDef(opt, doc, depth + 1)
      if (!sub) continue
      const w = evalNum(mode === 'chance' ? opt.chance : opt.rate ?? 1)
      of.push({ w, n: sub })
    }
    node = of.length ? { mix: mode, of } : null
  } else if (def.use) node = resolveSheet(def.use, doc, depth + 1)
  else if (def.query !== undefined || def.rawquery !== undefined) {
    const raw = def.rawquery !== undefined
    const q = substitute(String(raw ? def.rawquery : def.query), doc)
    const bonus = raw ? bonusLeaf(q.replace(/[()]/g, ' ')) : null
    // A query spanning several sets' printings (e.g. ONE's praetors) isn't a bonus sheet we load.
    const multiSet = new Set((q.match(/\be:[a-z0-9{}]+/gi) ?? []).map((s) => s.toLowerCase())).size > 1
    if (bonus && !multiSet) node = { leaf: bonus }
    else {
      const cls = multiSet ? null : classifyOr(q, raw)
      const landSheet = /(basic|land|lands)$|^basic/.test(currentSheet) && !multiSet
      // Lands referenced only by collector number (EOE "e:{set} number:267-276", BLB "number:262,…").
      if (cls && Object.keys(cls).length === 0) node = landSheet ? { leaf: { basic: true } } : null // never "any card"
      else node = cls ? { leaf: cls } : raw && landSheet ? { leaf: { basic: true } } : null
    }
  } else node = null
  // A sheet-level filter (e.g. CLB's "t:background") narrows every option beneath it.
  if (node && def.filter !== undefined) {
    const f = classify(substitute(String(def.filter), doc), false)
    if (f) node = applyFilter(node, f)
  }
  if (node && (def.foil || def.etched)) node = { ...node, foil: true }
  return node
}

function mergeClass(a, b) {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (k === 'altTier') continue
    if (k === 'r') out.r = out.r ? out.r.filter((x) => v.includes(x)) : v
    else if (Array.isArray(v)) out[k] = [...new Set([...(out[k] ?? []), ...v])]
    else if (out[k] === undefined) out[k] = v
  }
  return out
}

function applyFilter(node, f) {
  if (node.leaf) return { ...node, leaf: mergeClass(node.leaf, f) }
  if (node.missing) return node
  return { ...node, of: node.of.map((o) => ({ w: o.w, n: applyFilter(o.n, f) })) }
}

function evalNum(v) {
  if (typeof v === 'number') return v
  // "59*2", "141 + 1", "47 * 2"
  const s = String(v)
  if (!/^[\d\s+*/().-]+$/.test(s)) throw new Error(`bad number ${s}`)
  return Function(`return (${s})`)()
}

// --- simplify --------------------------------------------------------------------------------
const key = (n) => JSON.stringify(n.leaf ? { l: n.leaf, f: !!n.foil } : n)

function simplify(node) {
  if (!node || node.missing) return node
  if (node.leaf) return node
  let of = node.of.map((o) => ({ w: o.w, n: simplify(o.n) })).filter((o) => o.n && !o.n.missing && o.w > 0)
  if (of.length === 0) return null
  // Showcase "has an alt version" tiers are subsets of a sibling base tier: drop them when a base
  // tier of the same rarity exists, so their looser filters (e.g. no land exclusion) don't leak in.
  if (node.mix === 'rate') {
    const sameR = (a, b) => JSON.stringify(a.r ?? null) === JSON.stringify(b.r ?? null)
    of = of.filter((o) => !(o.n.leaf?.altTier && of.some((p) => p !== o && p.n.leaf && !p.n.leaf.altTier && sameR(p.n.leaf, o.n.leaf))))
  }
  of = of.map((o) => (o.n.leaf?.altTier ? { ...o, n: { ...o.n, leaf: { ...o.n.leaf, altTier: undefined } } } : o))
  of = of.map((o) => (o.n.leaf ? { ...o, n: { ...o.n, leaf: JSON.parse(JSON.stringify(o.n.leaf)) } } : o))
  // Collapse identical children. In a rate mix, identical leaves are showcase tiers of the same
  // cards: keep the base tier's (largest) per-card rate. In a chance mix, shares add up.
  const merged = new Map()
  for (const o of of) {
    const k = key(o.n)
    const prev = merged.get(k)
    if (!prev) merged.set(k, { ...o })
    else prev.w = node.mix === 'rate' ? Math.max(prev.w, o.w) : prev.w + o.w
  }
  const list = [...merged.values()]
  const foil = node.foil
  if (list.length === 1) {
    const only = list[0].n
    return foil ? { ...only, foil: true } : only
  }
  const out = { mix: node.mix, of: list }
  if (foil) out.foil = true
  return out
}

function pushFoilDown(node, foil = false) {
  if (!node) return node
  const f = foil || !!node.foil
  if (node.leaf) {
    const { altTier: _drop, ...leaf } = node.leaf
    return f ? { leaf, foil: true } : { leaf }
  }
  return { mix: node.mix, of: node.of.map((o) => ({ w: o.w, n: pushFoilDown(o.n, f) })) }
}

// --- pack --------------------------------------------------------------------------------------
function convertSlots(map, doc, ctx) {
  const slots = []
  for (const [name, val] of Object.entries(map)) {
    if (name === 'chance') continue
    if (Array.isArray(val)) {
      // An option that lost a slot (a one-off printing, see below) would open a pack a card short —
      // and in a draft, uneven packs mean uneven pools. Drop it; its chance goes to the others.
      const options = val.map((v) => {
        const before = ctx.dropped
        const slots = convertSlots(v, doc, ctx)
        return { chance: evalNum(v.chance ?? 1), slots, lost: ctx.dropped > before }
      })
      const kept = options.filter((o) => !o.lost)
      slots.push({ choice: (kept.length > 0 ? kept : options).map(({ chance, slots: s }) => ({ chance, slots: s })) })
    } else {
      if (/token|^ad$|checklist|art_card/.test(name)) continue // not a playable card
      const node = pushFoilDown(simplify(resolveSheet(name, doc)))
      if (!node || node.missing) {
        // A one-off special printing (2X2's Cryptic Spires, a showcase-only slot): no rarity-level
        // equivalent, so the slot is left out rather than filled with something it never was.
        ctx.missing.add(name)
        ctx.dropped++
      } else slots.push({ n: evalNum(val), pick: node })
    }
  }
  return slots
}

function convert(code) {
  const found = fileFor(code)
  if (!found) return null
  const doc = yaml.load(fs.readFileSync(found.f, 'utf8'))
  const ctx = { missing: new Set(), dropped: 0 }
  const packs = doc.packs ? doc.packs.map((p) => ({ chance: 1, ...p })) : Array.isArray(doc.pack) ? doc.pack : [{ chance: 1, ...doc.pack }]
  const variants = packs.map((p) => ({ chance: evalNum(p.chance ?? 1), slots: convertSlots(p, doc, ctx) }))
  if (ctx.missing.size) notes.push(`${code}: unresolved sheets ${[...ctx.missing].join(', ')}`)
  return { kind: found.kind, variants }
}

const out = {}
const missingFiles = []
for (const code of setCodes) {
  if (EXCLUDED.has(code)) continue
  try {
    const r = convert(code)
    if (r) out[code] = r
    else missingFiles.push(code)
  } catch (err) {
    notes.push(`${code}: ERROR ${err.message}`)
  }
}
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
// One set per line keeps diffs reviewable.
fs.writeFileSync(OUT_FILE, `{\n${Object.entries(sorted).map(([c, r]) => `${JSON.stringify(c)}:${JSON.stringify(r)}`).join(',\n')}\n}\n`)
const outFile = process.env.RECIPE_DUMP ?? ''
// Optional human-readable dump for review: RECIPE_DUMP=recipes.txt
if (outFile) {
function show(n) {
  if (!n) return 'NULL'
  if (n.leaf) return `${n.foil ? 'FOIL ' : ''}${JSON.stringify(n.leaf)}`
  return `${n.foil ? 'FOIL ' : ''}${n.mix}[${n.of.map((o) => `${o.w}:${show(o.n)}`).join(' | ')}]`
}
function showSlots(slots, ind) {
  return slots.map((s) => (s.choice ? `${ind}choice:\n${s.choice.map((c) => `${ind}  @${c.chance}\n${showSlots(c.slots, ind + '    ')}`).join('\n')}` : `${ind}${s.n}x ${show(s.pick)}`)).join('\n')
}
fs.writeFileSync(outFile, Object.entries(sorted).map(([c, r]) => `### ${c} (${r.kind})\n${r.variants.map((v) => `  variant @${v.chance}\n${showSlots(v.slots, '    ')}`).join('\n')}`).join('\n\n'))
}
console.log(`converted ${Object.keys(out).length}; no definition: ${missingFiles.join(',') || 'none'}`)
console.log(notes.join('\n'))
console.log('unknown tokens:', [...unknownTokens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40))
