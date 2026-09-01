const DRAFT_FLAG_KEY = 'mtgdb:ff:draftMode'

/** Draft mode is under active development — gate every entry point behind this so it never
 *  reaches normal users before it's finished. Auto-on in dev builds; off by default in a
 *  production build unless a developer sets the localStorage key manually (lets a real release
 *  build be tested without exposing the feature to everyone). Read fresh at call sites rather
 *  than as a hook — nothing here needs a re-render when it changes mid-session. */
export function isDraftModeEnabled(): boolean {
  if (import.meta.env.DEV) return true
  return localStorage.getItem(DRAFT_FLAG_KEY) === 'true'
}
