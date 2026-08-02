type Props = {
  turn: number
  landsDrawn: number
  landsExpected: number
}

/** Opt-in solo-practice stat: lands actually drawn so far vs. what the deck's land ratio would
 *  predict by this turn (see PlaytestView's use of engine/castability's drawsByTurn) — a quick
 *  "am I mana-screwed or mana-flooded" read while goldfishing alone. Purely local/derived, never
 *  broadcast (it's not part of GameState — see PlaytestView's goldfishOn). */
function GoldfishPanel({ turn, landsDrawn, landsExpected }: Props) {
  const delta = landsDrawn - landsExpected
  const deltaLabel = delta > 0.05 ? `+${delta.toFixed(1)} flooded` : delta < -0.05 ? `${delta.toFixed(1)} screwed` : 'on curve'

  return (
    <div className="playtest__goldfish-panel">
      <span className="playtest__goldfish-title">Goldfish — Turn {turn}</span>
      <span className="playtest__goldfish-stat">
        Lands: {landsDrawn} drawn / {landsExpected.toFixed(1)} expected
      </span>
      <span className="playtest__goldfish-delta">{deltaLabel}</span>
    </div>
  )
}

export default GoldfishPanel
