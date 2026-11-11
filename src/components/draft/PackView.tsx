import { useMemo } from 'react'
import { scryfallIdsOf } from '../../draft/draftCard'
import type { CurrentPack } from '../../draft/useDraftSession'
import { useDraftCardArt } from '../../hooks/useDraftCardArt'
import DraftCardTile from './DraftCardTile'
import './draft.css'

type Props = {
  pack: CurrentPack | null
  myPool: string[]
  onPick: (cardKey: string) => void
}

function PackView({ pack, myPool, onPick }: Props) {
  const ids = useMemo(() => scryfallIdsOf([...(pack?.cards ?? []), ...myPool]), [pack, myPool])
  const art = useDraftCardArt(ids)

  return (
    <div className="pack-view">
      <div className="pack-view__pack">
        {!pack && <p className="pack-view__waiting">Waiting for a pack from your neighbor…</p>}
        {pack && (
          <>
            <p className="pack-view__count">
              Pack {pack.round + 1} · {pack.cards.length} {pack.cards.length === 1 ? 'card' : 'cards'} left — pick one
              {art.missingCount > 0 && <span className="pack-view__loading"> · loading art for {art.missingCount}…</span>}
            </p>
            <ul className="pack-view__grid">
              {pack.cards.map((key, index) => (
                <li key={`${key}-${index}`}>
                  <DraftCardTile cardKey={key} art={art} size="normal" onClick={() => onPick(key)} className="pack-view__card" />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="pack-view__pool">
        <h3>Your picks ({myPool.length})</h3>
        <ul className="pack-view__pool-list">
          {myPool.map((key, index) => (
            <li key={`${key}-${index}`}>
              <DraftCardTile cardKey={key} art={art} size="small" className="pack-view__pool-card" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default PackView
