// Small, synthesized UI sound cues (Web Audio oscillators — no external audio files to
// download/bundle). Deliberately quiet and short; muted by default is NOT the goal here,
// but any failure to play must never be fatal to the actual game action it accompanies.

export type SoundCue = 'draw' | 'life-up' | 'life-down' | 'play-card' | 'hover' | 'shuffle'

const MUTE_KEY = 'mtgdb:soundMuted'
const VOLUME = 0.05

let sharedContext: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext
  if (!Ctor) return null
  if (!sharedContext) sharedContext = new Ctor()
  // Browsers start a fresh AudioContext 'suspended' until a user gesture — every cue is
  // itself triggered by a click, so resuming here (a no-op once already running) is safe.
  if (sharedContext.state === 'suspended') void sharedContext.resume()
  return sharedContext
}

export function isSoundMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === 'true'
}

export function setSoundMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, muted ? 'true' : 'false')
}

function tone(freq: number, startOffset: number, duration: number, type: OscillatorType): void {
  const audio = getContext()
  if (!audio) return
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = type
  osc.frequency.value = freq
  const start = audio.currentTime + startOffset
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(VOLUME, start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  gain.connect(audio.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

/** Short burst of high-passed white noise — a tight "tss" rather than a musical tone.
 *  `startOffset` schedules it to begin later in the same audio timeline (seconds from now),
 *  so a caller can stack several bursts into one longer effect — see the `shuffle` cue below. */
function noiseBurst(duration: number, cutoffFreq: number, startOffset = 0): void {
  const audio = getContext()
  if (!audio) return
  const sampleCount = Math.max(1, Math.floor(audio.sampleRate * duration))
  const buffer = audio.createBuffer(1, sampleCount, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < sampleCount; i++) data[i] = Math.random() * 2 - 1

  const source = audio.createBufferSource()
  source.buffer = buffer
  const filter = audio.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = cutoffFreq
  const gain = audio.createGain()
  const start = audio.currentTime + startOffset
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(VOLUME * 0.5, start + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  source.connect(filter)
  filter.connect(gain)
  gain.connect(audio.destination)
  source.start(start)
  source.stop(start + duration + 0.02)
}

const CUES: Record<SoundCue, () => void> = {
  draw: () => tone(720, 0, 0.09, 'triangle'),
  'life-up': () => tone(880, 0, 0.08, 'sine'),
  'life-down': () => tone(220, 0, 0.1, 'sine'),
  'play-card': () => {
    tone(500, 0, 0.06, 'triangle')
    tone(700, 0.05, 0.08, 'triangle')
  },
  hover: () => noiseBurst(0.04, 5000),
  // A riffle: several short noise bursts stuttered in quick succession rather than one long
  // burst, so it reads as the texture of cards flicking past rather than a flat hiss. Cutoff
  // frequency and spacing both jitter slightly so repeated shuffles don't sound identical.
  shuffle: () => {
    const burstCount = 7
    for (let i = 0; i < burstCount; i++) {
      const offset = i * 0.045 + Math.random() * 0.015
      noiseBurst(0.035, 3000 + Math.random() * 2500, offset)
    }
  },
}

export function playCue(cue: SoundCue): void {
  if (isSoundMuted()) return
  try {
    CUES[cue]()
  } catch {
    // Decorative only — a Web Audio failure (unsupported environment, odd browser state)
    // must never interrupt the game action it's attached to.
  }
}
