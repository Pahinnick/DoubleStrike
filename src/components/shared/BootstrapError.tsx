type Props = {
  message: string
  detail: string
  onRetry: () => void
}

/** Shown in place of an app-loading screen when startup data (profiles, decks) fails to load,
 *  so a stuck load is a visible, retryable error instead of an infinite silent spinner. */
function BootstrapError({ message, detail, onRetry }: Props) {
  return (
    <div className="app-loading">
      <p>{message}</p>
      <p className="app-loading__detail">{detail}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

export default BootstrapError
