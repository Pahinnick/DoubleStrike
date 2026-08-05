export type PreconDeckCard = {
  name: string
  quantity: number
  isCommander?: boolean
}

/**
 * A small mono-red Commander precon — singleton, exactly 100 cards including the commander —
 * used only to seed the deck-building tutorial (see loadTutorialPreconDeck.ts) when it starts on
 * a genuinely empty deck. Without this, the tour's Playtest section would have nothing to
 * goldfish and its deck-building steps would have nothing to show a legality warning on if the
 * user actually adds a card along the way. Every name below is a real, commander-legal,
 * mono-red-or-colorless card, verified against Scryfall's /cards/collection endpoint — the
 * exact-name lookup loadTutorialPreconDeck.ts uses to resolve them.
 */
export const TUTORIAL_PRECON_DECK: PreconDeckCard[] = [
  { name: 'Krenko, Mob Boss', quantity: 1, isCommander: true },
  { name: 'Lightning Bolt', quantity: 1 },
  { name: 'Shock', quantity: 1 },
  { name: 'Chain Lightning', quantity: 1 },
  { name: 'Goblin Bombardment', quantity: 1 },
  { name: 'Skirk Prospector', quantity: 1 },
  { name: 'Siege-Gang Commander', quantity: 1 },
  { name: 'Goblin Rabblemaster', quantity: 1 },
  { name: 'Hazoret the Fervent', quantity: 1 },
  { name: 'Purphoros, God of the Forge', quantity: 1 },
  { name: 'Zealous Conscripts', quantity: 1 },
  { name: 'Fireball', quantity: 1 },
  { name: 'Fervor', quantity: 1 },
  { name: 'Wheel of Fortune', quantity: 1 },
  { name: 'Faithless Looting', quantity: 1 },
  { name: 'Sol Ring', quantity: 1 },
  { name: 'Arcane Signet', quantity: 1 },
  { name: 'Mind Stone', quantity: 1 },
  { name: 'Worn Powerstone', quantity: 1 },
  { name: 'Swiftfoot Boots', quantity: 1 },
  { name: 'Lightning Greaves', quantity: 1 },
  { name: 'Shivan Dragon', quantity: 1 },
  { name: 'Goblin Chieftain', quantity: 1 },
  { name: "Krenko's Command", quantity: 1 },
  { name: 'Goblin Warchief', quantity: 1 },
  { name: 'Goblin King', quantity: 1 },
  { name: 'Goblin Matron', quantity: 1 },
  { name: 'Krenko, Tin Street Kingpin', quantity: 1 },
  { name: 'Reckless Fireweaver', quantity: 1 },
  { name: 'Impact Tremors', quantity: 1 },
  { name: "Purphoros's Emissary", quantity: 1 },
  { name: 'Thundering Raiju', quantity: 1 },
  { name: 'Goblin Engineer', quantity: 1 },
  { name: 'Goblin Welder', quantity: 1 },
  { name: 'Conspicuous Snoop', quantity: 1 },
  { name: 'Muxus, Goblin Grandee', quantity: 1 },
  { name: 'Kiki-Jiki, Mirror Breaker', quantity: 1 },
  { name: 'Sneak Attack', quantity: 1 },
  { name: 'Feldon of the Third Path', quantity: 1 },
  { name: 'Solemn Simulacrum', quantity: 1 },
  { name: 'Burnished Hart', quantity: 1 },
  { name: 'Skullclamp', quantity: 1 },
  { name: 'Basilisk Collar', quantity: 1 },
  { name: 'Cursed Mirror', quantity: 1 },
  { name: 'Thousand-Year Elixir', quantity: 1 },
  { name: "Ashnod's Altar", quantity: 1 },
  { name: 'Phyrexian Altar', quantity: 1 },
  { name: 'Goblin Sledder', quantity: 1 },
  { name: 'Goblin Marshal', quantity: 1 },
  { name: 'Goblin Trashmaster', quantity: 1 },
  { name: 'Mogg War Marshal', quantity: 1 },
  // Basic lands are exempt from the singleton rule, so one big stack fills out the rest of the
  // 100 without needing 49 more distinct spell names.
  { name: 'Mountain', quantity: 49 },
]
