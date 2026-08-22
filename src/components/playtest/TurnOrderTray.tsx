import { useState } from 'react'

type TurnStep = { name: string; detail: string }
type TurnPhase = { title: string; steps: TurnStep[] }

// Standard Magic turn structure (CR 500) — the sequence of phases/steps is a game rule, not
// anyone's creative expression, so this is written independently rather than transcribed from
// any particular cheat sheet. Kept intentionally brief: this is a during-game glance, not a
// rules primer.
const TURN_PHASES: TurnPhase[] = [
  {
    title: 'Beginning Phase',
    steps: [
      { name: 'Untap', detail: 'Untap all your permanents. No one gets priority here — instants can\'t be played.' },
      { name: 'Upkeep', detail: '"At the beginning of upkeep" triggers happen, then priority is passed as normal.' },
      { name: 'Draw', detail: 'Draw a card for the turn (skipped on the very first turn of the game).' },
    ],
  },
  {
    title: 'Precombat Main Phase',
    steps: [{ name: 'Main Phase', detail: 'Play a land (once per turn) and cast creatures, sorceries, artifacts, enchantments, and planeswalkers.' }],
  },
  {
    title: 'Combat Phase',
    steps: [
      { name: 'Beginning of Combat', detail: 'Last chance for effects before attackers are locked in.' },
      { name: 'Declare Attackers', detail: 'The active player declares which creatures attack, and what they attack.' },
      { name: 'Declare Blockers', detail: 'Defending player(s) declare blocks.' },
      { name: 'Combat Damage', detail: 'First strike/double strike damage happens first, then everyone else\'s.' },
      { name: 'End of Combat', detail: 'Combat wraps up — last chance for "end of combat" triggers.' },
    ],
  },
  {
    title: 'Postcombat Main Phase',
    steps: [{ name: 'Main Phase', detail: 'Same as Precombat — play a land if you haven\'t yet, cast sorcery-speed spells.' }],
  },
  {
    title: 'End Phase',
    steps: [
      { name: 'End Step', detail: 'Last chance for instant-speed spells/abilities and "beginning of end step" triggers.' },
      { name: 'Cleanup', detail: 'Discard down to your maximum hand size, damage clears, "until end of turn" effects end.' },
    ],
  },
]

/** Slide-out left-side reference panel for Magic's turn structure — a during-game glance at
 *  what phase comes next, same tray pattern as DeckScanTray, stacked above it on the left edge.
 *  Rendered unconditionally in PlaytestView so it's available solo and in a pod alike. */
function TurnOrderTray() {
  const [open, setOpen] = useState(false)

  return (
    <div className={`playtest__turn-order-tray ${open ? 'is-open' : ''}`} onWheel={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="playtest__turn-order-tray-tab"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={open ? 'Close turn order reference' : 'Open turn order reference'}
      >
        🔁 Turn Order
      </button>
      <div className="playtest__turn-order-tray-panel">
        <div className="playtest__turn-order-tray-header">
          <h3>Turn Order</h3>
        </div>
        <div className="playtest__turn-order-tray-list">
          {TURN_PHASES.map((phase) => (
            <div key={phase.title} className="playtest__turn-order-phase">
              <h4>{phase.title}</h4>
              {phase.steps.map((step) => (
                <div key={step.name} className="playtest__turn-order-step">
                  <span className="playtest__turn-order-step-name">{step.name}</span>
                  <p>{step.detail}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default TurnOrderTray
