import { useEffect, useRef, useState } from 'react'

export type RadioStation = { id: string; label: string; emoji: string; streamUrl: string }

/** A small curated set of SomaFM's free, commercial-free internet radio stations — direct
 *  stream URLs meant for exactly this kind of third-party embedding (no API key, no OAuth,
 *  just a plain <audio> src), confirmed against each station's official .pls playlist at
 *  https://somafm.com/<id>.pls (the short-form https://ice.somafm.com/<id> from SomaFM's own
 *  "direct stream links" docs 404s as of this writing — the actual live endpoint needs the
 *  `-128-mp3` suffix and a specific ice-server subdomain). Picked for "background game night"
 *  vibes that won't fight for attention with the table talk. */
export const RADIO_STATIONS: RadioStation[] = [
  { id: 'groovesalad', label: 'Groove Salad', emoji: '🎧', streamUrl: 'https://ice6.somafm.com/groovesalad-128-mp3' },
  { id: 'dronezone', label: 'Drone Zone', emoji: '🌌', streamUrl: 'https://ice6.somafm.com/dronezone-128-mp3' },
  { id: 'lush', label: 'Lush', emoji: '💜', streamUrl: 'https://ice6.somafm.com/lush-128-mp3' },
  { id: 'covers', label: 'Covers', emoji: '🎤', streamUrl: 'https://ice6.somafm.com/covers-128-mp3' },
  { id: 'thistle', label: 'Thistle Radio', emoji: '🍀', streamUrl: 'https://ice6.somafm.com/thistle-128-mp3' },
  { id: 'digitalis', label: 'Digitalis', emoji: '🤖', streamUrl: 'https://ice6.somafm.com/digitalis-128-mp3' },
]

const VOLUME_KEY = 'mtgdb:radioVolume'

function getStoredVolume(): number {
  const stored = Number(localStorage.getItem(VOLUME_KEY))
  return Number.isFinite(stored) && stored > 0 && stored <= 1 ? stored : 0.4
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

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume))
  }, [volume])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume, station])

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
      {current && <audio key={current.id} ref={audioRef} src={current.streamUrl} autoPlay />}
    </div>
  )
}

export default TableRadio
