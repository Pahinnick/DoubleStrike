// Rasterizes build/icon.svg into the assets electron-builder and the web build need.
//
// build/icon.png (1024x1024) is picked up automatically by electron-builder's default
// buildResources convention — it auto-generates the Windows .ico and macOS .icns from it, so
// nothing in package.json needs to reference platform-specific icon files directly.
//
// public/icon.svg is index.html's primary favicon (browsers that support SVG favicons render it
// crisp at any size, no rasterization needed). public/favicon.png is the fallback for browsers
// that don't.
import { copyFile } from 'node:fs/promises'
import sharp from 'sharp'

const SOURCE = 'build/icon.svg'

await copyFile(SOURCE, 'public/icon.svg')
console.log('public/icon.svg  (copied)')

// density high enough that even the 1024px render is drawn from crisp vector detail, not upscaled
await sharp(SOURCE, { density: 384 }).resize(64, 64).png().toFile('public/favicon.png')
console.log('public/favicon.png  (64x64)')

await sharp(SOURCE, { density: 384 }).resize(1024, 1024).png().toFile('build/icon.png')
console.log('build/icon.png  (1024x1024)')
