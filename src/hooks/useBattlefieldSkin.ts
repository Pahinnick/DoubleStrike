import { useEffect, useState } from 'react'

export type BattlefieldSkin =
  | 'felt'
  | 'triangles'
  | 'neonGlow'
  | 'prism'
  | 'leyLines'
  | 'runicCircle'
  | 'emberAura'

export const BATTLEFIELD_SKINS: { id: BattlefieldSkin; label: string; emoji: string }[] = [
  { id: 'felt', label: 'Off', emoji: '⬛' },
  { id: 'triangles', label: 'Triangle Glow', emoji: '🔺' },
  { id: 'neonGlow', label: 'Neon Glow', emoji: '💡' },
  { id: 'prism', label: 'Prism Dust', emoji: '💠' },
  { id: 'leyLines', label: 'Ley Lines', emoji: '🕸️' },
  { id: 'runicCircle', label: 'Runic Circle', emoji: '🔮' },
  { id: 'emberAura', label: 'Ember Aura', emoji: '🔥' },
]

const SKIN_KEY = 'mtgdb:battlefieldSkin'
const SKIN_IDS = BATTLEFIELD_SKINS.map((s) => s.id)

function isSkin(value: string | null | undefined): value is BattlefieldSkin {
  return value != null && (SKIN_IDS as string[]).includes(value)
}

function getStoredSkin(): BattlefieldSkin {
  const stored = localStorage.getItem(SKIN_KEY)
  return isSkin(stored) ? stored : 'felt'
}

/** Validates a skin id received over the wire (an opponent's `PublicBoard.battlefieldSkin`,
 *  which is a loose `string | undefined` on the network since protocol.ts stays React-free) —
 *  falls back to 'felt' for anything unset, garbled, or from a newer build with a skin id this
 *  client doesn't know about. */
export function normalizeBattlefieldSkin(value: string | null | undefined): BattlefieldSkin {
  return isSkin(value) ? value : 'felt'
}

/** Which decorative overlay (if any) renders on the Playtest battlefield's playmat — see
 *  BattlefieldTriangleGrid.tsx / `.playtest__skin-fx` in playtest.css. 'felt' is the plain
 *  playmat with no extra decoration (the pre-existing look), so nothing renders for it.
 *  Persisted like `useTheme`. */
export function useBattlefieldSkin(): [BattlefieldSkin, (skin: BattlefieldSkin) => void] {
  const [skin, setSkin] = useState<BattlefieldSkin>(getStoredSkin)

  useEffect(() => {
    localStorage.setItem(SKIN_KEY, skin)
  }, [skin])

  return [skin, setSkin]
}
