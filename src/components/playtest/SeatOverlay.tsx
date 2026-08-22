/**
 * One card of per-seat status inside the static player panel (see PlaytestView.tsx's
 * `.playtest__player-panel`, fixed to the left edge of the screen — never moves with the
 * camera, so it never reads as part of the table). Originally this was a per-seat cluster
 * anchored to that seat's own corner of the felt, with life/poison/commander-damage as
 * circular "bubbles" pulled toward the table's center for easy at-a-glance comparison — user
 * feedback moved it twice: first because the center-of-table bubbles were in the way of
 * actual gameplay, then because *any* table-anchored position (even off to a corner) still
 * panned/zoomed with the camera and read as part of the battlefield. It's since gone through
 * a third pass: the tiny unlabeled circular chips this became (readable only via a hover
 * tooltip, and prone to overlapping corner badges once a second/third commander-damage source
 * showed up) read as cluttered and cramped — life is now a real fillable bar (HealthBar,
 * closer to what most VTTs/game UIs use, with the exact number always shown as text, never
 * just implied by the fill), and poison/commander-damage are labeled pills (StatPill) that
 * wrap normally as a plain flex row instead of needing careful corner-overlay positioning.
 *
 * Your own seat's life gets a couple of quick +/-10 buttons overlaid on the bar itself alongside
 * the usual click/right-click gesture (commander life starts at 40, so big swings are common);
 * opponents' bars/pills are read-only mirrors. Commander damage is public per-source information
 * at a real table (everyone can see whose commander hit whom), so every card — not just your
 * own — shows one pill per source that's dealt it damage; each pill is tagged with a solid dot
 * in that source's own seat color (see podLayout's SEAT_COLORS) rather than text, since a text
 * label ("Cmdr", or a source tag like "S2") either didn't say whose commander it was or ran too
 * long for a small pill.
 *
 * Also used, alone, as solo play's own life display (replacing the old floating circular
 * bubble cluster — see PlaytestView.tsx's `!inPod` branch) so solo and pod share one visual
 * language instead of solo looking like a different app. Solo has no real opponent seat to
 * attribute commander damage to, so it passes `soloCommanderDamage` instead of
 * `commanderSources` — see that prop's doc comment.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Seat } from '../../net/protocol'
import { SOLO_CMDR_SOURCE } from '../../state/gameReducer'
import type { CardSnapshot } from '../../storage/cardCache'
import { useChangeLog } from '../../hooks/useChangeLog'
import type { ManaColorKey } from '../../utils/colors'
import CommanderChip from './CommanderChip'
import ManaPool from './ManaPool'
import { SEAT_COLORS } from './podLayout'

export type CommanderSource = { seat: Seat; name: string; damage: number }
export type CommanderInfo = { scryfallId: string; name: string; snapshot: CardSnapshot | undefined }

/** Commander's usual starting life — the fallback when an opponent's board doesn't carry its
 *  own (see PublicBoard.startingLife), e.g. an older sender that predates the field. */
const DEFAULT_STARTING_LIFE = 40

type Props = {
  /** Which seat this row represents — drives its color. */
  seat: Seat
  name: string
  life: number
  /** Reference point the life bar fills against — see PublicBoard.startingLife. Falls back to
   *  the Commander default (40) when absent (self always has it from GameState). */
  startingLife?: number
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
  /** Every source that's dealt this seat commander damage — a dot pill per entry (see the file
   *  doc comment). Your own card includes every opponent even at 0 (a click target to start
   *  tracking from); an opponent's card is sparse, only sources actually above 0. Ignored when
   *  `soloCommanderDamage` is given instead. */
  commanderSources?: CommanderSource[]
  /** Solo play's alternative to `commanderSources`: there's no real opponent seat to attribute
   *  damage to (see gameReducer's SOLO_CMDR_SOURCE), so this renders as a single plain labeled
   *  pill instead of a per-source color dot. */
  soloCommanderDamage?: { value: number; onChange?: (delta: number) => void }
  /** Opponent public-zone sizes; when `onViewZone` is given, they render as clickable chips. */
  graveyardCount?: number
  exileCount?: number
  /** True while this seat has opted in to sharing their hand contents (GameState.revealHand) —
   *  gates a "Hand n" chip alongside graveyard/exile, since handCount alone is always public
   *  but the actual cards are only viewable while this is true. */
  handRevealed?: boolean
  /** Mana currently floating on this seat's board — public like life/poison (see
   *  PublicBoard.floatingMana). Sparse: only nonzero colors are guaranteed present. */
  floatingMana?: Partial<Record<ManaColorKey, number>>
  /** Center the camera on this seat (nameplate click). */
  onFocus?: () => void
  onLifeChange?: (delta: number) => void
  onPoisonChange?: (delta: number) => void
  onCommanderDamageFrom?: (fromSeat: number, delta: number) => void
  onFloatingManaChange?: (color: ManaColorKey, delta: number) => void
  onClearFloatingMana?: () => void
  /** Open a read-only view of this seat's graveyard/exile/revealed-hand (pod opponents). */
  onViewZone?: (zone: 'graveyard' | 'exile' | 'hand') => void
}

type HealthBarProps = {
  life: number
  startingLife?: number
  onChange?: (delta: number) => void
}

/** A real fillable bar rather than a bare number in a small chip — the number is still always
 *  shown as text (never just implied by how full the bar looks), but the fill gives an
 *  at-a-glance health read the way most game UIs do. Fill is clamped to [0, startingLife] so
 *  lifegain past your starting total doesn't overflow the bar — the text keeps counting past
 *  it regardless. */
function HealthBar({ life, startingLife = DEFAULT_STARTING_LIFE, onChange }: HealthBarProps) {
  const reference = Math.max(1, startingLife)
  const fillPct = Math.max(0, Math.min(1, life / reference)) * 100
  const band = life <= 0 ? 'critical' : life <= reference * 0.25 ? 'low' : life <= reference * 0.5 ? 'mid' : 'full'
  const className = `playtest__health-bar playtest__health-bar--${band}`
  const label = `Life ${life}`

  if (!onChange) {
    return (
      <div className={className} title={label} aria-label={label}>
        <div className="playtest__health-bar-fill" style={{ width: `${fillPct}%` }} />
        <span className="playtest__health-bar-value">{life}</span>
      </div>
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
      onClick={() => onChange!(1)}
      onContextMenu={handleContextMenu}
      title="Life: left-click +1, right-click -1"
      aria-label={label}
    >
      <div className="playtest__health-bar-fill" style={{ width: `${fillPct}%` }} />
      <span className="playtest__health-bar-value">{life}</span>
    </button>
  )
}

type PillProps = {
  variant: 'poison' | 'commander'
  /** Text label — used visually for a text pill (poison), and always as the tooltip/aria-label
   *  base regardless of whether `dot` swaps the visible label for a color dot. */
  label: string
  /** Longer text for the tooltip/aria-label, where `label` alone would be ambiguous once it's
   *  not shown at all (a dot pill's label is purely the seat color). Defaults to `label`. */
  fullLabel?: string
  value: number
  lethal?: boolean
  /** Tints the pill's border, and — combined with `dot` — fills the dot itself. */
  color?: string
  /** Renders a solid color dot (using `color`) instead of `label`'s text — a commander-damage
   *  pill's source is conveyed by color alone (matching that seat's color everywhere else in
   *  the UI, e.g. SEAT_COLORS), not by a text tag that either didn't say whose commander it was
   *  ("Cmdr") or ran too long for a small pill ("S2"). */
  dot?: boolean
  onChange?: (delta: number) => void
}

/** One labeled stat readout — a button when `onChange` is given, else a read-only mirror. Pills
 *  just wrap normally in their row instead of needing a corner-overlay badge per extra source. */
function StatPill({ variant, label, fullLabel, value, lethal, color, dot, onChange }: PillProps) {
  const className = [
    'playtest__stat-pill',
    `playtest__stat-pill--${variant}`,
    lethal ? 'is-lethal' : '',
    onChange ? '' : 'is-readonly',
  ]
    .filter(Boolean)
    .join(' ')
  // Not suppressed for lethal (unlike before dot mode existed): the dot needs to keep showing
  // which source dealt it even once that source crosses 21 — the lethal border/background
  // overrides below win on specificity regardless of what this sets --pill-color to.
  const style = color ? ({ '--pill-color': color } as CSSProperties) : undefined
  const title = fullLabel ?? label

  const inner = (
    <>
      {dot ? <span className="playtest__stat-pill-dot" /> : <span className="playtest__stat-pill-label">{label}</span>}
      <span className="playtest__stat-pill-value">{value}</span>
    </>
  )

  if (!onChange) {
    return (
      <span className={className} style={style} title={title} aria-label={`${title} ${value}`}>
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
      title={`${title}: left-click +1, right-click -1`}
      aria-label={`${title} ${value}`}
    >
      {inner}
    </button>
  )
}

/** Small "what just changed" flyout, shown only while the card itself is hovered (see SeatOverlay's
 *  onMouseEnter/onMouseLeave below) — portaled to document.body rather than positioned as a normal
 *  child, since .playtest__seat-overlay clips overflow (for the commander portrait's square-to-
 *  rounded corner, see that rule's own comment) which would otherwise clip a flyout reaching past
 *  the card's own edge. Same clamp-after-measure two-pass as CardContextMenu, for the same reason:
 *  the flyout's real size isn't known until it's actually rendered once. */
function ChangeLogPopover({ anchor, entries }: { anchor: HTMLElement; entries: ReturnType<typeof useChangeLog> }) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const anchorRect = anchor.getBoundingClientRect()
    const popover = popoverRef.current
    const width = popover?.offsetWidth ?? 0
    const height = popover?.offsetHeight ?? 0
    const left = Math.min(anchorRect.right + 8, window.innerWidth - width - 4)
    const top = Math.max(4, Math.min(anchorRect.top, window.innerHeight - height - 4))
    setPos({ left, top })
  }, [anchor, entries])

  return createPortal(
    <div
      ref={popoverRef}
      className="playtest__seat-changelog"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      <div className="playtest__seat-changelog-title">Recent changes</div>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className="playtest__seat-changelog-text">{entry.text}</span>
            <span className="playtest__seat-changelog-time">
              {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  )
}

function SeatOverlay({
  seat,
  name,
  life,
  startingLife,
  poison,
  handCount,
  scooped,
  commanders,
  isSelf,
  showCommanderDamage,
  commanderSources = [],
  soloCommanderDamage,
  graveyardCount = 0,
  exileCount = 0,
  handRevealed = false,
  floatingMana = {},
  onFocus,
  onLifeChange,
  onPoisonChange,
  onCommanderDamageFrom,
  onFloatingManaChange,
  onClearFloatingMana,
  onViewZone,
}: Props) {
  const seatColor = SEAT_COLORS[seat]
  // Real Commander rules: 0 or below is out, same as a voluntary Scoop — see PlaytestView's
  // isEliminated for the same combined check used by turn rotation (handlePassTurn) and the
  // table-side quadrant scrim.
  const eliminated = life <= 0 || !!scooped

  const cardRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)

  // Commander damage keyed by source, regardless of pod vs solo — see useChangeLog's doc comment
  // on why this diffs cleanly even for opponents' cards (it's the same public total everyone
  // already renders, not an actual event stream).
  const commanderDamageBySource: Record<number, number> = soloCommanderDamage
    ? { [SOLO_CMDR_SOURCE]: soloCommanderDamage.value }
    : Object.fromEntries(commanderSources.map((src) => [src.seat, src.damage]))
  const changeLog = useChangeLog({ life, poison, commanderDamage: commanderDamageBySource }, (source) =>
    source === SOLO_CMDR_SOURCE ? 'Cmdr Dmg' : `${commanderSources.find((src) => src.seat === source)?.name ?? `Seat ${source + 1}`} dmg`,
  )

  const commanderPills = !showCommanderDamage
    ? []
    : soloCommanderDamage
      ? [
          <StatPill
            key="solo-commander"
            variant="commander"
            label="Cmdr Dmg"
            fullLabel="Commander damage taken"
            value={soloCommanderDamage.value}
            lethal={soloCommanderDamage.value >= 21}
            onChange={soloCommanderDamage.onChange}
          />,
        ]
      : commanderSources.map((src) => (
          <StatPill
            key={src.seat}
            variant="commander"
            dot
            label={`Seat ${src.seat + 1}`}
            fullLabel={`Commander damage from ${src.name}`}
            value={src.damage}
            lethal={src.damage >= 21}
            color={SEAT_COLORS[src.seat]}
            onChange={onCommanderDamageFrom ? (delta) => onCommanderDamageFrom(src.seat, delta) : undefined}
          />
        ))

  return (
    <div
      ref={cardRef}
      className={`playtest__seat-overlay ${isSelf ? 'is-self' : ''} ${eliminated ? 'is-eliminated' : ''}`}
      style={{ '--seat-color': seatColor } as CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left, not right: the important per-turn info (life, poison, commander damage) sits
          closer to where the eye already lingers reading top-to-bottom/left-to-right, and a
          left-edge portrait means hovering it for the card-preview popup doesn't fire while
          you're just reaching across the card for something else (see .playtest__seat-main). */}
      {commanders && commanders.length > 0 && (
        <div className="playtest__seat-commanders">
          {commanders.map((c) => (
            <CommanderChip key={c.scryfallId} scryfallId={c.scryfallId} name={c.name} snapshot={c.snapshot} />
          ))}
        </div>
      )}
      <div className="playtest__seat-main">
        <button type="button" className="playtest__seat-nameplate" onClick={onFocus} title={`Center on ${name}`}>
          <span className="playtest__seat-color-dot" />
          <span className="playtest__seat-name">{name}</span>
          {isSelf && <span className="playtest__seat-tag">You</span>}
          {eliminated && <span className="playtest__seat-tag playtest__seat-tag--eliminated">Eliminated</span>}
          <span className="playtest__seat-hand" title={`${handCount} cards in hand`}>
            🂠 {handCount}
          </span>
        </button>
        {/* ±10 sit overlaid on the bar itself (not flanking it) to save width — see
            .playtest__health-bar-wrap. Siblings of HealthBar, not nested inside it: HealthBar is
            itself a <button> when interactive, and a <button> can't legally contain another. */}
        <div className="playtest__health-bar-wrap">
          {isSelf && onLifeChange && (
            <button
              type="button"
              className="playtest__stat-step playtest__stat-step--minus"
              onClick={() => onLifeChange(-10)}
              title="Life -10"
              aria-label="Life -10"
            >
              −10
            </button>
          )}
          <HealthBar life={life} startingLife={startingLife} onChange={isSelf ? onLifeChange : undefined} />
          {isSelf && onLifeChange && (
            <button
              type="button"
              className="playtest__stat-step playtest__stat-step--plus"
              onClick={() => onLifeChange(10)}
              title="Life +10"
              aria-label="Life +10"
            >
              +10
            </button>
          )}
        </div>
        <div className="playtest__seat-pills">
          <StatPill variant="poison" label="Poison" value={poison} onChange={isSelf ? onPoisonChange : undefined} />
          {commanderPills}
        </div>
        <ManaPool
          mana={floatingMana}
          onChange={isSelf ? onFloatingManaChange : undefined}
          onClear={isSelf ? onClearFloatingMana : undefined}
        />
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
      {hovered && changeLog.length > 0 && cardRef.current && <ChangeLogPopover anchor={cardRef.current} entries={changeLog} />}
    </div>
  )
}

export default SeatOverlay
