/**
 * "Cards that go with this", from EDHREC's per-card pages — the right-click panel's "Highest
 * synergy" and "Most played with this card" tabs (with one source card), and able to combine
 * several cards' pages the same way.
 *
 * Every card page on EDHREC lists ~500 other cards seen in decks alongside it, each with:
 *   - lift: how much more often the pair shows up together than chance would predict — EDHREC's
 *     own synergy measure (1 = no relationship, 3 = three times as often as chance);
 *   - num_decks / potential_decks: how many decks running this card also run that one, out of
 *     those that could (colour identity).
 *
 * Given several source cards, the scores add up: "synergy" sums ln(lift) over the sources (a log
 * scale, so ×2 counts the same however it's reached — a card tied to six sources beats one tied to
 * a single source however strongly), and "played" averages the co-play rate over all of them. With
 * one source, synergy is just that pairing's ln(lift) and played its co-play rate.
 * Pure: no fetching here (see api/edhrec.ts + hooks/useCardCoplays.ts).
 */

/** One card seen alongside a deck card, trimmed to what ranking needs (it's cached per card). */
export type Coplay = {
  /** A Scryfall card id (EDHREC's `id`), resolvable straight through getCardsByIdentifiers. */
  scryfallId: string
  name: string
  lift: number
  /** Decks running the source card that also run this one. */
  numDecks: number
  /** Share of decks running the source card (that could legally play this one) that do. */
  inclusion: number
}

/** One deck card's page, ready to rank against. */
export type SynergySource = { name: string; coplays: Coplay[] }

export type SynergyCandidate = {
  scryfallId: string
  name: string
  /** Sum over your cards of ln(lift), counting only real, well-sampled pairings. */
  synergy: number
  /** Average co-play rate across every one of your cards that has data (0–1). */
  playRate: number
  /** Your cards it has a real synergy with, strongest first. */
  pairsWith: string[]
}

/** A pairing seen in fewer decks than this is too thin to call synergy — rare cards produce
 *  enormous, meaningless lifts from a handful of decks. */
export const MIN_PAIR_DECKS = 50

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The co-played cards from one EDHREC card page (`pages/cards/<slug>.json`). Entries without a
 * lift — the commander lists and grouped entries — aren't pairings and are skipped. A card can sit
 * in more than one list; the first sighting wins. Null when the payload isn't a card page.
 */
export function parseCardPageCoplays(payload: unknown): Coplay[] | null {
  if (!isRecord(payload) || !isRecord(payload.container) || !isRecord(payload.container.json_dict)) return null
  const lists = payload.container.json_dict.cardlists
  if (!Array.isArray(lists)) return null
  const seen = new Set<string>()
  const coplays: Coplay[] = []
  for (const list of lists) {
    if (!isRecord(list) || !Array.isArray(list.cardviews)) continue
    for (const view of list.cardviews) {
      if (!isRecord(view)) continue
      const { id, name, lift, num_decks: numDecks, potential_decks: potentialDecks } = view
      if (typeof id !== 'string' || typeof name !== 'string' || typeof lift !== 'number' || !Number.isFinite(lift)) continue
      if (seen.has(id)) continue
      seen.add(id)
      const decks = typeof numDecks === 'number' ? numDecks : 0
      const potential = typeof potentialDecks === 'number' ? potentialDecks : 0
      coplays.push({ scryfallId: id, name, lift, numDecks: decks, inclusion: potential > 0 ? decks / potential : 0 })
    }
  }
  return coplays
}

/** Card names compared the way EDHREC and the deck both spell them, case aside. Double-faced
 *  cards go by their front face, as EDHREC lists them. */
export function nameKey(name: string): string {
  return name.split(' // ')[0].trim().toLowerCase()
}

/**
 * Every card that turned up alongside the deck's cards, scored both ways. `exclude` holds the
 * nameKeys of cards already in the deck (and anything else not to suggest).
 */
export function rankDeckSynergy(sources: SynergySource[], exclude: ReadonlySet<string>): SynergyCandidate[] {
  type Acc = { scryfallId: string; name: string; synergy: number; inclusionSum: number; pairs: { name: string; lift: number }[] }
  const byName = new Map<string, Acc>()
  for (const source of sources) {
    for (const coplay of source.coplays) {
      const key = nameKey(coplay.name)
      if (exclude.has(key)) continue
      let acc = byName.get(key)
      if (!acc) {
        acc = { scryfallId: coplay.scryfallId, name: coplay.name, synergy: 0, inclusionSum: 0, pairs: [] }
        byName.set(key, acc)
      }
      acc.inclusionSum += coplay.inclusion
      if (coplay.lift > 1 && coplay.numDecks >= MIN_PAIR_DECKS) {
        acc.synergy += Math.log(coplay.lift)
        acc.pairs.push({ name: source.name, lift: coplay.lift })
      }
    }
  }
  const sourceCount = Math.max(1, sources.length)
  return [...byName.values()].map((acc) => ({
    scryfallId: acc.scryfallId,
    name: acc.name,
    synergy: acc.synergy,
    playRate: acc.inclusionSum / sourceCount,
    pairsWith: acc.pairs.sort((a, b) => b.lift - a.lift).map((p) => p.name),
  }))
}

/** 'synergy': strongest pairings first. 'played': most often played alongside first. */
export type SynergyMode = 'synergy' | 'played'

/** Best first for the chosen mode; the other score breaks ties. Cards with no synergy at all are
 *  left out of the synergy ranking — there's nothing to rank them on. */
export function sortSynergyCandidates(candidates: SynergyCandidate[], mode: SynergyMode): SynergyCandidate[] {
  if (mode === 'synergy') {
    return candidates.filter((c) => c.synergy > 0).sort((a, b) => b.synergy - a.synergy || b.playRate - a.playRate)
  }
  return [...candidates].sort((a, b) => b.playRate - a.playRate || b.synergy - a.synergy)
}
