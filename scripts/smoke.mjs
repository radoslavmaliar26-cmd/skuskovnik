// Headless smoke test zostavenej appky (docs/) v lokálnom Chrome, 390×844.
// Spustenie: npm run build && node scripts/smoke.mjs
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import puppeteer from 'puppeteer-core'

const ROOT = 'docs'
const BASE = '/skuskovnik/'
const PORT = 4321
const OUT = 'screenshots'
const CHROME =
  process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) =>
    existsSync(p),
  )
if (!CHROME) {
  console.log('Chrome/Chromium sa nenašiel – smoke test preskočený.')
  process.exit(0)
}
mkdirSync(OUT, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  if (!url.startsWith(BASE)) {
    res.writeHead(302, { location: BASE })
    return res.end()
  }
  let p = normalize(join(ROOT, url.slice(BASE.length)))
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(p, 'index.html')
  if (!existsSync(p)) {
    res.writeHead(404)
    return res.end('404')
  }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' })
  res.end(readFileSync(p))
})
await new Promise((r) => server.listen(PORT, r))

const errors = []
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-first-run'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('error', (e) => errors.push(`crash: ${e.message}`))
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('  navigácia:', f.url()) })
page.on('dialog', (d) => d.accept())

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let shot = 0
const snap = async (name) => {
  shot++
  await sleep(300)
  await page.screenshot({ path: `${OUT}/${String(shot).padStart(2, '0')}-${name}.png`, fullPage: false })
}
const hasText = (t) => page.evaluate((t) => document.body.textContent.includes(t), t)
const waitText = async (t, timeout = 8000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await hasText(t)) return
    await sleep(100)
  }
  throw new Error(`Text „${t}“ sa nezobrazil (${await page.evaluate(() => location.hash)})`)
}
const click = async (t, sel = 'button, a, label, summary') => {
  const ok = await page.evaluate(
    (t, sel) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || e.tagName === 'SUMMARY')
      const el = els.find((e) => e.textContent.trim() === t) || els.find((e) => e.textContent.includes(t))
      if (!el || el.disabled) return false
      el.click()
      return true
    },
    t,
    sel,
  )
  if (!ok) throw new Error(`Tlačidlo „${t}“ sa nenašlo (${await page.evaluate(() => location.hash)})`)
  await sleep(250)
}

const step = async (name, fn) => {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    errors.push(`${name}: ${e.message}`)
    console.log(`✗ ${name}: ${e.message}`)
    await snap(`chyba-${name.replace(/\W+/g, '-')}`).catch(() => {})
  }
}

const URL0 = `http://localhost:${PORT}${BASE}`

await step('načítanie a onboarding', async () => {
  await page.goto(URL0, { waitUntil: 'networkidle0' })
  await waitText('Vyskúšať demo')
  await snap('onboarding')
})

await step('demo → materiál', async () => {
  await click('Vyskúšať demo')
  await waitText('Bude na skúške')
  await waitText('Hookov zákon')
  await snap('material')
  const katex = await page.evaluate(() => document.querySelectorAll('.katex').length)
  if (katex < 3) throw new Error(`KaTeX vzorce sa nevykreslili (${katex})`)
  const red = await page.evaluate(() => [...document.querySelectorAll('.badge.skuska')].filter((b) => b.textContent.includes('NA SKÚŠKE')).length)
  if (red < 3) throw new Error('Chýbajú červené značky NA SKÚŠKE')
})

await step('len skúškové', async () => {
  await click('Len skúškové')
  await sleep(300)
  await snap('len-skuskove')
  await click('Len skúškové')
})

await step('prepis so zvýraznením', async () => {
  await click('Prepis')
  await waitText('Nájdené frázy')
  const marks = await page.evaluate(() => document.querySelectorAll('mark.hl.skuska').length)
  if (!marks) throw new Error('V prepise nie sú zvýraznené skúškové frázy')
  await snap('prepis')
})

await step('test – prejdenie všetkých otázok', async () => {
  await click('Test')
  await waitText('Úvodný test')
  await click('Spustiť')
  await waitText('Otázka 1 z')
  await snap('test-otazka')
  for (let i = 0; i < 40; i++) {
    const h = await page.evaluate(() => location.hash)
    if (h.startsWith('#/vysledok')) break
    const kind = await page.evaluate(() => {
      if (document.querySelector('textarea')) return 'open'
      if (document.querySelector('input[type=text]')) return 'text'
      return 'opt'
    })
    if (kind === 'open') {
      await click('Ukázať vzorovú odpoveď')
      await click('✅ Vedel')
    } else if (kind === 'text') {
      await page.type('input[type=text]', '100')
      await click('Skontrolovať')
    } else {
      await page.evaluate(() => document.querySelector('button.opt')?.click())
      await sleep(100)
      await click('Skontrolovať')
    }
    if (i === 0) await snap('test-spatna-vazba')
    const last = await hasText('Vyhodnotiť test')
    await click(last ? 'Vyhodnotiť test' : 'Ďalej')
  }
  await waitText('bodov')
  await snap('vysledok')
})

await step('zopakovať chybné', async () => {
  if (await hasText('Zopakovať chybné')) {
    await click('Zopakovať chybné')
    await waitText('Otázka 1 z')
    await page.goBack()
  }
})

await step('kartičky', async () => {
  await page.goto(`${URL0}#/opakovanie`)
  await waitText('Na opakovanie teraz')
  await click('Opakovať')
  await click('Ukázať odpoveď')
  await snap('karticky')
  await click('✅ Vedel')
})

await step('predmet – bude na skúške', async () => {
  await page.goto(`${URL0}#/`)
  await waitText('Pružnosť a pevnosť (ukážka)')
  await click('Predmet ›')
  await click('Bude na skúške')
  await waitText('Termíny a organizačné')
  await snap('predmet-skuska')
})

await step('nastavenia', async () => {
  await page.goto(`${URL0}#/nastavenia`)
  await waitText('Prepis reči na text')
  await snap('nastavenia')
})

await step('nahrávanie s falošným mikrofónom', async () => {
  await page.goto(`${URL0}#/nova?zdroj=nahravat`)
  await waitText('Názov nového predmetu').catch(() => {})
  // vyber existujúci predmet
  await click('Pokračovať k nahrávaniu')
  await waitText('Začať nahrávať')
  await click('Začať nahrávať')
  await waitText('Nahráva sa')
  await sleep(2500)
  await click('Bude na skúške')
  await snap('nahravanie')
  await sleep(11000) // aspoň jeden 10 s kúsok
  await click('Pauza')
  await waitText('Pozastavené')
  await sleep(1000)
  await click('Pokračovať')
  await waitText('Nahráva sa')
  await sleep(3000)
  await click('Ukončiť')
  await sleep(2500)
  const h = await page.evaluate(() => location.hash)
  if (!h.startsWith('#/p/')) throw new Error(`po ukončení nie sme na prednáške (${h})`)
  await snap('po-nahravani')
  const segs = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open('skuskovnik')
        r.onsuccess = () => {
          const tx = r.result.transaction(['segments', 'chunks'], 'readonly')
          const s = tx.objectStore('segments').getAll()
          const c = tx.objectStore('chunks').count()
          tx.oncomplete = () => resolve({ segments: s.result.map((x) => ({ status: x.status, size: x.size, dur: x.durationSec, ext: x.ext })), chunks: c.result })
        }
      }),
  )
  console.log('  segmenty:', JSON.stringify(segs))
  if (!segs.chunks) throw new Error('Nahrávka sa neuložila (0 kúskov)')
  if (segs.segments.length !== 2) throw new Error(`po pauze mali byť 2 úseky, sú ${segs.segments.length}`)
  if (segs.segments.some((s) => s.status === 'recording')) throw new Error('úsek zostal v stave „recording“')
})

await step('vloženie textu', async () => {
  await page.goto(`${URL0}#/nova?zdroj=text`)
  await waitText('Text prepisu')
  await page.type('textarea', '[00:00] Dobrý deň. Toto bude na skúške: Hookov zákon. [01:00] Zapíšte si vzorec sigma rovná sa E krát epsilon.')
  await click('Uložiť prepis')
  await waitText('Prepis je hotový')
  await click('Vytvoriť materiál')
  await waitText('Kopírovať pre Claude')
  await snap('generovanie-rezim-a')
})

await browser.close()
server.close()

if (errors.length) {
  console.log(`\n${errors.length} problémov:`)
  for (const e of errors) console.log(' - ' + e)
  process.exit(1)
}
console.log('\nSmoke test OK – screenshoty sú v priečinku screenshots/')
