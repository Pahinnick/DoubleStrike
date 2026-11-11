const DRAFT_FLAG_KEY = 'mtgdb:ff:draftMode'

/** Draft mode is released: on for everyone. The localStorage key is kept as an off switch
 *  (`'false'` hides the Draft button), e.g. to rule draft mode out while debugging a report. Read
 *  fresh at call sites rather than as a hook — nothing here needs a re-render when it changes
 *  mid-session. */
export function isDraftModeEnabled(): boolean {
  try {
    return localStorage.getItem(DRAFT_FLAG_KEY) !== 'false'
  } catch {
    return true
  }
}
