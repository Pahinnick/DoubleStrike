import { useEffect, useState } from 'react'
import { getCardsByIdentifiers } from '../../api/scryfall'
import { getSnapshotImage, getSnapshots, saveSnapshots, toSnapshot, type CardSnapshot } from '../../storage/cardCache'
import { getCardImageUrl } from '../../utils/cardSize'
import type { CurrentPack } from '../../draft/useDraftSession'
import './draft.css'

type Props = {
  pack: CurrentPack | null
  myPool: string[]
  onPick: (scryfallId: string) => void
}

function PackView({ pack, myPool, onPick }: Props) {
  const [snapshots, setSnapshots] = useState<Map<string, CardSnapshot>>(new Map())

  useEffect(() => {
    const ids = [...new Set([...(pack?.cards ?? []), ...myPool])]
    if (ids.length === 0) return
    let cancelled = false
    void getSnapshots(ids).then(async (results) => {
      if (cancelled) return
      setSnapshots((prev) => {
        const next = new Map(prev)
        for (const snapshot of results) if (snapshot) next.set(snapshot.id, snapshot)
        return next
      })
      // The cube's cards are cached on the HOST's machine, where the cube was built; a pack
      // arrives as bare ids. Reading only the local cache left a guest looking at a grid of
      // "Loading…" tiles for every card they had never seen before — drafting blind. Fetch
      // whatever is missing.
      const missing = ids.filter((_id, index) => !results[index])
      if (missing.length === 0) return
      const cards = await getCardsByIdentifiers(missing.map((id) => ({ id })))
      void saveSnapshots(cards)
      if (cancelled || cards.length === 0) return
      setSnapshots((prev) => {
        const next = new Map(prev)
        for (const card of cards) next.set(card.id, toSnapshot(card))
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [pack, myPool])

  return (
    <div className="pack-view">
      <div className="pack-view__pack">
        {!pack && <p className="pack-view__waiting">Waiting for a pack from your neighbor…</p>}
        {pack && (
          <>
            <p className="pack-view__count">{pack.cards.length} cards — pick one</p>
            <ul className="pack-view__grid">
              {pack.cards.map((id, index) => {
                const snapshot = snapshots.get(id)
                const image = snapshot ? getSnapshotImage(snapshot) : undefined
                return (
                  // Index in the key: a cube can run two copies of a card in one pack.
                  <li key={`${id}-${index}`}>
                    <button type="button" className="pack-view__card" onClick={() => onPick(id)} title={snapshot?.name ?? id}>
                      {image ? (
                        <img src={getCardImageUrl(image, 'medium')} alt={snapshot?.name ?? ''} draggable={false} />
                      ) : (
                        <span className="pack-view__card-noimage">{snapshot?.name ?? 'Loading…'}</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
      <div className="pack-view__pool">
        <h3>Your pool ({myPool.length})</h3>
        <ul className="pack-view__pool-list">
          {myPool.map((id, index) => {
            const snapshot = snapshots.get(id)
            const image = snapshot ? getSnapshotImage(snapshot) : undefined
            return (
              <li key={`${id}-${index}`} title={snapshot?.name ?? id}>
                {image ? <img src={getCardImageUrl(image, 'small')} alt="" draggable={false} /> : <span className="pack-view__pool-noimage" />}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export default PackView
