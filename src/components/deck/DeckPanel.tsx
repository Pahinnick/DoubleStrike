import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { getCachedCard } from '../../api/scryfall'
import CardSizeToggle from '../shared/CardSizeToggle'
import { COMMANDERS_LABEL, groupByCategory, groupByType, type DeckCardEntry } from '../../engine/deckGrouping'
import { computeDeckLegality } from '../../engine/legality'
import { useCardSnapshots } from '../../hooks/useCardSnapshots'
import { useSaltScores } from '../../hooks/useSaltScores'
import { useDeck } from '../../state/DeckContext'
import { useJumpToCardContext } from '../../state/JumpToCardContext'
import type { Board } from '../../state/types'
import { CARD_SIZES, type CardSizeKey } from '../../utils/cardSize'
import CategoryManagerModal from './CategoryManagerModal'
import DeckCardGridItem from './DeckCardGridItem'
import DeckCardGroupDropZone from './DeckCardGroupDropZone'
import DeckCardRow from './DeckCardRow'
import './deck.css'

const BOARD_LABELS: Record<Board, string> = {
  mainboard: 'Mainboard',
  sideboard: 'Sideboard',
}

const BOARDS: Board[] = ['mainboard', 'sideboard']

type Layout = 'list' | 'grid'
type GroupBy = 'none' | 'type' | 'category'

type Props = {
  cardSize: CardSizeKey
  onCardSizeChange: (size: CardSizeKey) => void
}

function DeckPanel({ cardSize, onCardSizeChange }: Props) {
  const { deck, dispatch, addCard } = useDeck()
  const { jumpTarget, clearJumpTarget } = useJumpToCardContext()
  const [activeBoard, setActiveBoard] = useState<Board>('mainboard')
  const [layout, setLayout] = useState<Layout>('grid')
  const [groupBy, setGroupBy] = useState<GroupBy>('category')
  const [managingCategories, setManagingCategories] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const sectionRef = useRef<HTMLElement>(null)

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const uniqueIds = useMemo(() => [...new Set(deck.cards.map((c) => c.scryfallId))], [deck.cards])
  const snapshots = useCardSnapshots(uniqueIds)
  const cardNames = useMemo(() => [...new Set([...snapshots.values()].map((s) => s.name))], [snapshots])
  const saltScores = useSaltScores(cardNames)

  // Keyed by scryfallId+board (not just scryfallId) so the same printing sitting in both boards
  // at once doesn't cross-contaminate — e.g. a mainboard singleton violation shouldn't paint a red
  // border on that same card's sideboard copy too.
  const cardIssues = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!deck.format) return map
    const { issues } = computeDeckLegality(deck.cards, snapshots, deck.format)
    for (const issue of issues) {
      // Deck-wide issues (no commander, wrong deck size) have no board — not tied to a card.
      if (!issue.board) continue
      const key = `${issue.scryfallId}::${issue.board}`
      const list = map.get(key) ?? []
      list.push(issue.reason)
      map.set(key, list)
    }
    return map
  }, [deck.cards, deck.format, snapshots])

  const otherBoard: Board = activeBoard === 'mainboard' ? 'sideboard' : 'mainboard'
  const visibleCards = deck.cards.filter((c) => c.board === activeBoard)
  const canDesignateCommander = deck.format === 'commander' && activeBoard === 'mainboard'

  const entries: DeckCardEntry[] = useMemo(
    () => visibleCards.map((deckCard) => ({ deckCard, snapshot: snapshots.get(deckCard.scryfallId) })),
    [visibleCards, snapshots],
  )

  const groups = useMemo(() => {
    if (groupBy === 'type') return groupByType(entries)
    if (groupBy === 'category') return groupByCategory(entries, deck.categories)
    return [{ label: '', entries }]
  }, [groupBy, entries, deck.categories])

  // Jumping to a card takes up to three passes: switch boards first, then expand its group if
  // collapsed, then (once it's actually in the DOM) scroll to and flash the row/tile.
  useEffect(() => {
    if (!jumpTarget) return
    const deckCard = deck.cards.find((c) => c.scryfallId === jumpTarget.scryfallId)
    if (!deckCard) {
      clearJumpTarget()
      return
    }
    if (deckCard.board !== activeBoard) {
      setActiveBoard(deckCard.board)
      return
    }
    const targetGroup = groups.find((group) =>
      group.entries.some((entry) => entry.deckCard.scryfallId === deckCard.scryfallId && entry.deckCard.board === deckCard.board),
    )
    if (targetGroup && targetGroup.label !== '' && collapsedGroups.has(targetGroup.label)) {
      const label = targetGroup.label
      setCollapsedGroups((prev) => {
        const next = new Set(prev)
        next.delete(label)
        return next
      })
      return
    }
    const el = sectionRef.current?.querySelector(
      `[data-scryfall-id="${deckCard.scryfallId}"][data-board="${deckCard.board}"]`,
    )
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('is-jump-highlight')
      const timer = setTimeout(() => el.classList.remove('is-jump-highlight'), 1600)
      clearJumpTarget()
      return () => clearTimeout(timer)
    }
    clearJumpTarget()
  }, [jumpTarget, deck.cards, activeBoard, groups, collapsedGroups, clearJumpTarget])

  function renderEntries(groupEntries: DeckCardEntry[]) {
    if (layout === 'grid') {
      return (
        <div className="deck-card-grid" style={{ '--card-size': `${CARD_SIZES[cardSize]}px` } as CSSProperties}>
          {groupEntries.map(({ deckCard, snapshot }) => (
            <DeckCardGridItem
              key={`${deckCard.scryfallId}-${deckCard.board}`}
              deckCard={deckCard}
              snapshot={snapshot}
              salt={snapshot ? saltScores.get(snapshot.name) : undefined}
              issueReasons={cardIssues.get(`${deckCard.scryfallId}::${deckCard.board}`) ?? []}
              cardSize={cardSize}
              canDesignateCommander={canDesignateCommander}
              otherBoard={otherBoard}
              onSetQuantity={(quantity) =>
                dispatch({ type: 'SET_QUANTITY', scryfallId: deckCard.scryfallId, board: deckCard.board, quantity })
              }
              onRemove={() => dispatch({ type: 'REMOVE_CARD', scryfallId: deckCard.scryfallId, board: deckCard.board })}
              onSetCommander={(isCommander) =>
                dispatch({ type: 'SET_COMMANDER', scryfallId: deckCard.scryfallId, board: deckCard.board, isCommander })
              }
              onSetMark={(mark) => dispatch({ type: 'SET_CARD_MARK', scryfallId: deckCard.scryfallId, board: deckCard.board, mark })}
              onMoveBoard={() =>
                dispatch({
                  type: 'MOVE_CARD_BOARD',
                  scryfallId: deckCard.scryfallId,
                  fromBoard: deckCard.board,
                  toBoard: otherBoard,
                })
              }
            />
          ))}
        </div>
      )
    }
    return (
      <div className="deck-card-list">
        {groupEntries.map(({ deckCard, snapshot }) => (
          <DeckCardRow
            key={`${deckCard.scryfallId}-${deckCard.board}`}
            deckCard={deckCard}
            snapshot={snapshot}
            salt={snapshot ? saltScores.get(snapshot.name) : undefined}
            issueReasons={cardIssues.get(`${deckCard.scryfallId}::${deckCard.board}`) ?? []}
            categories={deck.categories}
            canDesignateCommander={canDesignateCommander}
            otherBoard={otherBoard}
            onSetQuantity={(quantity) =>
              dispatch({ type: 'SET_QUANTITY', scryfallId: deckCard.scryfallId, board: deckCard.board, quantity })
            }
            onRemove={() => dispatch({ type: 'REMOVE_CARD', scryfallId: deckCard.scryfallId, board: deckCard.board })}
            onSetCategory={(category) =>
              dispatch({ type: 'SET_CARD_CATEGORY', scryfallId: deckCard.scryfallId, board: deckCard.board, category })
            }
            onSetCommander={(isCommander) =>
              dispatch({ type: 'SET_COMMANDER', scryfallId: deckCard.scryfallId, board: deckCard.board, isCommander })
            }
            onSetMark={(mark) => dispatch({ type: 'SET_CARD_MARK', scryfallId: deckCard.scryfallId, board: deckCard.board, mark })}
            onMoveBoard={() =>
              dispatch({
                type: 'MOVE_CARD_BOARD',
                scryfallId: deckCard.scryfallId,
                fromBoard: deckCard.board,
                toBoard: otherBoard,
              })
            }
          />
        ))}
      </div>
    )
  }

  return (
    <section className="app-pane" aria-label="Deck list" ref={sectionRef}>
      <h2>Deck</h2>
      <div className="board-tabs" role="tablist">
        {BOARDS.map((board) => (
          <button
            key={board}
            type="button"
            role="tab"
            aria-selected={activeBoard === board}
            className={activeBoard === board ? 'is-active' : ''}
            onClick={() => setActiveBoard(board)}
          >
            {BOARD_LABELS[board]}
          </button>
        ))}
      </div>

      <div className="deck-view-controls">
        <div className="deck-layout-toggle" role="group" aria-label="Deck layout">
          <button type="button" className={layout === 'list' ? 'is-active' : ''} onClick={() => setLayout('list')}>
            List
          </button>
          <button type="button" className={layout === 'grid' ? 'is-active' : ''} onClick={() => setLayout('grid')}>
            Grid
          </button>
        </div>
        {layout === 'grid' && <CardSizeToggle value={cardSize} onChange={onCardSizeChange} />}
        <label>
          Group by{' '}
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)}>
            <option value="none">None</option>
            <option value="type">Card type</option>
            <option value="category">Category</option>
          </select>
        </label>
        <div className="deck-view-controls__spacer" />
        {groupBy === 'category' && (
          <button type="button" onClick={() => setManagingCategories(true)}>
            Manage categories
          </button>
        )}
      </div>

      {visibleCards.length === 0 && <p className="search-status">No cards yet — add some from search.</p>}
      {groupBy === 'category' && visibleCards.length > 0 && (
        <p className="deck-drag-hint">Drag a card onto a category to reassign it.</p>
      )}

      {groups.map((group) => {
        const isCollapsed = group.label !== '' && collapsedGroups.has(group.label)
        const category = group.label === 'Uncategorized' ? undefined : group.label
        return (
          <DeckCardGroupDropZone
            key={group.label || 'all'}
            // Commanders is a derived section, not a real category — dropping onto it would set a
            // bogus category, so it's never a drop-to-categorize target.
            active={groupBy === 'category' && group.label !== COMMANDERS_LABEL}
            onDropCard={(scryfallId, board) => {
              if (board === null) {
                // Dragged in from search — not in the deck yet, so add it straight into this
                // category instead of trying to recategorize a nonexistent entry.
                const card = getCachedCard(scryfallId)
                if (card) addCard(card, 'mainboard', category)
                return
              }
              dispatch({ type: 'SET_CARD_CATEGORY', scryfallId, board, category })
            }}
          >
            <div className="deck-card-group">
              {group.label && (
                <h3 className="deck-card-group__header">
                  <button
                    type="button"
                    className="deck-card-group__toggle"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleGroup(group.label)}
                  >
                    <span className={`deck-card-group__chevron ${isCollapsed ? 'is-collapsed' : ''}`} aria-hidden="true">
                      ▸
                    </span>
                    {group.label}
                  </button>
                  <span className="deck-card-group__count">({group.entries.length})</span>
                </h3>
              )}
              {!isCollapsed && renderEntries(group.entries)}
            </div>
          </DeckCardGroupDropZone>
        )
      })}

      {managingCategories && <CategoryManagerModal onClose={() => setManagingCategories(false)} />}
    </section>
  )
}

export default DeckPanel
