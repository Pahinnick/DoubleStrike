import type { Board, Deck, FoilKind, ManaBaseOverride } from './types'

export type DeckAction =
  | { type: 'ADD_CARD'; scryfallId: string; board?: Board; category?: string; isToken?: boolean }
  | { type: 'SET_PRINTING'; fromScryfallId: string; toScryfallId: string; board: Board }
  | { type: 'REMOVE_CARD'; scryfallId: string; board: Board }
  | { type: 'SET_QUANTITY'; scryfallId: string; board: Board; quantity: number }
  | { type: 'MOVE_CARD_BOARD'; scryfallId: string; fromBoard: Board; toBoard: Board }
  /** Move only `count` copies (not the whole stack) — e.g. one card from a drafted pool into the deck. */
  | { type: 'MOVE_CARD_COPIES'; scryfallId: string; fromBoard: Board; toBoard: Board; count: number }
  | { type: 'SET_FORMAT'; format: Deck['format'] }
  | { type: 'SET_MANA_OVERRIDE'; override: ManaBaseOverride | undefined }
  | { type: 'SET_LAND_DROP_CONFIDENCE'; confidence: number }
  | { type: 'RENAME_DECK'; name: string }
  | { type: 'LOAD_DECK'; deck: Deck }
  | { type: 'ADD_CATEGORY'; name: string }
  | { type: 'RENAME_CATEGORY'; oldName: string; newName: string }
  | { type: 'REMOVE_CATEGORY'; name: string }
  | { type: 'SET_CARD_CATEGORY'; scryfallId: string; board: Board; category: string | undefined }
  | { type: 'SET_COMMANDER'; scryfallId: string; board: Board; isCommander: boolean }
  | { type: 'SET_CARD_MARK'; scryfallId: string; board: Board; mark: string | undefined }
  | { type: 'SET_CARD_FOIL'; scryfallId: string; board: Board; foil: FoilKind | undefined }

// Lowercased COMMANDERS_LABEL / UNCATEGORIZED_LABEL from engine/deckGrouping.ts.
const RESERVED_GROUP_NAMES = new Set(['commanders', 'uncategorized'])

function touch(deck: Deck): Deck {
  return { ...deck, updatedAt: new Date().toISOString() }
}

export function deckReducer(deck: Deck, action: DeckAction): Deck {
  switch (action.type) {
    case 'LOAD_DECK':
      return action.deck

    case 'ADD_CARD': {
      const board = action.board ?? 'mainboard'
      const existing = deck.cards.find((c) => c.scryfallId === action.scryfallId && c.board === board)
      // Only touch category when the caller actually specified one (e.g. dropping a search
      // result onto a category) — a plain add (click, similar cards, art swap) must never reset
      // an existing copy's category back to Uncategorized.
      const cards = existing
        ? deck.cards.map((c) =>
            c === existing ? { ...c, quantity: c.quantity + 1, ...(action.category !== undefined ? { category: action.category } : {}) } : c,
          )
        : [...deck.cards, { scryfallId: action.scryfallId, quantity: 1, board, category: action.category, isToken: action.isToken }]
      // A caller-specified category (explicit drag, or auto-categorization on a fresh card) must
      // actually exist in the deck's category list — otherwise groupByCategory can't find it and
      // silently renders the card as Uncategorized instead.
      const categories =
        action.category !== undefined && !deck.categories.includes(action.category) ? [...deck.categories, action.category] : deck.categories
      return touch({ ...deck, categories, cards })
    }

    case 'SET_PRINTING': {
      if (action.fromScryfallId === action.toScryfallId) return deck
      const source = deck.cards.find((c) => c.scryfallId === action.fromScryfallId && c.board === action.board)
      if (!source) return deck

      // If the target printing is already a separate entry on this board (rare — the user owns
      // two different prints of the same card), fold the source's quantity into it instead of
      // creating a duplicate row.
      const target = deck.cards.find((c) => c.scryfallId === action.toScryfallId && c.board === action.board)
      if (target) {
        return touch({
          ...deck,
          cards: deck.cards
            .filter((c) => c !== source)
            .map((c) => (c === target ? { ...c, quantity: c.quantity + source.quantity } : c)),
        })
      }
      return touch({
        ...deck,
        cards: deck.cards.map((c) => (c === source ? { ...c, scryfallId: action.toScryfallId } : c)),
      })
    }

    case 'REMOVE_CARD':
      return touch({
        ...deck,
        cards: deck.cards.filter((c) => !(c.scryfallId === action.scryfallId && c.board === action.board)),
      })

    case 'SET_QUANTITY': {
      if (action.quantity <= 0) {
        return touch({
          ...deck,
          cards: deck.cards.filter((c) => !(c.scryfallId === action.scryfallId && c.board === action.board)),
        })
      }
      return touch({
        ...deck,
        cards: deck.cards.map((c) =>
          c.scryfallId === action.scryfallId && c.board === action.board ? { ...c, quantity: action.quantity } : c,
        ),
      })
    }

    case 'MOVE_CARD_BOARD': {
      if (action.fromBoard === action.toBoard) return deck
      const source = deck.cards.find((c) => c.scryfallId === action.scryfallId && c.board === action.fromBoard)
      if (!source) return deck
      // The destination can already hold this printing (moved there earlier, then added again
      // from search). Two entries with the same printing and board are indistinguishable to every
      // other action here — they share a list key, and a quantity or category edit hits both —
      // so fold the moved copies into the existing entry, same as SET_PRINTING does.
      const target = deck.cards.find((c) => c.scryfallId === action.scryfallId && c.board === action.toBoard)
      if (target) {
        return touch({
          ...deck,
          cards: deck.cards
            .filter((c) => c !== source)
            .map((c) => (c === target ? { ...c, quantity: c.quantity + source.quantity } : c)),
        })
      }
      return touch({
        ...deck,
        cards: deck.cards.map((c) => (c === source ? { ...c, board: action.toBoard } : c)),
      })
    }

    case 'MOVE_CARD_COPIES': {
      const source = deck.cards.find((c) => c.scryfallId === action.scryfallId && c.board === action.fromBoard)
      const moving = Math.min(Math.max(0, Math.floor(action.count)), source?.quantity ?? 0)
      if (!source || moving === 0 || action.fromBoard === action.toBoard) return deck
      const target = deck.cards.find((c) => c.scryfallId === action.scryfallId && c.board === action.toBoard)
      let cards = deck.cards
        .map((c) => (c === source ? { ...c, quantity: c.quantity - moving } : c))
        .filter((c) => c.quantity > 0)
      cards = target
        ? cards.map((c) => (c === target ? { ...c, quantity: c.quantity + moving, foil: c.foil ?? source.foil } : c))
        : [...cards, { ...source, board: action.toBoard, quantity: moving, isCommander: undefined }]
      return touch({ ...deck, cards })
    }

    case 'SET_FORMAT':
      return touch({ ...deck, format: action.format })

    case 'SET_MANA_OVERRIDE':
      return touch({ ...deck, manaBaseOverride: action.override })

    case 'SET_LAND_DROP_CONFIDENCE':
      return touch({ ...deck, landDropConfidence: action.confidence })

    case 'RENAME_DECK':
      return touch({ ...deck, name: action.name })

    case 'ADD_CATEGORY': {
      const name = action.name.trim()
      if (!name || deck.categories.some((c) => c.toLowerCase() === name.toLowerCase())) return deck
      return touch({ ...deck, categories: [...deck.categories, name] })
    }

    case 'RENAME_CATEGORY': {
      const newName = action.newName.trim()
      if (!newName || newName === action.oldName || !deck.categories.includes(action.oldName)) return deck
      // These are group headings the deck list derives for itself, not categories — a real
      // category of the same name would render as a second group under the same heading.
      if (RESERVED_GROUP_NAMES.has(newName.toLowerCase())) return deck
      // Renaming onto a category that already exists merges into it. Left as two entries of one
      // name, the deck list drew the group twice, with every card in it twice.
      const existing = deck.categories.find((c) => c !== action.oldName && c.toLowerCase() === newName.toLowerCase())
      const finalName = existing ?? newName
      return touch({
        ...deck,
        categories: existing
          ? deck.categories.filter((c) => c !== action.oldName)
          : deck.categories.map((c) => (c === action.oldName ? finalName : c)),
        cards: deck.cards.map((c) => (c.category === action.oldName ? { ...c, category: finalName } : c)),
      })
    }

    case 'REMOVE_CATEGORY':
      return touch({
        ...deck,
        categories: deck.categories.filter((c) => c !== action.name),
        cards: deck.cards.map((c) => (c.category === action.name ? { ...c, category: undefined } : c)),
      })

    case 'SET_CARD_CATEGORY':
      return touch({
        ...deck,
        cards: deck.cards.map((c) =>
          c.scryfallId === action.scryfallId && c.board === action.board ? { ...c, category: action.category } : c,
        ),
      })

    case 'SET_COMMANDER':
      return touch({
        ...deck,
        cards: deck.cards.map((c) =>
          c.scryfallId === action.scryfallId && c.board === action.board ? { ...c, isCommander: action.isCommander } : c,
        ),
      })

    case 'SET_CARD_MARK':
      return touch({
        ...deck,
        cards: deck.cards.map((c) => (c.scryfallId === action.scryfallId && c.board === action.board ? { ...c, mark: action.mark } : c)),
      })

    case 'SET_CARD_FOIL':
      return touch({
        ...deck,
        cards: deck.cards.map((c) => (c.scryfallId === action.scryfallId && c.board === action.board ? { ...c, foil: action.foil } : c)),
      })

    default:
      return deck
  }
}

export function createEmptyDeck(name: string): Deck {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name,
    cards: [],
    categories: [],
    createdAt: now,
    updatedAt: now,
  }
}
