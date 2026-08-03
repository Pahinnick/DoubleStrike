// Generates release/SHA256SUMS.txt for the distributable build artifacts.
//
// Output uses the standard `sha256sum` format ("<hex><two spaces><filename>") so it can be
// verified directly with `sha256sum -c SHA256SUMS.txt` on macOS/Linux/Git Bash, rather than
// being a bespoke format people have to eyeball by hand.
//
// Usage:
//   npm run checksums              # every distributable in release/
//   npm run checksums -- 1.0.0     # only artifacts whose filename contains "1.0.0"
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

const RELEASE_DIR = 'release'
const OUTPUT_FILE = path.join(RELEASE_DIR, 'SHA256SUMS.txt')
// Installers/portables only. Deliberately excludes electron-builder's own sidecar files
// (*.yml, *.blockmap) — those are auto-update metadata, not things a person downloads.
const DISTRIBUTABLE = /\.(exe|dmg|zip|AppImage|deb|rpm|msi)$/i

/** Streamed so an 80MB installer never has to sit in memory. */
async function sha256(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

const filter = process.argv[2]

let entries
try {
  entries = await readdir(RELEASE_DIR, { withFileTypes: true })
} catch {
  console.error(`No ${RELEASE_DIR}/ directory — run "npm run electron:build" first.`)
  process.exit(1)
}

const files = entries
  .filter((e) => e.isFile() && DISTRIBUTABLE.test(e.name))
  .map((e) => e.name)
  .filter((name) => !filter || name.includes(filter))
  .sort()

if (files.length === 0) {
  console.error(filter ? `No distributables in ${RELEASE_DIR}/ matching "${filter}".` : `No distributables found in ${RELEASE_DIR}/.`)
  process.exit(1)
}

const lines = []
for (const name of files) {
  const digest = await sha256(path.join(RELEASE_DIR, name))
  lines.push(`${digest}  ${name}`)
  console.log(`${digest}  ${name}`)
}

await writeFile(OUTPUT_FILE, lines.join('\n') + '\n', 'utf-8')
console.log(`\nWrote ${files.length} checksum${files.length === 1 ? '' : 's'} to ${OUTPUT_FILE}`)
