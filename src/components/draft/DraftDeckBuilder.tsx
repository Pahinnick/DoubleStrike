import { useEffect, useMemo, useRef, useState } from 'react'
import { getCardsByIdentifiers, searchAllPrints } from '../../api/scryfall'
import type { ScryfallCard } from '../../api/scryfallTypes'
import { draftCardKey, parseDraftCardKey } from '../../draft/draftCard'
import type { DraftConfig } from '../../draft/types'
import type { Seat } from '../../net/protocol'
import { LIMITED_MIN_DECK_SIZE } from '../../engine/legality'
import { BASIC_LAND_NAMES, basicLandSlots, CURVE_COLUMNS, curveColumnOf, suggestBasicLands, type CurveColumn } from '../../engine/limitedDeck'
import { useDraftCardArt } from '../../hooks/useDraftCardArt'
import { useProfileSettings } from '../../hooks/useProfileSettings'
import { useDeck } from '../../state/DeckContext'
import { useDeckList } from '../../state/DeckListContext'
import type { DeckCard } from '../../state/types'
import { saveSnapshots, type CardSnapshot } from '../../storage/cardCache'
import { COLOR_NAMES, WUBRG, type Color } from '../../utils/colors'
import DraftCardTile from './DraftCardTile'
import './draft.css'

type Props = {
  /** Every card this player drafted, as draft card keys (foil copies marked). */
  pool: string[]
  config: DraftConfig | null
  /** Who sits across from you at your table — your 1v1 opponent — if anyone. */
  opponentName: string | null
  /** True when that opponent is a dev-mode bot — it drafts, but can't play a match. */
  opponentIsBot: boolean
  /** Whether anyone else in the draft (not a bot) could play a match at the table. */
  hasOtherPlayers: boolean
  tableNumber: number | null
  /** Everyone else from the draft who can play, and what they're doing right now. */
  matches: DraftMatchEntry[]
  /** Head to the game table: whoever's waiting for you, else your tablemate, else on your own. */
  onGoToTable: () => void
  /** Head to the game table to play this particular player. */
  onPlay: (seat: Seat) => void
  /** True once the player has been to the table and come back: the next match is theirs to
   *  choose, so the Matches panel becomes the main "pick a seat" choice instead of a side list. */
  choosingNext: boolean
}

/** One row of the Matches panel. `played`: you've already had a match against them. `busy`: they're
 *  mid-match with someone else — picking them joins their table to wait for a seat. */
export type DraftMatchEntry = {
  seat: Seat
  name: string
  activity: string
  waitingForMe: boolean
  away: boolean
  played: boolean
  busy: boolean
}

type ColorFilter = Color | 'multi' | 'colorless'
type TypeFilter = 'all' | 'creatures' | 'spells' | 'lands'

const COLOR_FILTERS: { id: ColorFilter; label: string }[] = [
  ...WUBRG.map((color) => ({ id: color as ColorFilter, label: COLOR_NAMES[color] })),
  { id: 'multi', label: 'Multicolor' },
  { id: 'colorless', label: 'Colorless' },
]

function cardColors(snapshot: CardSnapshot | undefined): string[] {
  if (!snapshot) return []
  return snapshot.colors.length > 0 ? snapshot.colors : (snapshot.card_faces?.[0] as { colors?: string[] } | undefined)?.colors ?? []
}

function frontType(snapshot: CardSnapshot | undefined): string {
  return snapshot?.card_faces?.[0]?.type_line ?? snapshot?.type_line ?? ''
}

function isLandCard(snapshot: CardSnapshot | undefined): boolean {
  return frontType(snapshot).includes('Land')
}

function matchesColor(snapshot: CardSnapshot | undefined, filter: ColorFilter): boolean {
  const colors = cardColors(snapshot)
  if (filter === 'multi') return colors.length > 1
  if (filter === 'colorless') return colors.length === 0
  return colors.includes(filter)
}

function matchesType(snapshot: CardSnapshot | undefined, filter: TypeFilter): boolean {
  if (filter === 'all') return true
  const type = frontType(snapshot)
  if (filter === 'lands') return type.includes('Land')
  if (filter === 'creatures') return type.includes('Creature')
  return !type.includes('Creature') && !type.includes('Land')
}

/** Basic land printings to add from — the drafted set's own when it has them, else any printing. */
async function resolveBasicLands(setCode: string | undefined): Promise<{ ids: Record<Color, string>; cards: ScryfallCard[] }> {
  const ids: Partial<Record<Color, string>> = {}
  const found: ScryfallCard[] = []
  if (setCode) {
    try {
      for (const card of await searchAllPrints(`set:${setCode} t:basic`)) {
        const color = WUBRG.find((c) => card.name === BASIC_LAND_NAMES[c])
        if (color && !ids[color]) {
          ids[color] = card.id
          found.push(card)
        }
      }
    } catch {
      // Fall through to generic printings below.
    }
  }
  const missing = WUBRG.filter((color) => !ids[color])
  if (missing.length > 0) {
    for (const card of await getCardsByIdentifiers(missing.map((color) => ({ name: BASIC_LAND_NAMES[color] })))) {
      const color = WUBRG.find((c) => card.name === BASIC_LAND_NAMES[c])
      if (color && !ids[color]) {
        ids[color] = card.id
        found.push(card)
      }
    }
  }
  return { ids: ids as Record<Color, string>, cards: found }
}

/**
 * The post-draft deckbuilding space. The moment a draft finishes, the whole pool is saved as a real
 * deck (format "limited", every pick in the sideboard) so nothing is lost even if the app closes —
 * this screen then edits that deck: click a card in your pool to put it in your deck and back again,
 * add free basic lands (or let it suggest them from your colors), and watch the 40-card minimum.
 * When it reaches 40 cards, "Go to the game table" takes the player straight into their 1v1 match
 * (see DraftView). The deck also stays in "My Decks" afterwards.
 */
function DraftDeckBuilder({ pool, config, opponentName, opponentIsBot, hasOtherPlayers, tableNumber, matches, onGoToTable, onPlay, choosingNext }: Props) {
  const waitingForMe = matches.find((m) => m.waitingForMe) ?? null
  // Back from a match with others to play: pick the next opponent's seat (no default opponent).
  const choosing = choosingNext && matches.length > 0
  const { deck, dispatch } = useDeck()
  const { createDeck } = useDeckList()
  const { cardCacheEnabled } = useProfileSettings()
  const [draftDeckId, setDraftDeckId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [basicIds, setBasicIds] = useState<Record<Color, string> | null>(null)
  const [colorFilter, setColorFilter] = useState<ColorFilter | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const creatingRef = useRef(false)

  // Save the pool as a deck exactly once (the ref survives StrictMode's double-invoked effect).
  useEffect(() => {
    if (creatingRef.current) return
    creatingRef.current = true
    const sourceName = config?.source.name ?? 'Draft'
    const name = `Draft — ${sourceName} — ${new Date().toLocaleDateString()}`
    createDeck(name)
      .then((id) => {
        dispatch({ type: 'SET_FORMAT', format: 'limited' })
        for (const key of pool) {
          const { scryfallId } = parseDraftCardKey(key)
          dispatch({ type: 'ADD_CARD', scryfallId, board: 'sideboard' })
        }
        for (const key of pool) {
          const { scryfallId, foil } = parseDraftCardKey(key)
          if (foil) dispatch({ type: 'SET_CARD_FOIL', scryfallId, board: 'sideboard', foil: 'classic' })
        }
        setDraftDeckId(id)
      })
      .catch(() => setSaveError("Couldn't save your pool as a deck — your picks are still listed below."))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setCode = config?.source.kind === 'set' ? config.source.setCode : undefined
  useEffect(() => {
    let cancelled = false
    void resolveBasicLands(setCode).then(({ ids, cards }) => {
      if (cancelled) return
      if (cardCacheEnabled) void saveSnapshots(cards)
      setBasicIds(ids)
    })
    return () => {
      cancelled = true
    }
  }, [setCode, cardCacheEnabled])

  const editing = draftDeckId !== null && deck.id === draftDeckId
  const basicIdSet = useMemo(() => new Set(basicIds ? Object.values(basicIds) : []), [basicIds])
  const mainCards = editing ? deck.cards.filter((c) => c.board === 'mainboard') : []
  const poolCards = editing ? deck.cards.filter((c) => c.board === 'sideboard') : []

  const allIds = useMemo(() => {
    const ids = new Set(pool.map((key) => parseDraftCardKey(key).scryfallId))
    for (const id of basicIdSet) ids.add(id)
    return [...ids]
  }, [pool, basicIdSet])
  const art = useDraftCardArt(allIds)

  const keyOf = (card: DeckCard) => draftCardKey(card.scryfallId, card.foil !== undefined)
  const move = (card: DeckCard, toBoard: 'mainboard' | 'sideboard') =>
    dispatch({ type: 'MOVE_CARD_COPIES', scryfallId: card.scryfallId, fromBoard: card.board, toBoard, count: 1 })

  const basicCount = (color: Color) => (basicIds ? mainCards.find((c) => c.scryfallId === basicIds[color])?.quantity ?? 0 : 0)
  const setBasicCount = (color: Color, quantity: number) => {
    if (!basicIds) return
    const id = basicIds[color]
    const next = Math.max(0, quantity)
    if (mainCards.some((c) => c.scryfallId === id)) {
      dispatch({ type: 'SET_QUANTITY', scryfallId: id, board: 'mainboard', quantity: next })
    } else if (next > 0) {
      dispatch({ type: 'ADD_CARD', scryfallId: id, board: 'mainboard' })
      if (next > 1) dispatch({ type: 'SET_QUANTITY', scryfallId: id, board: 'mainboard', quantity: next })
    }
  }

  const spellsInDeck = mainCards.filter((c) => !basicIdSet.has(c.scryfallId))
  const nonbasicLandCount = spellsInDeck.filter((c) => isLandCard(art.snapshotFor(c.scryfallId))).reduce((sum, c) => sum + c.quantity, 0)
  const basicTotal = WUBRG.reduce((sum, color) => sum + basicCount(color), 0)
  const deckTotal = mainCards.reduce((sum, c) => sum + c.quantity, 0)
  const landTotal = basicTotal + nonbasicLandCount
  const creatureCount = spellsInDeck
    .filter((c) => frontType(art.snapshotFor(c.scryfallId)).includes('Creature'))
    .reduce((sum, c) => sum + c.quantity, 0)

  function suggestLands() {
    const costs: string[] = []
    for (const card of spellsInDeck) {
      const snapshot = art.snapshotFor(card.scryfallId)
      if (!snapshot || isLandCard(snapshot)) continue
      for (let i = 0; i < card.quantity; i++) costs.push(snapshot.mana_cost)
    }
    const counts = suggestBasicLands(costs, basicLandSlots(nonbasicLandCount))
    for (const color of WUBRG) setBasicCount(color, counts[color])
  }

  const columns = new Map<CurveColumn, DeckCard[]>()
  for (const column of [...CURVE_COLUMNS, 'Lands'] as CurveColumn[]) columns.set(column, [])
  for (const card of spellsInDeck) {
    const snapshot = art.snapshotFor(card.scryfallId)
    columns.get(curveColumnOf(snapshot?.cmc ?? 0, isLandCard(snapshot)))?.push(card)
  }
  for (const list of columns.values()) {
    list.sort((a, b) => (art.snapshotFor(a.scryfallId)?.name ?? '').localeCompare(art.snapshotFor(b.scryfallId)?.name ?? ''))
  }

  const visiblePool = poolCards
    .filter((c) => {
      const snapshot = art.snapshotFor(c.scryfallId)
      return (colorFilter === null || matchesColor(snapshot, colorFilter)) && matchesType(snapshot, typeFilter)
    })
    .sort((a, b) => {
      const sa = art.snapshotFor(a.scryfallId)
      const sb = art.snapshotFor(b.scryfallId)
      return (sa?.cmc ?? 0) - (sb?.cmc ?? 0) || (sa?.name ?? '').localeCompare(sb?.name ?? '')
    })
  const poolTotal = poolCards.reduce((sum, c) => sum + c.quantity, 0)
  const deckReady = deckTotal >= LIMITED_MIN_DECK_SIZE

  if (saveError) {
    return (
      <div className="draft-builder">
        <p className="search-status search-status--error">{saveError}</p>
      </div>
    )
  }
  if (!editing) {
    return (
      <div className="draft-builder">
        <p className="draft-lobby__muted">{draftDeckId ? 'This draft deck is no longer the open deck.' : 'Saving your picks as a deck…'}</p>
      </div>
    )
  }

  return (
    <div className="draft-builder">
      <header className="draft-builder__bar">
        <div className="draft-builder__title">
          <h2>Build your deck</h2>
          <p className="draft-lobby__muted">
            {choosing
              ? 'Change your deck if you like, then pick a seat below for your next match.'
              : opponentName && tableNumber !== null
                ? `Table ${tableNumber} — your 1v1 opponent is ${opponentName}.`
                : 'Nobody sat at your table, so you have no 1v1 opponent this time.'}{' '}
            Saved automatically to My Decks as “{deck.name}”.
          </p>
        </div>
        <div className={`draft-builder__count ${deckReady ? 'is-ready' : ''}`}>
          <strong>
            {deckTotal}/{LIMITED_MIN_DECK_SIZE}
          </strong>
          <span>
            {landTotal} lands · {creatureCount} creatures
          </span>
        </div>
        {choosing ? (
          <div className="draft-builder__actions">
            {waitingForMe && (
              <button type="button" className="draft-lobby__primary draft-builder__go" onClick={() => onPlay(waitingForMe.seat)} disabled={!deckReady}>
                Join {waitingForMe.name}'s match
              </button>
            )}
            <span className="draft-builder__go-hint">
              {!deckReady
                ? `Add ${LIMITED_MIN_DECK_SIZE - deckTotal} more card${LIMITED_MIN_DECK_SIZE - deckTotal === 1 ? '' : 's'} to play.`
                : waitingForMe
                  ? `${waitingForMe.name} is waiting for you — or pick another seat below.`
                  : 'Pick a seat below to sit down against that player.'}
            </span>
          </div>
        ) : (
        <div className="draft-builder__actions">
          <button type="button" className="draft-lobby__primary draft-builder__go" onClick={onGoToTable} disabled={!deckReady}>
            {waitingForMe
              ? `Join ${waitingForMe.name}'s match`
              : opponentName && !opponentIsBot
                ? `Go to the game table vs ${opponentName}`
                : 'Go to the game table'}
          </button>
          <span className="draft-builder__go-hint">
            {!deckReady
              ? `Add ${LIMITED_MIN_DECK_SIZE - deckTotal} more card${LIMITED_MIN_DECK_SIZE - deckTotal === 1 ? '' : 's'} to play.`
              : waitingForMe
                ? `${waitingForMe.name} is waiting for you at the table.`
                : opponentName && !opponentIsBot
                ? `You'll meet ${opponentName} at the table — whoever gets there first waits for the other.`
                : !hasOtherPlayers
                  ? opponentIsBot
                    ? `${opponentName} is a bot and can't play a match — you'll be at the table on your own.`
                    : "You're the only player in this draft — you'll be at the table on your own."
                  : opponentIsBot
                    ? `${opponentName} is a bot — at the table you can pick anyone else from the draft to play.`
                    : 'Nobody sat at your table — at the game table you can pick anyone from the draft to play.'}
          </span>
        </div>
        )}
      </header>

      {matches.length > 0 && (
        <section className={`draft-matches${choosing ? ' is-choosing' : ''}`} aria-label={choosing ? 'Choose your next opponent' : 'Matches'}>
          <span className="draft-builder__section-label">{choosing ? 'Choose your next opponent — pick a seat' : 'Matches — pick who to play next'}</span>
          <ul className="draft-matches__list">
            {matches.map((m) => (
              <li key={m.seat} className={['draft-matches__row', m.waitingForMe && 'is-waiting', m.away && 'is-away'].filter(Boolean).join(' ')}>
                <span className="draft-matches__name">
                  {choosing ? (
                    <>
                      Seat {m.seat + 1} <span className="draft-matches__seat">· {m.name}</span>
                    </>
                  ) : (
                    <>
                      {m.name} <span className="draft-matches__seat">· Seat {m.seat + 1}</span>
                    </>
                  )}
                  {m.played && <span className="draft-matches__played">Played</span>}
                </span>
                <span className="draft-matches__activity">{m.activity}</span>
                <button
                  type="button"
                  className={m.waitingForMe || choosing ? 'draft-lobby__primary' : undefined}
                  onClick={() => onPlay(m.seat)}
                  disabled={!deckReady || m.away}
                  title={!deckReady ? `Your deck needs ${LIMITED_MIN_DECK_SIZE} cards first.` : undefined}
                >
                  {m.waitingForMe ? 'Join' : m.busy ? 'Wait at their table' : choosing ? (m.played ? 'Rematch' : 'Sit down') : 'Play'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="draft-builder__lands" aria-label="Basic lands">
        <span className="draft-builder__section-label">Basic lands (free)</span>
        {WUBRG.map((color) => (
          <div key={color} className="draft-basic">
            <span className={`draft-basic__pip draft-basic__pip--${color.toLowerCase()}`} aria-hidden="true" />
            <span className="draft-basic__name">{BASIC_LAND_NAMES[color]}</span>
            <button type="button" aria-label={`Remove a ${BASIC_LAND_NAMES[color]}`} onClick={() => setBasicCount(color, basicCount(color) - 1)} disabled={!basicIds || basicCount(color) === 0}>
              −
            </button>
            <span className="draft-basic__count">{basicCount(color)}</span>
            <button type="button" aria-label={`Add a ${BASIC_LAND_NAMES[color]}`} onClick={() => setBasicCount(color, basicCount(color) + 1)} disabled={!basicIds}>
              +
            </button>
          </div>
        ))}
        <button type="button" onClick={suggestLands} disabled={!basicIds || spellsInDeck.length === 0} title="Fill up to 17 lands, split by the colored mana symbols in your deck">
          Suggest lands
        </button>
      </section>

      <section className="draft-builder__deck" aria-label="Your deck">
        <span className="draft-builder__section-label">Deck — click a card to send it back to your pool</span>
        <div className="draft-curve">
          {[...columns.entries()].map(([column, cards]) => (
            <div key={column} className="draft-curve__column">
              <span className="draft-curve__head">
                {column === 'Lands' ? 'Lands' : `MV ${column}`} · {cards.reduce((sum, c) => sum + c.quantity, 0)}
              </span>
              <div className="draft-curve__stack">
                {cards.map((card) => (
                  <DraftCardTile
                    key={`${card.scryfallId}-main`}
                    cardKey={keyOf(card)}
                    art={art}
                    size="normal"
                    badge={card.quantity > 1 ? `×${card.quantity}` : undefined}
                    onClick={() => move(card, 'sideboard')}
                    className="draft-curve__card"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="draft-builder__pool" aria-label="Your pool">
        <div className="draft-builder__pool-head">
          <span className="draft-builder__section-label">Pool — {poolTotal} cards · click to add to your deck</span>
          <div className="draft-filter" role="group" aria-label="Filter by color">
            {COLOR_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`draft-filter__chip draft-filter__chip--${f.id.toLowerCase()} ${colorFilter === f.id ? 'is-active' : ''}`}
                aria-pressed={colorFilter === f.id}
                onClick={() => setColorFilter((prev) => (prev === f.id ? null : f.id))}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TypeFilter)} aria-label="Filter by card type">
            <option value="all">All types</option>
            <option value="creatures">Creatures</option>
            <option value="spells">Non-creature spells</option>
            <option value="lands">Lands</option>
          </select>
        </div>
        {visiblePool.length === 0 ? (
          <p className="draft-lobby__muted">{poolTotal === 0 ? 'Every card you drafted is in your deck.' : 'No pool cards match these filters.'}</p>
        ) : (
          <ul className="draft-builder__pool-grid">
            {visiblePool.map((card) => (
              <li key={`${card.scryfallId}-pool`}>
                <DraftCardTile
                  cardKey={keyOf(card)}
                  art={art}
                  size="normal"
                  badge={card.quantity > 1 ? `×${card.quantity}` : undefined}
                  onClick={() => move(card, 'mainboard')}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default DraftDeckBuilder
