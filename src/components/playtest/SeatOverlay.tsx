/**
 * One row of per-seat status inside the static player panel (see PlaytestView.tsx's
 * `.playtest__player-panel`, fixed to the right edge of the screen — never moves with the
 * camera, so it never reads as part of the table). Originally this was a per-seat cluster
 * anchored to that seat's own corner of the felt, with life/poison/commander-damage as
 * circular "bubbles" pulled toward the table's center for easy at-a-glance comparison — user
 * feedback moved it twice: first because the center-of-table bubbles were in the way of
 * actual gameplay, then because *any* table-anchored position (even off to a corner) still
 * panned/zoomed with the camera and read as part of the battlefield. Now it's one fixed
 * list, and there's no reason for the stat readouts to be circles anymore — they're small
 * rounded-rect chips (StatChip) instead.
 *
 * Your own seat's life gets a couple of quick +/-10 buttons alongside the usual click/
 * right-click chip (commander life starts at 40, so big swings are common); opponents'
 * chips are read-only mirrors. Commander damage is tracked per source: your own row shows
 * one chip per opponent (whose commander could kill you at 21), while an opponent's row
 * shows just the worst single total they've taken.
 */
import type { CSSProperties, MouseEvent } from 'react'
import type { Seat } from '../../net/protocol'
import type { CardSnapshot } from '../../storage/cardCache'
import CommanderChip from './CommanderChip'
import { SEAT_COLORS } from './podLayout'

export type CommanderSource = { seat: Seat; name: string; damage: number }
export type CommanderInfo = { scryfallId: string; name: string; snapshot: CardSnapshot | undefined }

type Props = {
  /** Which seat this row represents — drives its color. */
  seat: Seat
  name: string
  life: number
  poison: number
  handCount: number
  /** Voluntarily conceded ("Scoop") — combines with life<=0 into the same "Eliminated" badge/dim
   *  treatment below (see PlaytestView's isEliminated). */
  scooped?: boolean
  /** The card(s) in this seat's command zone, if any — the command zone is public (see
   *  PublicBoard.command), so this is populated for opponents too, not just your own seat.
   *  Rendered as small hoverable thumbnails (CommanderChip). Empty/omitted for non-Commander
   *  games. */
  commanders?: CommanderInfo[]
  isSelf: boolean
  showCommanderDamage: boolean
  /** Opponent row: their worst single-source commander-damage total (read-only). */
  commanderDamage: number
  /** Your own row: per-opponent commander damage; when present, replaces the single readout. */
  commanderSources?: CommanderSource[]
  /** Opponent public-zone sizes; when `onViewZone` is given, they render as clickable chips. */
  graveyardCount?: number
  exileCount?: number
  /** True while this seat has opted in to sharing their hand contents (GameState.revealHand) —
   *  gates a "Hand n" chip alongside graveyard/exile, since handCount alone is always public
   *  but the actual cards are only viewable while this is true. */
  handRevealed?: boolean
  /** Center the camera on this seat (nameplate click). */
  onFocus?: () => void
  onLifeChange?: (delta: number) => void
  onPoisonChange?: (delta: number) => void
  onCommanderDamageFrom?: (fromSeat: number, delta: number) => void
  /** Open a read-only view of this seat's graveyard/exile/revealed-hand (pod opponents). */
  onViewZone?: (zone: 'graveyard' | 'exile' | 'hand') => void
}

type ChipProps = {
  variant: 'life' | 'poison' | 'commander'
  label: string
  value: number
  lethal?: boolean
  /** Tiny corner tag identifying a commander-damage source (e.g. "S2"). */
  sourceLabel?: string
  /** Override color (used to tint a commander-damage chip in its source's seat color). */
  color?: string
  onChange?: (delta: number) => void
}

/** One status readout: an interactive button when `onChange` is given, else a read-only mirror. */
function StatChip({ variant, label, value, lethal, sourceLabel, color, onChange }: ChipProps) {
  const className = [
    'playtest__stat-chip',
    `playtest__stat-chip--${variant}`,
    lethal ? 'is-lethal' : '',
    onChange ? '' : 'is-readonly',
  ]
    .filter(Boolean)
    .join(' ')

  // Inline color tints the chip to its source seat; lethal styling (red) must still win.
  const style = color && !lethal ? { borderColor: color, color } : undefined

  const inner = (
    <>
      {value}
      {sourceLabel && <span className="playtest__stat-chip-source">{sourceLabel}</span>}
    </>
  )

  if (!onChange) {
    return (
      <span className={className} style={style} aria-label={`${label} ${value}`} title={label}>
        {inner}
      </span>
    )
  }
  function handleContextMenu(event: MouseEvent) {
    event.preventDefault()
    onChange!(-1)
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => onChange!(1)}
      onContextMenu={handleContextMenu}
      title={`${label}: left-click +1, right-click -1`}
      aria-label={`${label} ${value}`}
    >
      {inner}
    </button>
  )
}

function SeatOverlay({
  seat,
  name,
  life,
  poison,
  handCount,
  scooped,
  commanders,
  isSelf,
  showCommanderDamage,
  commanderDamage,
  commanderSources,
  graveyardCount = 0,
  exileCount = 0,
  handRevealed = false,
  onFocus,
  onLifeChange,
  onPoisonChange,
  onCommanderDamageFrom,
  onViewZone,
}: Props) {
  const seatColor = SEAT_COLORS[seat]
  // Real Commander rules: 0 or below is out, same as a voluntary Scoop — see PlaytestView's
  // isEliminated for the same combined check used by turn rotation (handlePassTurn) and the
  // table-side quadrant scrim.
  const eliminated = life <= 0 || !!scooped

  const commanderChips = showCommanderDamage
    ? commanderSources
      ? commanderSources.map((src) => (
          <StatChip
            key={src.seat}
            variant="commander"
            label={`Commander damage from ${src.name}`}
            value={src.damage}
            lethal={src.damage >= 21}
            sourceLabel={`S${src.seat + 1}`}
            color={SEAT_COLORS[src.seat]}
            onChange={onCommanderDamageFrom ? (delta) => onCommanderDamageFrom(src.seat, delta) : undefined}
          />
        ))
      : [
          <StatChip
            key="commander"
            variant="commander"
            label="Commander damage (worst single source)"
            value={commanderDamage}
            lethal={commanderDamage >= 21}
          />,
        ]
    : []

  return (
    <div
      className={`playtest__seat-overlay ${isSelf ? 'is-self' : ''} ${eliminated ? 'is-eliminated' : ''}`}
      style={{ '--seat-color': seatColor } as CSSProperties}
    >
      <button type="button" className="playtest__seat-nameplate" onClick={onFocus} title={`Center on ${name}`}>
        <span className="playtest__seat-color-dot" />
        <span className="playtest__seat-name">{name}</span>
        {isSelf && <span className="playtest__seat-tag">You</span>}
        {eliminated && <span className="playtest__seat-tag playtest__seat-tag--eliminated">Eliminated</span>}
        <span className="playtest__seat-hand" title={`${handCount} cards in hand`}>
          🂠 {handCount}
        </span>
      </button>
      {commanders && commanders.length > 0 && (
        <span className="playtest__seat-commanders">
          {commanders.map((c) => (
            <CommanderChip key={c.scryfallId} scryfallId={c.scryfallId} name={c.name} snapshot={c.snapshot} />
          ))}
        </span>
      )}
      <div className="playtest__seat-stats">
        <div className="playtest__seat-stat-group">
          {isSelf && onLifeChange && (
            <button type="button" className="playtest__stat-step" onClick={() => onLifeChange(-10)} title="Life -10" aria-label="Life -10">
              −10
            </button>
          )}
          <StatChip variant="life" label="Life" value={life} onChange={isSelf ? onLifeChange : undefined} />
          {isSelf && onLifeChange && (
            <button type="button" className="playtest__stat-step" onClick={() => onLifeChange(10)} title="Life +10" aria-label="Life +10">
              +10
            </button>
          )}
        </div>
        <StatChip variant="poison" label="Poison" value={poison} onChange={isSelf ? onPoisonChange : undefined} />
        {commanderChips}
      </div>
      {onViewZone && (
        <div className="playtest__seat-zones">
          <button
            type="button"
            className="playtest__seat-zone"
            onClick={() => onViewZone('graveyard')}
            disabled={graveyardCount === 0}
            title="View graveyard"
          >
            GY {graveyardCount}
          </button>
          <button
            type="button"
            className="playtest__seat-zone"
            onClick={() => onViewZone('exile')}
            disabled={exileCount === 0}
            title="View exile"
          >
            EX {exileCount}
          </button>
          {handRevealed && (
            <button
              type="button"
              className="playtest__seat-zone"
              onClick={() => onViewZone('hand')}
              disabled={handCount === 0}
              title={`${name} is sharing their hand`}
            >
              Hand {handCount}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default SeatOverlay
