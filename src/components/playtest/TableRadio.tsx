import { useCallback, useEffect, useRef, useState } from 'react'

export type RadioStation = { id: string; label: string; emoji: string; streamUrl: string }

/** A small curated set of SomaFM's free, commercial-free internet radio stations — direct
 *  stream URLs meant for exactly this kind of third-party embedding (no API key, no OAuth,
 *  just a plain <audio> src), confirmed against each station's official .pls playlist at
 *  https://somafm.com/<id>.pls (the short-form https://ice.somafm.com/<id> from SomaFM's own
 *  "direct stream links" docs 404s as of this writing — the actual live endpoint needs the
 *  `-128-mp3` suffix and a specific ice-server subdomain). Picked for "background game night"
 *  vibes that won't fight for attention with the table talk. */
export const RADIO_STATIONS: RadioStation[] = [
  { id: 'beatblender', label: 'Beat Blender', emoji: '🎚️', streamUrl: 'https://ice6.somafm.com/beatblender-128-mp3' },
  { id: 'brfm', label: 'Black Rock FM', emoji: '🔥', streamUrl: 'https://ice6.somafm.com/brfm-128-mp3' },
  { id: 'bootliquor', label: 'Boot Liquor', emoji: '🤠', streamUrl: 'https://ice6.somafm.com/bootliquor-320-mp3' },
  { id: 'bossa', label: 'Bossa Beyond', emoji: '🌺', streamUrl: 'https://ice6.somafm.com/bossa-256-mp3' },
  { id: 'chillits', label: 'Chillits Radio', emoji: '⛺', streamUrl: 'https://ice6.somafm.com/chillits-256-mp3' },
  { id: 'cliqhop', label: 'cliqhop idm', emoji: '🎛️', streamUrl: 'https://ice6.somafm.com/cliqhop-256-mp3' },
  { id: 'covers', label: 'Covers', emoji: '🎤', streamUrl: 'https://ice6.somafm.com/covers-128-mp3' },
  { id: 'deepspaceone', label: 'Deep Space One', emoji: '🛰️', streamUrl: 'https://ice6.somafm.com/deepspaceone-128-mp3' },
  { id: 'defcon', label: 'DEF CON Radio', emoji: '💻', streamUrl: 'https://ice6.somafm.com/defcon-256-mp3' },
  { id: 'digitalis', label: 'Digitalis', emoji: '🤖', streamUrl: 'https://ice6.somafm.com/digitalis-128-mp3' },
  { id: 'doomed', label: 'Doomed', emoji: '💀', streamUrl: 'https://ice6.somafm.com/doomed-256-mp3' },
  { id: 'dronezone', label: 'Drone Zone', emoji: '🌌', streamUrl: 'https://ice6.somafm.com/dronezone-128-mp3' },
  { id: 'dz2', label: 'Drone Zone 2', emoji: '🌫️', streamUrl: 'https://ice6.somafm.com/dz2-128-mp3' },
  { id: 'dubstep', label: 'Dub Step Beyond', emoji: '🔊', streamUrl: 'https://ice6.somafm.com/dubstep-256-mp3' },
  { id: 'fluid', label: 'Fluid', emoji: '🌊', streamUrl: 'https://ice6.somafm.com/fluid-128-mp3' },
  { id: 'folkfwd', label: 'Folk Forward', emoji: '🪕', streamUrl: 'https://ice6.somafm.com/folkfwd-128-mp3' },
  { id: 'groovesalad', label: 'Groove Salad', emoji: '🎧', streamUrl: 'https://ice6.somafm.com/groovesalad-128-mp3' },
  { id: 'groovesalad2', label: 'Groove Salad 2', emoji: '🥗', streamUrl: 'https://ice6.somafm.com/groovesalad2-256-mp3' },
  { id: 'gsclassic', label: 'Groove Salad Classic', emoji: '🕰️', streamUrl: 'https://ice6.somafm.com/gsclassic-128-mp3' },
  { id: 'reggae', label: 'Heavyweight Reggae', emoji: '🥁', streamUrl: 'https://ice6.somafm.com/reggae-256-mp3' },
  { id: 'illstreet', label: 'Illinois Street Lounge', emoji: '🥂', streamUrl: 'https://ice6.somafm.com/illstreet-128-mp3' },
  { id: 'indiepop', label: 'Indie Pop Rocks!', emoji: '🎸', streamUrl: 'https://ice6.somafm.com/indiepop-128-mp3' },
  { id: 'seventies', label: 'Left Coast 70s', emoji: '🕺', streamUrl: 'https://ice6.somafm.com/seventies-320-mp3' },
  { id: 'lush', label: 'Lush', emoji: '💜', streamUrl: 'https://ice6.somafm.com/lush-128-mp3' },
  { id: 'metal', label: 'Metal Detector', emoji: '🤘', streamUrl: 'https://ice6.somafm.com/metal-128-mp3' },
  { id: 'missioncontrol', label: 'Mission Control', emoji: '🚀', streamUrl: 'https://ice6.somafm.com/missioncontrol-128-mp3' },
  { id: 'n5md', label: 'n5MD Radio', emoji: '🎼', streamUrl: 'https://ice6.somafm.com/n5md-128-mp3' },
  { id: 'poptron', label: 'PopTron', emoji: '✨', streamUrl: 'https://ice6.somafm.com/poptron-128-mp3' },
  { id: 'secretagent', label: 'Secret Agent', emoji: '🕵️', streamUrl: 'https://ice6.somafm.com/secretagent-128-mp3' },
  { id: '7soul', label: 'Seven Inch Soul', emoji: '💿', streamUrl: 'https://ice6.somafm.com/7soul-128-mp3' },
  { id: 'sf1033', label: 'SF 10-33', emoji: '📡', streamUrl: 'https://ice6.somafm.com/sf1033-128-mp3' },
  { id: 'sfinsf', label: 'SF in SF', emoji: '📖', streamUrl: 'https://ice6.somafm.com/sfinsf-128-mp3' },
  { id: 'live', label: 'SomaFM Live', emoji: '🎪', streamUrl: 'https://ice6.somafm.com/live-128-mp3' },
  { id: 'specials', label: 'SomaFM Specials', emoji: '🎁', streamUrl: 'https://ice6.somafm.com/specials-128-mp3' },
  { id: 'sonicuniverse', label: 'Sonic Universe', emoji: '🎷', streamUrl: 'https://ice6.somafm.com/sonicuniverse-256-mp3' },
  { id: 'spacestation', label: 'Space Station Soma', emoji: '🛸', streamUrl: 'https://ice6.somafm.com/spacestation-320-mp3' },
  { id: 'suburbsofgoa', label: 'Suburbs of Goa', emoji: '🌏', streamUrl: 'https://ice6.somafm.com/suburbsofgoa-128-mp3' },
  { id: 'synphaera', label: 'Synphaera Radio', emoji: '🎹', streamUrl: 'https://ice6.somafm.com/synphaera-256-mp3' },
  { id: 'darkzone', label: 'The Dark Zone', emoji: '🕳️', streamUrl: 'https://ice6.somafm.com/darkzone-256-mp3' },
  { id: 'insound', label: 'The In-Sound', emoji: '🎨', streamUrl: 'https://ice6.somafm.com/insound-256-mp3' },
  { id: 'thetrip', label: 'The Trip', emoji: '🌀', streamUrl: 'https://ice6.somafm.com/thetrip-128-mp3' },
  { id: 'thistle', label: 'Thistle Radio', emoji: '🍀', streamUrl: 'https://ice6.somafm.com/thistle-128-mp3' },
  { id: 'tikitime', label: 'Tiki Time', emoji: '🍹', streamUrl: 'https://ice6.somafm.com/tikitime-256-mp3' },
  { id: 'u80s', label: 'Underground 80s', emoji: '📼', streamUrl: 'https://ice6.somafm.com/u80s-256-mp3' },
  { id: 'vaporwaves', label: 'Vaporwaves', emoji: '🌴', streamUrl: 'https://ice6.somafm.com/vaporwaves-128-mp3' },
]

const VOLUME_KEY = 'mtgdb:radioVolume'
// Background music behind table talk, not the main event — quiet by default. (Only used the
// first time anyone opens the radio on a given machine; localStorage remembers it after that.)
const DEFAULT_VOLUME = 0.15
const MAX_PLAY_RETRIES = 3
const RETRY_DELAY_MS = 1500

function getStoredVolume(): number {
  const stored = Number(localStorage.getItem(VOLUME_KEY))
  return Number.isFinite(stored) && stored > 0 && stored <= 1 ? stored : DEFAULT_VOLUME
}

type Props = {
  /** Station id from RADIO_STATIONS, or null when off — shared/broadcast (see PlaytestView),
   *  same as a real radio sitting on the table: anyone can change it, and it's the same
   *  station for everyone. */
  station: string | null
  onChangeStation: (station: string | null) => void
}

/** A shared internet radio, fixed just below the topbar — deliberately viewport chrome (like
 *  .playtest__player-panel) rather than a table-space object: everyone in the pod sees/hears
 *  the same station (see PlaytestView's radioStation/broadcastRadio), but "off the felt" needs
 *  a position that's reliably visible regardless of camera pan/zoom or window size, which only
 *  fixed placement guarantees. Volume is deliberately local-only (like turning down your own TV
 *  while everyone watches the same channel) — never broadcast, so it's plain component state,
 *  not part of the wire protocol. Actual playback needs no sync logic at all: since every
 *  station is a live broadcast, everyone pointing their own <audio> at the same stream URL is
 *  inherently listening together already, same as a real radio. */
function TableRadio({ station, onChangeStation }: Props) {
  const [open, setOpen] = useState(false)
  const [volume, setVolume] = useState(getStoredVolume)
  const audioRef = useRef<HTMLAudioElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // Bounded retry budget for whichever station is CURRENTLY selected — reset on every station
  // change (a fresh pick deserves a fresh set of attempts) and again on every successful resume
  // (so occasional drops over a long session don't eventually exhaust a fixed lifetime budget).
  const retryCountRef = useRef(0)

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume))
  }, [volume])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume, station])

  // Icecast streams occasionally drop mid-connection — nothing to do with this app, the same
  // thing happens playing the same URL in a plain browser tab. Previously the <audio> element had
  // no error/stall handling at all, so a dropped connection just went silent forever with no way
  // to notice or recover short of manually toggling the station off and back on. Retries a bounded
  // number of times with a short, increasing backoff, then gives up rather than hammering a
  // station that's genuinely down.
  const attemptPlay = useCallback((audio: HTMLAudioElement) => {
    audio.play().catch(() => {
      if (retryCountRef.current >= MAX_PLAY_RETRIES) return
      const attemptNumber = retryCountRef.current
      retryCountRef.current += 1
      window.setTimeout(() => {
        audio.load()
        attemptPlay(audio)
      }, RETRY_DELAY_MS * (attemptNumber + 1))
    })
  }, [])

  // Drives playback explicitly (no `autoplay` attribute) so a failed attempt is actually visible
  // to attemptPlay's retry logic instead of silently rejecting a promise nobody's listening to.
  useEffect(() => {
    retryCountRef.current = 0
    if (audioRef.current) attemptPlay(audioRef.current)
  }, [station, attemptPlay])

  // Dismiss on any outside click, same pattern as CardContextMenu — skip the tick that opened
  // it so the same click doesn't immediately close it again.
  useEffect(() => {
    if (!open) return
    function dismissIfOutside(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const id = requestAnimationFrame(() => window.addEventListener('pointerdown', dismissIfOutside))
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('pointerdown', dismissIfOutside)
    }
  }, [open])

  const current = RADIO_STATIONS.find((s) => s.id === station) ?? null

  return (
    <div ref={rootRef} className="table-radio">
      <button
        type="button"
        className={`table-radio__body ${current ? 'is-playing' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="Table radio"
        title={current ? `Radio: ${current.label} (click to change)` : 'Radio — off (click to pick a station)'}
      >
        <span aria-hidden="true">📻</span>
        {current && <span className="table-radio__wave" aria-hidden="true" />}
      </button>
      {open && (
        <div className="table-radio__panel" role="menu" aria-label="Pick a radio station">
          {/* Scrolls independently of the volume control below — 45 stations doesn't fit on
             screen as a flat list, but the volume slider should stay put rather than scroll away
             with whatever station happens to be in view. */}
          <div className="table-radio__stations">
            <button
              type="button"
              className={`table-radio__option ${!current ? 'is-active' : ''}`}
              onClick={() => {
                onChangeStation(null)
                setOpen(false)
              }}
            >
              Off
            </button>
            {RADIO_STATIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`table-radio__option ${station === s.id ? 'is-active' : ''}`}
                onClick={() => {
                  onChangeStation(s.id)
                  setOpen(false)
                }}
              >
                {s.emoji} {s.label}
              </button>
            ))}
          </div>
          <label className="table-radio__volume" title="Volume (just your own — everyone controls their own speakers)">
            🔉
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </label>
        </div>
      )}
      {current && (
        <audio
          key={current.id}
          ref={audioRef}
          src={current.streamUrl}
          onError={(event) => attemptPlay(event.currentTarget)}
          onStalled={(event) => attemptPlay(event.currentTarget)}
          onPlaying={() => {
            retryCountRef.current = 0
          }}
        />
      )}
    </div>
  )
}

export default TableRadio
