import { describe, expect, it } from 'vitest'
import { matchParsedCards, parseArchidektDeckId, parseArchidektDeckJson, parseArchidektExport, type ParsedDeckCard } from './deckImport'

describe('parseArchidektExport', () => {
  it('parses a plain card line with a single category tag', () => {
    const [card] = parseArchidektExport('1x Abzan Beastmaster (frf) 119 [Draw]')
    expect(card).toEqual({
      quantity: 1,
      name: 'Abzan Beastmaster',
      set: 'frf',
      collectorNumber: '119',
      category: 'Draw',
      isCommander: false,
      isMaybeboard: false,
      sourceLine: '1x Abzan Beastmaster (frf) 119 [Draw]',
    })
  })

  it('parses a split-card name containing " // "', () => {
    const [card] = parseArchidektExport('1x Sagu Wildling // Roost Seek (tdm) 157 [Ramp]')
    expect(card.name).toBe('Sagu Wildling // Roost Seek')
    expect(card.category).toBe('Ramp')
  })

  it('parses a hyphenated "The List" style collector number', () => {
    const [card] = parseArchidektExport('1x Arc Lightning (plst) USG-174 [Maybeboard{noDeck}{noPrice},Burn]')
    expect(card.collectorNumber).toBe('USG-174')
    expect(card.isMaybeboard).toBe(true)
    expect(card.category).toBe('Burn')
  })

  it('strips {sub-marker} suffixes from tags and still finds the real category', () => {
    const [card] = parseArchidektExport('1x Sol Ring (tmc) 59 [Maybeboard{noDeck}{noPrice},Ramp]')
    expect(card.isMaybeboard).toBe(true)
    expect(card.category).toBe('Ramp')
  })

  it('treats a custom category marked {noDeck} as maybeboard, not just the literal "Maybeboard" tag', () => {
    const [card] = parseArchidektExport('1x Adaptive Omnitool (drc) 16 [Chaseboard{noDeck}{noPrice}]')
    expect(card.isMaybeboard).toBe(true)
    expect(card.category).toBe('Chaseboard')
  })

  it('flags maybeboard when only one of several tags carries {noDeck}', () => {
    const [card] = parseArchidektExport(
      '1x Triton Shorestalker (otc) 121 [Maybeboard{noDeck}{noPrice},Chaseboard{noDeck}{noPrice},Evasion]',
    )
    expect(card.isMaybeboard).toBe(true)
    expect(card.category).toBe('Chaseboard')
  })

  it('flags the commander tag and leaves category unset when Commander is the only tag', () => {
    const [card] = parseArchidektExport('1x Tannuk, Memorial Ensign (eoe) 233 [Commander{top}]')
    expect(card.isCommander).toBe(true)
    expect(card.isMaybeboard).toBe(false)
    expect(card.category).toBeUndefined()
  })

  it('parses a basic land line with a large quantity', () => {
    const [card] = parseArchidektExport('16x Forest (tmt) 195 [Land]')
    expect(card.quantity).toBe(16)
    expect(card.name).toBe('Forest')
    expect(card.category).toBe('Land')
  })

  it('lowercases the set code', () => {
    const [card] = parseArchidektExport('1x Evolving Wilds (ECL) 264 [Land]')
    expect(card.set).toBe('ecl')
  })

  it('skips lines that do not match the expected format instead of throwing', () => {
    const cards = parseArchidektExport('not a real decklist line\n\n1x Fog (m11) 173 [Protection]')
    expect(cards).toHaveLength(1)
    expect(cards[0].name).toBe('Fog')
  })

  it('keeps the trimmed original line as sourceLine, for surfacing next to a failed match', () => {
    const [card] = parseArchidektExport('  1x Fog (m11) 173 [Protection]  ')
    expect(card.sourceLine).toBe('1x Fog (m11) 173 [Protection]')
  })

  it('parses multiple lines in order', () => {
    const text = ['1x Fog (m11) 173 [Protection]', '1x Lightning Strike (m19) 152 [Burn]'].join('\n')
    const cards = parseArchidektExport(text)
    expect(cards.map((c) => c.name)).toEqual(['Fog', 'Lightning Strike'])
  })

  // Archidekt's "Include foil indicator" export option (on by default) inserts a bare "*F*" token
  // right after the collector number for any card marked foil — previously this made the whole
  // line fail to match and the card silently vanished from the import.
  it('parses a line carrying Archidekt\'s foil indicator', () => {
    const [card] = parseArchidektExport('1x Kalemne, Disciple of Iroas (cm2) 7 *F* [Counters]')
    expect(card).toEqual({
      quantity: 1,
      name: 'Kalemne, Disciple of Iroas',
      set: 'cm2',
      collectorNumber: '7',
      category: 'Counters',
      isCommander: false,
      isMaybeboard: false,
      sourceLine: '1x Kalemne, Disciple of Iroas (cm2) 7 *F* [Counters]',
    })
  })

  it('parses a foil line with no category tags at all', () => {
    const [card] = parseArchidektExport('1x Kalemne, Disciple of Iroas (cm2) 7 *F*')
    expect(card.name).toBe('Kalemne, Disciple of Iroas')
    expect(card.collectorNumber).toBe('7')
    expect(card.category).toBeUndefined()
  })

  // Archidekt's "Include color tag data" export option (also on by default) appends a
  // "^Label,#rrggbb^" suffix for any card with a color tag set — likewise ignored, not stored.
  it('parses a line carrying Archidekt\'s trailing color-tag data', () => {
    const [card] = parseArchidektExport('1x Sol Ring (lea) 1 [Ramp] ^Buy,#0066ff^')
    expect(card.name).toBe('Sol Ring')
    expect(card.category).toBe('Ramp')
  })

  it('parses a line carrying both the foil indicator and color-tag data together', () => {
    const [card] = parseArchidektExport('1x Kalemne, Disciple of Iroas (cm2) 7 *F* [Counters] ^Buy,#0066ff^')
    expect(card.name).toBe('Kalemne, Disciple of Iroas')
    expect(card.collectorNumber).toBe('7')
    expect(card.category).toBe('Counters')
  })
})

describe('parseArchidektDeckId', () => {
  it('extracts the id from a full deck url with a slug', () => {
    expect(parseArchidektDeckId('https://archidekt.com/decks/19263728/ardeyhardy_blue')).toBe('19263728')
  })

  it('extracts the id from a url without a trailing slug', () => {
    expect(parseArchidektDeckId('https://archidekt.com/decks/19263728')).toBe('19263728')
  })

  it('extracts the id from the api url form', () => {
    expect(parseArchidektDeckId('https://archidekt.com/api/decks/19263728/')).toBe('19263728')
  })

  it('accepts a bare numeric id', () => {
    expect(parseArchidektDeckId('  19263728 ')).toBe('19263728')
  })

  it('returns null for a non-archidekt or malformed link', () => {
    expect(parseArchidektDeckId('https://moxfield.com/decks/abc')).toBeNull()
    expect(parseArchidektDeckId('just some text')).toBeNull()
  })
})

describe('parseArchidektDeckJson', () => {
  const deck = {
    name: 'ArdeyHardy Blue',
    categories: [
      { name: 'Commander', includedInDeck: true },
      { name: 'Maybeboard', includedInDeck: false },
      { name: 'Considering', includedInDeck: false },
      { name: 'Draw', includedInDeck: true },
    ],
    cards: [
      { quantity: 1, categories: ['Commander'], card: { collectorNumber: '13', oracleCard: { name: 'Ardenn' }, edition: { editioncode: 'FIC' } } },
      { quantity: 1, categories: ['Draw'], card: { collectorNumber: '355', oracleCard: { name: 'Swiftfoot Boots' }, edition: { editioncode: 'fdn' } } },
      { quantity: 1, categories: ['Maybeboard', 'Support', 'Draw'], card: { collectorNumber: '51', oracleCard: { name: 'Puresteel Paladin' }, edition: { editioncode: 'cmm' } } },
      { quantity: 20, categories: ['Land'], card: { collectorNumber: '276', oracleCard: { name: 'Island' }, edition: { editioncode: 'znr' } } },
    ],
  }

  it('returns the deck name', () => {
    expect(parseArchidektDeckJson(deck).name).toBe('ArdeyHardy Blue')
  })

  it('flags the commander and leaves its category unset', () => {
    const ardenn = parseArchidektDeckJson(deck).cards.find((c) => c.name === 'Ardenn')!
    expect(ardenn.isCommander).toBe(true)
    expect(ardenn.category).toBeUndefined()
  })

  it('leaves sourceLine unset — there is no raw text line for a JSON/API import', () => {
    const ardenn = parseArchidektDeckJson(deck).cards.find((c) => c.name === 'Ardenn')!
    expect(ardenn.sourceLine).toBeUndefined()
  })

  it('treats cards in any not-included category as maybeboard but keeps a functional category', () => {
    const puresteel = parseArchidektDeckJson(deck).cards.find((c) => c.name === 'Puresteel Paladin')!
    expect(puresteel.isMaybeboard).toBe(true)
    // First tag that is neither Commander nor an excluded category.
    expect(puresteel.category).toBe('Support')
  })

  it('lowercases the set code and preserves quantity and collector number', () => {
    const island = parseArchidektDeckJson(deck).cards.find((c) => c.name === 'Island')!
    expect(island).toMatchObject({ set: 'znr', collectorNumber: '276', quantity: 20, isMaybeboard: false })
  })

  it('skips entries missing a name, set, or collector number', () => {
    const partial = {
      cards: [
        { quantity: 1, categories: [], card: { collectorNumber: '1', oracleCard: null, edition: { editioncode: 'abc' } } },
        { quantity: 1, categories: [], card: { collectorNumber: '2', oracleCard: { name: 'Good Card' }, edition: { editioncode: 'abc' } } },
      ],
    }
    const cards = parseArchidektDeckJson(partial).cards
    expect(cards).toHaveLength(1)
    expect(cards[0].name).toBe('Good Card')
  })
})

describe('matchParsedCards', () => {
  function parsedCard(overrides: Partial<ParsedDeckCard> & Pick<ParsedDeckCard, 'set' | 'collectorNumber'>): ParsedDeckCard {
    return { quantity: 1, name: 'Plains', isCommander: false, isMaybeboard: false, ...overrides }
  }

  // Real bug: a deck running two different printings/arts of the same card (reported as two sets
  // of 6 Plains, different arts, imported as a plain-text export) used to collapse both entries
  // onto whichever Scryfall card object happened to survive a name-keyed correlation map — one
  // printing's copies silently vanished. Correlating by (set, collector_number) instead — the
  // exact identifiers used to request them — keeps both printings distinct.
  it('keeps two different printings of the same-named card as separate matches', () => {
    const parsed = [parsedCard({ quantity: 6, set: 'lea', collectorNumber: '281' }), parsedCard({ quantity: 6, set: 'sld', collectorNumber: '500' })]
    const resolved = [
      { id: 'card-lea', name: 'Plains', set: 'lea', collector_number: '281' },
      { id: 'card-sld', name: 'Plains', set: 'sld', collector_number: '500' },
    ]
    const { matches, missing } = matchParsedCards(parsed, resolved)
    expect(missing).toHaveLength(0)
    expect(matches).toHaveLength(2)
    expect(matches.find((m) => m.parsed.set === 'lea')?.card.id).toBe('card-lea')
    expect(matches.find((m) => m.parsed.set === 'sld')?.card.id).toBe('card-sld')
  })

  it('matches set case-insensitively', () => {
    const parsed = [parsedCard({ set: 'lea', collectorNumber: '281' })]
    const resolved = [{ id: 'card-lea', name: 'Plains', set: 'LEA', collector_number: '281' }]
    const { matches } = matchParsedCards(parsed, resolved)
    expect(matches).toHaveLength(1)
  })

  it('reports an entry as missing when no resolved card matches its identifier', () => {
    const parsed = [parsedCard({ set: 'xyz', collectorNumber: '999' })]
    const { matches, missing } = matchParsedCards(parsed, [])
    expect(matches).toHaveLength(0)
    expect(missing).toEqual(parsed)
  })

  it('does not let one entry\'s collector number match another set\'s same-numbered card', () => {
    const parsed = [parsedCard({ set: 'lea', collectorNumber: '281' })]
    const resolved = [{ id: 'wrong-set', name: 'Plains', set: 'sld', collector_number: '281' }]
    const { matches, missing } = matchParsedCards(parsed, resolved)
    expect(matches).toHaveLength(0)
    expect(missing).toHaveLength(1)
  })
})
