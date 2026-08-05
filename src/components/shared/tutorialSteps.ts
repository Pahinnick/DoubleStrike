export type TutorialStep = {
  id: string
  /** Which top-level view this step's target lives in — the tour drives navigation itself
   *  (see App.tsx syncing playtestOpen to this) rather than waiting for the user to click there. */
  view: 'editor' | 'playtest'
  /** Matches a `data-tutorial-id` attribute on the target element, queried live at step time. */
  target: string
  title: string
  body: string
  /** Whether the Playtest Actions tray should be forced open for this step (steps that
   *  point inside it) — forced shut on every other Playtest step so it doesn't linger open. */
  actionsTrayOpen?: boolean
  /** Editor-only panel state the tour forces for this step (see App.tsx) — undefined leaves it
   *  alone. Both start forced shut for the opening deck-building steps (rather than whatever the
   *  Search/Stats panels happened to be left at) so the tour can introduce each one as a
   *  deliberate step instead of however the app happened to already look. Meaningless on
   *  'playtest' steps, which have no such panels, so never set there. */
  searchExpanded?: boolean
  statsExpanded?: boolean
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'search-tab',
    view: 'editor',
    target: 'search-tab',
    title: 'Start with Search',
    body: "This is where you'll find cards — click to expand it and search Scryfall's whole database.",
    searchExpanded: false,
    statsExpanded: false,
  },
  {
    id: 'search-input',
    view: 'editor',
    target: 'search-input',
    title: 'Search for a card',
    body: 'Type a name (or part of one) here — results update as you type, filtered to colors, type, and more.',
    searchExpanded: true,
    statsExpanded: false,
  },
  {
    id: 'search-add',
    view: 'editor',
    target: 'search-pane',
    title: 'Add it to your deck',
    body: 'Left-click a result to add it straight to your mainboard, or drag it onto a category, the sideboard, or anywhere in the deck panel.',
    searchExpanded: true,
    statsExpanded: false,
  },
  {
    id: 'deck-layout',
    view: 'editor',
    target: 'deck-layout-toggle',
    title: 'List or Grid',
    body: 'Switch your deck between a compact List and a visual Grid of card images, whichever you prefer while building.',
    searchExpanded: true,
    statsExpanded: false,
  },
  {
    id: 'deck-boards',
    view: 'editor',
    target: 'board-tabs',
    title: 'Mainboard and Sideboard',
    body: 'Your deck has two separate lists — flip between them here, or move a card between them from its own menu.',
    searchExpanded: true,
    statsExpanded: false,
  },
  {
    id: 'deck-categories',
    view: 'editor',
    target: 'manage-categories-button',
    title: 'Categories',
    body: "Cards auto-categorize by type as you add them. Manage your own custom categories here, and drag a card onto one in the list to reassign it.",
    searchExpanded: true,
    statsExpanded: false,
  },
  {
    id: 'deck-similar-card',
    view: 'editor',
    target: 'deck-list',
    title: 'Find similar cards',
    body: 'Right-click any card — in search results or in your deck — to browse similar cards by Scryfall tag.',
    searchExpanded: true,
    statsExpanded: false,
  },
  {
    id: 'deck-similar-category',
    view: 'editor',
    target: 'deck-uncategorized',
    title: 'Recommendations by category',
    body: 'New cards land in Uncategorized until you sort them. Once a card is in a real category, right-click that category\'s header for recommendations based on what already fits there.',
    searchExpanded: true,
    statsExpanded: false,
  },
  {
    id: 'stats-tab',
    view: 'editor',
    target: 'stats-tab',
    title: 'Deck Stats',
    body: 'Click to expand Stats — a live breakdown of your deck as you build it.',
    searchExpanded: false,
    statsExpanded: false,
  },
  {
    id: 'stats-price-salt',
    view: 'editor',
    target: 'stats-price-salt',
    title: 'Price and salt',
    body: "Estimated total price and EDHREC's salt score (how much this deck might annoy your playgroup), both updating live as you build.",
    searchExpanded: false,
    statsExpanded: true,
  },
  {
    id: 'stats-charts',
    view: 'editor',
    target: 'stats-charts',
    title: 'Curve and colors',
    body: "Mana curve and color balance at a glance — scroll down further for mana base suggestions and each card's average castable turn.",
    searchExpanded: false,
    statsExpanded: true,
  },
  {
    id: 'playtest-button',
    view: 'editor',
    target: 'playtest-button',
    title: 'Playtest your deck',
    body: 'Click Playtest to goldfish solo — draw hands, play cards, and try out your build before a real game.',
    searchExpanded: false,
    statsExpanded: true,
  },
  {
    id: 'multiplayer-button',
    view: 'playtest',
    target: 'multiplayer-button',
    title: 'Play with others',
    body: 'From inside Playtest, Multiplayer hosts or joins a pod so you can play a real game with friends.',
  },
  {
    id: 'actions-button',
    view: 'playtest',
    target: 'actions-button',
    title: 'The Actions menu',
    body: 'Scry, Surveil, Cascade, tutoring, dice, coin flips, and more all live in one place here.',
    actionsTrayOpen: true,
  },
  {
    id: 'shuffle-library',
    view: 'playtest',
    target: 'action-shuffle-library',
    title: 'Shuffle Library',
    body: 'One of the actions in that menu — reshuffles your deck.',
    actionsTrayOpen: true,
  },
  {
    id: 'library-pile',
    view: 'playtest',
    target: 'library-pile',
    title: 'Or skip the menu entirely',
    body: 'Hover the library and press R to shuffle instantly, without opening Actions. Most actions have a faster alternative like this — check Shortcuts for the full list.',
    actionsTrayOpen: false,
  },
  {
    id: 'shortcuts-button',
    view: 'playtest',
    target: 'shortcuts-button',
    title: 'Full shortcut list',
    body: 'This ❓ button (or just pressing ?) opens every keyboard and mouse shortcut in Playtest.',
    actionsTrayOpen: false,
  },
  {
    id: 'help-button',
    view: 'editor',
    target: 'help-button',
    title: 'Help, anytime',
    body: "Back in the deck editor, this ? button covers profiles, controls, and where your decks are saved. You can replay this tour from there too.",
  },
]
