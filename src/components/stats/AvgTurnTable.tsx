import { useMemo, useState } from 'react'
import type { CastabilityResult } from '../../engine/castability'
import { parseManaCost, pipShapeKey } from '../../engine/manaCost'
import type { DeckCard } from '../../state/types'
import type { CardSnapshot } from '../../storage/cardCache'

type Entry = { deckCard: DeckCard; card: CardSnapshot }

type Props = {
  entries: Entry[]
  castabilityIndex: Map<string, CastabilityResult>
}

type SortKey = 'name' | 'cmc' | 'avgTurn'

type Row = {
  id: string
  name: string
  manaCost: string
  cmc: number
  avgTurn: number | null
}

function AvgTurnTable({ entries, castabilityIndex }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('avgTurn')

  const rows = useMemo<Row[]>(() => {
    return entries.map(({ card }) => {
      const req = parseManaCost(card.mana_cost)
      const result = castabilityIndex.get(pipShapeKey(req))
      return {
        id: card.id,
        name: card.name,
        manaCost: card.mana_cost,
        cmc: card.cmc,
        avgTurn: result?.expectedTurn ?? null,
      }
    })
  }, [entries, castabilityIndex])

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      if (sortKey === 'cmc') return a.cmc - b.cmc
      if (a.avgTurn === null && b.avgTurn === null) return 0
      if (a.avgTurn === null) return 1
      if (b.avgTurn === null) return -1
      return a.avgTurn - b.avgTurn
    })
  }, [rows, sortKey])

  if (rows.length === 0) {
    return <p className="search-status">Add nonland cards to see avg-turn-castable.</p>
  }

  return (
    <table className="avg-turn-table">
      <thead>
        <tr>
          <th onClick={() => setSortKey('name')}>Card</th>
          <th onClick={() => setSortKey('cmc')}>Cost</th>
          <th onClick={() => setSortKey('avgTurn')}>Avg Turn</th>
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => (
          <tr key={row.id}>
            <td>{row.name}</td>
            <td>{row.manaCost || '—'}</td>
            <td>{row.avgTurn === null ? '10+' : row.avgTurn.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default AvgTurnTable
