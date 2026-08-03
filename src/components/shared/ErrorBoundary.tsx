import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="app-loading">
        Something broke. Reloading should recover your board and deck state
        (both autosave), but this crash means something misbehaved — worth reporting.
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
        <span className="app-loading__detail">{error.message}</span>
      </div>
    )
  }
}
