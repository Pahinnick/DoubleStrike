import { useState } from 'react'

type Props = {
  currentName: string
  onSubmit: (name: string) => void
  onSkip: () => void
}

/** One-time first-run prompt: replaces the silent "Player 1"/"Recovered Profile N" default
 *  with an actual question, so a new player's profile is named on purpose from the start. */
function WelcomeNameModal({ currentName, onSubmit, onSkip }: Props) {
  const [name, setName] = useState('')

  function handleSubmit() {
    onSubmit(name.trim() || currentName)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="modal-content welcome-name" onClick={(event) => event.stopPropagation()}>
        <h2>Welcome!</h2>
        <p className="welcome-name__hint">
          What should we call you? This is the name your friends will see when you play together.
        </p>
        <input
          type="text"
          autoFocus
          placeholder={currentName}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSubmit()
          }}
        />
        <div className="welcome-name__actions">
          <button type="button" onClick={onSkip}>
            Skip for now
          </button>
          <button type="button" onClick={handleSubmit}>
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}

export default WelcomeNameModal
