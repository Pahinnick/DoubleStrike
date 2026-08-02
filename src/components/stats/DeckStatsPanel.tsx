import { useMemo } from 'react'
import { computeCastabilityIndex } from '../../engine/castability'
import { computeColorPipTotals, computeManaCurve } from '../../engine/deckStats'
import { parseManaCost } from '../../engine/manaCost'
import { averageManaValue, recommendTotalLands, splitLandsByColorNeed } from '../../engine/manaRecommendation'
import { deriveManaBase, deriveRampSources, manaBaseFromOverride, withRampSources, type DeckLandInput } from '../../engine/manaSources'
import { useCardSnapshots } from '../../hooks/useCardSnapshots'
import { useSaltScores } from '../../hooks/useSaltScores'
import { useDeck } from '../../state/DeckContext'
import type { ManaBaseOverride } from '../../state/types'
import type { CardSnapshot } from '../../storage/cardCache'
import type { Color } from '../../utils/colors'
import { formatUsd, getCardUsdPrice } from '../../utils/price'
import AvgTurnTable from './AvgTurnTable'
import ColorPieChart from './ColorPieChart'
import LegalityBanner from './LegalityBanner'
import ManaBaseControls from './ManaBaseControls'
import ManaCurveChart from './ManaCurveChart'
import RampSources, { type RampEntry } from './RampSources'
import './stats.css'

type Props = {
  expanded: boolean
  onExpand: () => void
  onCollapse: () => void
}

function isLand(snapshot: CardSnapshot): boolean {
  return snapshot.type_line.includes('Land')
}

/**
 * A mana rock or mana dork: an artifact or creature that taps for mana itself (non-empty
 * produced_mana). Deliberately excludes other card types that carry produced_mana — instants/
 * sorceries are one-shot bursts (e.g. An Offer You Can't Refuse), not repeatable sources, and
 * enchantment-based ramp is rare enough to keep out of scope.
 */
function isRampSource(snapshot: CardSnapshot): boolean {
  if (isLand(snapshot) || (snapshot.produced_mana?.length ?? 0) === 0) return false
  return snapshot.type_line.includes('Artifact') || snapshot.type_line.includes('Creature')
}

function DeckStatsPanel({ expanded, onExpand, onCollapse }: Props) {
  const { deck, dispatch } = useDeck()
  // Snapshots cover every board (not just mainboard) so legality checks can
  // flag banned cards sitting in the sideboard or commander slot too.
  const allUniqueIds = useMemo(() => [...new Set(deck.cards.map((c) => c.scryfallId))], [deck.cards])
  const snapshots = useCardSnapshots(allUniqueIds)
  // Token reference cards sit on the mainboard for visibility but aren't real deck contents —
  // excluded from every stat here the same way they're excluded from legality checking.
  const mainboard = useMemo(() => deck.cards.filter((c) => c.board === 'mainboard' && !c.isToken), [deck.cards])

  const deckSize = mainboard.reduce((sum, c) => sum + c.quantity, 0)

  const priceTotal = useMemo(() => {
    let total = 0
    let priced = 0
    for (const deckCard of mainboard) {
      const snapshot = snapshots.get(deckCard.scryfallId)
      const unit = snapshot ? getCardUsdPrice(snapshot) : undefined
      if (unit === undefined) continue
      total += unit * deckCard.quantity
      priced += deckCard.quantity
    }
    return { total, priced }
  }, [mainboard, snapshots])

  const cardNames = useMemo(
    () => [...new Set(mainboard.map((c) => snapshots.get(c.scryfallId)?.name).filter((n): n is string => !!n))],
    [mainboard, snapshots],
  )
  const saltScores = useSaltScores(cardNames)
  const saltTotal = useMemo(() => {
    let total = 0
    let scored = 0
    for (const deckCard of mainboard) {
      const snapshot = snapshots.get(deckCard.scryfallId)
      const salt = snapshot ? saltScores.get(snapshot.name) : undefined
      if (salt == null) continue
      total += salt * deckCard.quantity
      scored += deckCard.quantity
    }
    return { total, scored }
  }, [mainboard, snapshots, saltScores])

  const autoManaBase = useMemo(() => {
    const lands: DeckLandInput[] = []
    for (const deckCard of mainboard) {
      const snapshot = snapshots.get(deckCard.scryfallId)
      if (snapshot && isLand(snapshot)) {
        lands.push({ quantity: deckCard.quantity, producedMana: (snapshot.produced_mana ?? []) as Color[] })
      }
    }
    return deriveManaBase(lands)
  }, [mainboard, snapshots])

  const manaBase = useMemo(() => {
    if (deck.manaBaseOverride) {
      return manaBaseFromOverride(deck.manaBaseOverride.totalLands, deck.manaBaseOverride.sourceCounts)
    }
    return autoManaBase
  }, [deck.manaBaseOverride, autoManaBase])

  const nonlandEntries = useMemo(() => {
    const entries: { deckCard: (typeof mainboard)[number]; card: CardSnapshot }[] = []
    for (const deckCard of mainboard) {
      const snapshot = snapshots.get(deckCard.scryfallId)
      if (snapshot && !isLand(snapshot)) {
        entries.push({ deckCard, card: snapshot })
      }
    }
    return entries
  }, [mainboard, snapshots])

  const rampEntries: RampEntry[] = useMemo(() => {
    const entries: RampEntry[] = []
    for (const deckCard of mainboard) {
      const snapshot = snapshots.get(deckCard.scryfallId)
      if (snapshot && isRampSource(snapshot)) {
        entries.push({
          name: snapshot.name,
          quantity: deckCard.quantity,
          manaCost: snapshot.mana_cost,
          colors: snapshot.produced_mana ?? [],
        })
      }
    }
    return entries
  }, [mainboard, snapshots])

  const rampSources = useMemo(
    () => deriveRampSources(rampEntries.map((entry) => ({ quantity: entry.quantity, producedMana: entry.colors as Color[] }))),
    [rampEntries],
  )

  // Ramp (mana rocks/dorks) is folded in for calculation purposes only — it never changes what
  // "Total lands" shows in the Mana Base section, just the Avg Turn and Suggested numbers.
  const augmentedManaBase = useMemo(() => withRampSources(manaBase, rampSources), [manaBase, rampSources])

  const castabilityIndex = useMemo(() => {
    if (deckSize === 0 || nonlandEntries.length === 0) return new Map()
    const pipRequirements = nonlandEntries.map((entry) => parseManaCost(entry.card.mana_cost))
    return computeCastabilityIndex(pipRequirements, augmentedManaBase, deckSize, true)
  }, [nonlandEntries, augmentedManaBase, deckSize])

  const manaCostEntries = useMemo(
    () => nonlandEntries.map((entry) => ({ manaCost: entry.card.mana_cost, cmc: entry.card.cmc, quantity: entry.deckCard.quantity })),
    [nonlandEntries],
  )
  const curveBuckets = useMemo(() => computeManaCurve(manaCostEntries), [manaCostEntries])
  const colorPipTotals = useMemo(() => computeColorPipTotals(manaCostEntries), [manaCostEntries])

  const recommendedTotalLands = useMemo(
    () => (deckSize === 0 ? 0 : recommendTotalLands(averageManaValue(manaCostEntries), deckSize, rampSources)),
    [manaCostEntries, deckSize, rampSources],
  )
  // The suggested total divided across colors by their share of mana symbols, so the per-color
  // numbers always add up to the total — a straight "what should my mana base look like" answer.
  const suggestedLandsByColor = useMemo(
    () => splitLandsByColorNeed(recommendedTotalLands, colorPipTotals),
    [recommendedTotalLands, colorPipTotals],
  )

  function handleOverrideChange(override: ManaBaseOverride | undefined) {
    dispatch({ type: 'SET_MANA_OVERRIDE', override })
  }

  if (!expanded) {
    return (
      <section className="app-pane stats-pane is-collapsed" aria-label="Deck statistics">
        <button type="button" className="stats-pane__tab" onClick={onExpand} aria-expanded={false}>
          <span className="stats-pane__tab-icon" aria-hidden="true">
            📊
          </span>
          <span className="stats-pane__tab-label">Stats</span>
        </button>
      </section>
    )
  }

  return (
    <section className="app-pane stats-pane" aria-label="Deck statistics">
      <div className="stats-pane__header">
        <h2>Stats</h2>
        <button type="button" className="stats-collapse-toggle" onClick={onCollapse} aria-label="Collapse stats panel">
          Collapse
        </button>
      </div>
      {deckSize === 0 ? (
        <p className="search-status">Add cards to your deck to see stats here.</p>
      ) : (
        <>
          <LegalityBanner cards={deck.cards} snapshots={snapshots} format={deck.format} />
          <div className="stats-price-salt">
            <div className="stats-price-salt__stat">
              <span className="stats-price-salt__label">Estimated price</span>
              <span className="stats-price-salt__value">{formatUsd(priceTotal.total)}</span>
              {priceTotal.priced < deckSize && (
                <span className="stats-price-salt__note">{deckSize - priceTotal.priced} without price data</span>
              )}
            </div>
            <div className="stats-price-salt__stat">
              <span className="stats-price-salt__label">Salt score</span>
              <span className="stats-price-salt__value">🧂 {saltTotal.total.toFixed(1)}</span>
              <span className="stats-price-salt__note">
                {saltTotal.scored}/{deckSize} cards scored
              </span>
            </div>
          </div>
          <div className="stats-charts">
            <div className="stats-charts__curve">
              <h3>Mana Curve</h3>
              <ManaCurveChart buckets={curveBuckets} />
            </div>
            <div className="stats-charts__pie">
              <h3>Colors</h3>
              <ColorPieChart totals={colorPipTotals} />
            </div>
          </div>
          <ManaBaseControls
            autoManaBase={autoManaBase}
            override={deck.manaBaseOverride}
            onChangeOverride={handleOverrideChange}
            recommendedTotalLands={recommendedTotalLands}
            suggestedLandsByColor={suggestedLandsByColor}
          />
          <RampSources entries={rampEntries} castabilityIndex={castabilityIndex} />
          <AvgTurnTable entries={nonlandEntries} castabilityIndex={castabilityIndex} />
        </>
      )}
    </section>
  )
}

export default DeckStatsPanel
