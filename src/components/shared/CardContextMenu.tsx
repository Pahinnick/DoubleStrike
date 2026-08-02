import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './cardContextMenu.css'

export type ContextMenuAction = {
  label: string
  /** Leaf items only — selecting one closes the whole menu (including any open submenu). */
  onSelect?: () => void
  /** Presence makes this a flyout parent instead of a leaf — clicking toggles the nested menu open. */
  submenu?: ContextMenuAction[]
}

type Props = {
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
}

/** Floating menu, positioned at (x, y) and clamped so it never renders off-screen. Portaled to
 *  document.body so it isn't clipped by an `overflow: hidden` ancestor (e.g. a deck grid tile's
 *  rounded-corner card art) — used both for the Playtest battlefield's right-click menu and the
 *  deck editor's per-card action menu. */
function CardContextMenu({ x, y, actions, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)

  // Measure after the menu has its real size, then clamp into the viewport — runs
  // before paint so there's no visible jump from the initial (x, y) placement.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    })
  }, [x, y])

  useEffect(() => {
    // pointerdown fires before click, so a naive "dismiss on any outside pointerdown"
    // listener would close the menu (unmounting its buttons) before a click on one of
    // its own items ever reaches that item's onClick. Ignore events that land inside the menu
    // (a submenu renders as a DOM child of menuRef, not a portal, so this covers it too).
    function dismissIfOutside(event: Event) {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose()
    }
    // Skip the dismiss-on-outside-interaction listeners for the event that opened this
    // menu (a contextmenu/pointerdown fired this same tick would otherwise close it immediately).
    const id = requestAnimationFrame(() => {
      window.addEventListener('pointerdown', dismissIfOutside)
      window.addEventListener('contextmenu', dismissIfOutside)
    })
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('pointerdown', dismissIfOutside)
      window.removeEventListener('contextmenu', dismissIfOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // Flyouts open to the right by default; flip left once the menu is past the viewport's
  // midpoint so a submenu opened near the right edge doesn't run off-screen.
  const flipSubmenu = pos.x > window.innerWidth / 2

  return createPortal(
    <div ref={menuRef} className="card-context-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {actions.map((action) =>
        action.submenu ? (
          <div key={action.label} className="card-context-menu__item-wrap">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openSubmenu === action.label}
              className="card-context-menu__parent"
              onClick={() => setOpenSubmenu((cur) => (cur === action.label ? null : action.label))}
            >
              {action.label}
              <span className="card-context-menu__arrow" aria-hidden="true">
                ›
              </span>
            </button>
            {openSubmenu === action.label && (
              <div
                className={`card-context-menu card-context-menu__submenu ${flipSubmenu ? 'card-context-menu__submenu--left' : ''}`}
                role="menu"
              >
                {action.submenu.map((sub) => (
                  <button
                    key={sub.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      sub.onSelect?.()
                      onClose()
                    }}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            onClick={() => {
              action.onSelect?.()
              onClose()
            }}
          >
            {action.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}

export default CardContextMenu
