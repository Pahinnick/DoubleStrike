import type { MouseEvent } from 'react'
import HealthBubble from './HealthBubble'

type Props = {
  life: number
  commanderDamage: number
  poison: number
  showCommanderDamage: boolean
  onLifeChange: (delta: number) => void
  onCommanderDamageChange: (delta: number) => void
  onPoisonChange: (delta: number) => void
}

type BubbleProps = {
  className: string
  label: string
  value: number
  onChange: (delta: number) => void
}

/** Left-click ticks up, right-click ticks down — same gesture on every bubble, just different stakes. */
function LifeBubble({ className, label, value, onChange }: BubbleProps) {
  function handleContextMenu(event: MouseEvent) {
    event.preventDefault()
    onChange(-1)
  }

  return (
    <button
      type="button"
      className={`playtest__life-bubble ${className}`}
      onClick={() => onChange(1)}
      onContextMenu={handleContextMenu}
      title={`${label}: left-click +1, right-click -1`}
      aria-label={`${label} ${value}`}
    >
      {value}
    </button>
  )
}

/** Floating life/commander-damage/poison cluster in the top-right of the battlefield, replacing the old topbar steppers. */
function LifeOverlay({ life, commanderDamage, poison, showCommanderDamage, onLifeChange, onCommanderDamageChange, onPoisonChange }: Props) {
  return (
    <div className="playtest__life-overlay">
      <HealthBubble
        wrapperClassName="playtest__life-bubble playtest__life-bubble--life"
        label="Life"
        value={life}
        onChange={onLifeChange}
      />
      {showCommanderDamage && (
        <LifeBubble
          className="playtest__life-bubble--commander"
          label="Commander damage"
          value={commanderDamage}
          onChange={onCommanderDamageChange}
        />
      )}
      <LifeBubble className="playtest__life-bubble--poison" label="Poison" value={poison} onChange={onPoisonChange} />
    </div>
  )
}

export default LifeOverlay
