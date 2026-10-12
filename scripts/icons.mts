// Vygeneruje PNG ikony z scripts/icon.svg (spúšťa sa ručne: npm run icons)
import sharp from 'sharp'
import { readFileSync, copyFileSync } from 'node:fs'

const svg = readFileSync('scripts/icon.svg')
const out = async (size: number, file: string, pad = 0) => {
  const inner = Math.round(size * (1 - pad * 2))
  const img = await sharp(svg).resize(inner, inner).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: '#1e3a8a' } })
    .composite([{ input: img, gravity: 'center' }])
    .png()
    .toFile(`public/${file}`)
}
await out(180, 'apple-touch-icon.png')
await out(192, 'icon-192.png')
await out(512, 'icon-512.png')
await out(512, 'icon-maskable-512.png', 0.1)
copyFileSync('scripts/icon.svg', 'public/favicon.svg')
console.log('Ikony vygenerované.')
