export type GoldfishRow = { label: string; drawn: number; expected: number }

type Props = {
  turn: number
  rows: GoldfishRow[]
}

/** One small card per category — "ahead"/"behind"/"even" as a color instead of a word, since a
 *  whole sentence per category doesn't fit once there's one of these per deck category instead
 *  of just a Lands row. */
function GoldfishCard({ label, drawn, expected }: GoldfishRow) {
  const delta = drawn - expected
  const band = delta > 0.05 ? 'ahead' : delta < -0.05 ? 'behind' : 'even'
  const deltaLabel = band === 'ahead' ? `+${delta.toFixed(1)}` : band === 'behind' ? delta.toFixed(1) : '±0'

  return (
    <div className={`playtest__goldfish-card playtest__goldfish-card--${band}`}>
      <span className="playtest__goldfish-card-label">{label}</span>
      <span className="playtest__goldfish-card-count">
        {drawn}/{expected.toFixed(1)}
      </span>
      <span className="playtest__goldfish-card-delta">{deltaLabel}</span>
    </div>
  )
}

/** Opt-in solo-practice stat: how many cards of each deck category (lands, plus every
 *  user-defined category — see PlaytestView's goldfishCategoryRows) have actually been drawn so
 *  far vs. what the deck's own ratio for that category would predict by this turn (see
 *  engine/castability's drawsByTurn, the same sample-size convention the Mana Base panel's
 *  castability odds already use) — a quick "am I finding my plan's pieces on schedule" read
 *  while goldfishing alone, not just a mana-screwed/flooded check. Purely local/derived, never
 *  broadcast (it's not part of GameState — see PlaytestView's goldfishOn).
 *
 *  Split into two 3-wide grids flanking .table-radio (top-center) instead of one row: a single
 *  row of every category ran off both edges of the screen once a deck had more than a handful
 *  of categories. Capping each side at 3 columns and letting it grow downward instead keeps the
 *  whole thing on screen regardless of category count. Each side's box is bounded on both
 *  horizontal edges (see the CSS) so it can't spill behind .playtest__player-panel/
 *  .playtest__zones — an earlier version only pinned the radio-side edge and shrink-wrapped
 *  outward, which left a wide row half-covering, half-poking out past the player panel's edge. */
function GoldfishPanel({ turn, rows }: Props) {
  const splitAt = Math.ceil(rows.length / 2)
  const left = rows.slice(0, splitAt)
  const right = rows.slice(splitAt)

  return (
    <>
      <div className="playtest__goldfish-panel playtest__goldfish-panel--left">
        <span className="playtest__goldfish-title">Goldfish — Turn {turn}</span>
        {left.map((row) => (
          <GoldfishCard key={row.label} {...row} />
        ))}
      </div>
      {right.length > 0 && (
        <div className="playtest__goldfish-panel playtest__goldfish-panel--right">
          {right.map((row) => (
            <GoldfishCard key={row.label} {...row} />
          ))}
        </div>
      )}
    </>
  )
}

export default GoldfishPanel
