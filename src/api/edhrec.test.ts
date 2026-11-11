import { afterEach, describe, expect, it, vi } from 'vitest'
import { edhrecSlug, fetchEdhrecCommanderPage } from './edhrec'

type Route = { status?: number; body?: unknown }

/** Stubs global fetch with a slug -> response map, and records the order slugs were requested in. */
function stubCommanderPages(routes: Record<string, Route>) {
  const requested: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const slug = url.split('/').pop()!.replace(/\.json$/, '')
      requested.push(slug)
      const route = routes[slug]
      if (!route) return { ok: false, status: 404 } as Response
      return {
        ok: route.status === undefined || route.status < 400,
        status: route.status ?? 200,
        json: async () => route.body,
      } as Response
    }),
  )
  return requested
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('edhrecSlug', () => {
  it('elides apostrophes rather than hyphenating them', () => {
    expect(edhrecSlug("Atraxa, Praetors' Voice")).toBe('atraxa-praetors-voice')
  })

  it('keeps only the front face of a double-faced card', () => {
    expect(edhrecSlug('Brutal Cathar // Moonrage Brute')).toBe('brutal-cathar')
  })
})

describe('fetchEdhrecCommanderPage', () => {
  const page = { container: { json_dict: { cardlists: [] } } }

  it('returns the payload for a slug that resolves directly', async () => {
    const requested = stubCommanderPages({ 'krenko-mob-boss': { body: page } })
    await expect(fetchEdhrecCommanderPage('krenko-mob-boss')).resolves.toEqual(page)
    expect(requested).toEqual(['krenko-mob-boss'])
  })

  it('follows a redirect to the canonical partner-pair slug', async () => {
    // Verified against the live endpoint: asking for the non-canonical ordering of a partner pair
    // returns a redirect stub rather than page data.
    const requested = stubCommanderPages({
      'tymna-the-weaver-thrasios-triton-hero': { body: { redirect: '/commanders/thrasios-triton-hero-tymna-the-weaver' } },
      'thrasios-triton-hero-tymna-the-weaver': { body: page },
    })
    await expect(fetchEdhrecCommanderPage('tymna-the-weaver-thrasios-triton-hero')).resolves.toEqual(page)
    expect(requested).toEqual(['tymna-the-weaver-thrasios-triton-hero', 'thrasios-triton-hero-tymna-the-weaver'])
  })

  it('gives up on a redirect loop instead of hanging the request queue', async () => {
    const requested = stubCommanderPages({
      a: { body: { redirect: '/commanders/b' } },
      b: { body: { redirect: '/commanders/a' } },
    })
    await expect(fetchEdhrecCommanderPage('a')).resolves.toBeNull()
    // Stops as soon as it revisits a slug it already asked for.
    expect(requested).toEqual(['a', 'b'])
  })

  it('returns null for a commander EDHREC has no page for', async () => {
    stubCommanderPages({})
    await expect(fetchEdhrecCommanderPage('not-a-commander')).resolves.toBeNull()
  })

  it('returns null when a redirect points somewhere that 404s', async () => {
    stubCommanderPages({ a: { body: { redirect: '/commanders/missing' } } })
    await expect(fetchEdhrecCommanderPage('a')).resolves.toBeNull()
  })
})

describe('edhrecSlug — accents', () => {
  it('transliterates accented letters rather than dropping them', () => {
    expect(edhrecSlug('Éomer, King of Rohan')).toBe('eomer-king-of-rohan')
    expect(edhrecSlug("Lim-Dûl's Vault")).toBe('lim-duls-vault')
    expect(edhrecSlug('Barad-dûr')).toBe('barad-dur')
  })
})
