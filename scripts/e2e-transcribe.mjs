// End-to-end test prepisu v skutočnom prehliadači (headless Chrome):
// import zvukového súboru → segmenty → fronta → multipart požiadavka → prepis v appke.
//
// Mock režim (predvolený): lokálny server napodobňuje OpenAI-kompatibilné API a kontroluje požiadavky.
//   node scripts/e2e-transcribe.mjs <súbor.wav> [model] [--fail429]
// Reálny režim (Groq): kľúč sa číta zo súboru, nikam sa nevypisuje.
//   GROQ_KEY_FILE=C:\cesta\k\suboru node scripts/e2e-transcribe.mjs <súbor> [model] [--lang=sk]
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--') && existsSync(a))
const model = args.find((a) => !a.startsWith('--') && a !== file) || 'whisper-1'
const fail429 = args.includes('--fail429')
const lang = (args.find((a) => a.startsWith('--lang=')) || '--lang=en').slice(7)
const recordSec = Number((args.find((a) => a.startsWith('--record=')) || '--record=0').slice(9))
const keyFile = process.env.GROQ_KEY_FILE
const real = !!keyFile
if (!file) {
  console.log('Použitie: node scripts/e2e-transcribe.mjs <súbor> [model] [--fail429] [--lang=sk|en|cs|auto]')
  process.exit(2)
}

const ROOT = 'docs'
const BASE = '/skuskovnik/'
const PORT = 4321
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p))
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' }

const requests = []
let callNo = 0

/** Dĺžka WAV súboru z hlavičky (s). */
function wavDuration(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null
  let off = 12
  let byteRate = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16)
    if (id === 'data') return byteRate ? size / byteRate : null
    off += 8 + size + (size % 2)
  }
  return null
}

async function handleApi(req, res, body) {
  const url = req.url.replace('/mockapi/v1', '')
  const auth = req.headers.authorization || ''
  if (auth !== 'Bearer test-key') {
    res.writeHead(401, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ error: { message: 'Invalid API Key' } }))
  }
  if (req.method === 'GET' && url.startsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ data: [{ id: model }] }))
  }
  if (req.method === 'POST' && url.startsWith('/audio/transcriptions')) {
    callNo++
    const fd = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body }).formData()
    const f = fd.get('file')
    const buf = Buffer.from(await f.arrayBuffer())
    const dur = wavDuration(buf)
    const info = {
      call: callNo,
      file: f.name,
      type: f.type,
      sizeMB: +(buf.length / 1048576).toFixed(2),
      wavSec: dur === null ? null : +dur.toFixed(1),
      model: fd.get('model'),
      language: fd.get('language'),
      temperature: fd.get('temperature'),
      response_format: fd.get('response_format'),
      granularities: fd.getAll('timestamp_granularities[]'),
      promptChars: (fd.get('prompt') || '').length,
    }
    const problems = []
    if (buf.length > 25 * 1024 * 1024) problems.push('súbor > 25 MB')
    if (!/\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm)$/.test(f.name)) problems.push('nepodporovaná prípona')
    if (info.model !== model) problems.push('zlý model')
    if (info.temperature !== '0') problems.push('temperature != 0')
    if (/^gpt-4o/.test(model) && info.response_format !== 'json') problems.push('gpt-4o má dostať json')
    if (/^gpt-4o/.test(model) && dur !== null && dur > 300) problems.push(`gpt-4o úsek je dlhý ${dur.toFixed(0)} s (> 300 s)`)
    info.problems = problems
    requests.push(info)
    if (fail429 && callNo === 1) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' })
      return res.end(JSON.stringify({ error: { message: 'Rate limit reached' } }))
    }
    const total = dur ?? 60
    const text = `Call ${callNo}. This will be on the exam: Hooke's law. Write this down: the test is on November twelfth.`
    if (info.response_format === 'verbose_json') {
      const segments = []
      for (let t = 0; t < total; t += 15) {
        segments.push({ start: t, end: Math.min(total, t + 15), text: t === 0 ? text : ` Segment at ${Math.round(t)} seconds of call ${callNo}.`, no_speech_prob: 0.01, avg_logprob: -0.2 })
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ text, duration: total, segments }))
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ text: `${text} (json, ${Math.round(total)} s)` }))
  }
  res.writeHead(404)
  res.end()
}

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const body = Buffer.concat(chunks)
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    if (url.startsWith('/mockapi/')) return handleApi(req, res, body).catch((e) => {
      console.error(e)
      res.writeHead(500)
      res.end()
    })
    if (!url.startsWith(BASE)) {
      res.writeHead(302, { location: BASE })
      return res.end()
    }
    let p = normalize(join(ROOT, url.slice(BASE.length)))
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(p, 'index.html')
    if (!existsSync(p)) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' })
    res.end(readFileSync(p))
  })
})
await new Promise((r) => server.listen(PORT, r))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// v režime nahrávania Chrome použije zvukový súbor ako mikrofón
const launchArgs = ['--no-first-run']
if (recordSec) launchArgs.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve(file)}`)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: launchArgs })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error' && !/401|429/.test(m.text())) errors.push(`console: ${m.text()}`)
})
page.on('dialog', (d) => d.accept())

const URL0 = `http://localhost:${PORT}${BASE}`
await page.goto(URL0, { waitUntil: 'networkidle0' })

// nastavenia priamo do IndexedDB (kľúč sa nikam nevypisuje)
const key = real ? readFileSync(keyFile, 'utf8').trim() : 'test-key'
await page.evaluate(
  ({ real, key, model }) =>
    new Promise((resolve, reject) => {
      const r = indexedDB.open('skuskovnik')
      r.onerror = () => reject(r.error)
      r.onsuccess = () => {
        const tx = r.result.transaction('settings', 'readwrite')
        const st = tx.objectStore('settings')
        const g = st.get('app')
        g.onsuccess = () => {
          const cur = g.result || {}
          const s = {
            ...cur,
            id: 'app',
            onboarded: true,
            provider: real ? 'groq' : 'custom',
            keys: { groq: real ? key : '', openai: '', custom: real ? '' : key, anthropic: '' },
            models: { groq: model, openai: 'gpt-4o-transcribe', custom: model },
            customBaseUrl: real ? '' : `${location.origin}/mockapi/v1`,
            segmentMinutes: 1,
          }
          st.put(s)
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
    }),
  { real, key, model },
)

console.log('Nastavenia v DB:', await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('skuskovnik'); r.onsuccess = () => { const db = r.result; const names = [...db.objectStoreNames]; if (!names.includes('settings')) return res('chýba store, verzia ' + db.version + ', stores ' + names.join(',')); const g = db.transaction('settings').objectStore('settings').get('app'); g.onsuccess = () => res(JSON.stringify({ onboarded: g.result?.onboarded, provider: g.result?.provider, base: g.result?.customBaseUrl })) } })))
const t0 = Date.now()
// appka nesleduje priame zápisy do IndexedDB → najprv obnov stránku, potom choď na formulár
await page.reload({ waitUntil: 'networkidle0' })
await page.evaluate((r) => (location.hash = r ? '#/nova?zdroj=nahravat' : '#/nova?zdroj=import'), recordSec)
try {
  await page.waitForSelector('select', { timeout: 8000 })
} catch {
  console.log('Stránka:', await page.evaluate(() => location.hash + ' | ' + document.body.textContent.slice(0, 200)))
  throw new Error('Formulár novej prednášky sa nezobrazil')
}
// nový predmet s jazykom
await page.select('select', '__new__')
await sleep(200)
await page.type('input[placeholder="napr. Pružnosť a pevnosť"]', 'E2E prepis')
const selects = await page.$$('select')
await selects[1].select(lang)
const clickText = (t) => page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t) && !b.disabled)?.click(), t)
if (recordSec) {
  await clickText('Pokračovať k nahrávaniu')
  await page.waitForFunction(() => document.body.textContent.includes('Začať nahrávať'))
  await clickText('Začať nahrávať')
  await page.waitForFunction(() => document.body.textContent.includes('Nahráva sa'))
  console.log(`Nahrávam ${recordSec} s zo súboru ako mikrofónu (úsek = 1 min)…`)
  for (let s = 0; s < recordSec; s += 10) {
    await sleep(10_000)
    const info = await page.evaluate(() => document.querySelector('.card.center')?.textContent?.replace(/\s+/g, ' ').slice(0, 120))
    console.log(`  [${s + 10} s] ${info}`)
    if (s === 20) await clickText('Bude na skúške')
  }
  await clickText('Ukončiť')
} else {
  const input = await page.$('input[type=file]')
  await input.uploadFile(resolve(file))
}
console.log(`Súbor: ${file} (${(statSync(file).size / 1048576).toFixed(1)} MB), model ${model}, jazyk ${lang}, režim ${real ? 'REÁLNY Groq' : 'mock'}`)

// čakaj na prednášku a koniec prepisu
let status = ''
let last = ''
for (let i = 0; i < 600; i++) {
  await sleep(1000)
  const st = await page.evaluate(() => ({ hash: location.hash, text: document.body.textContent }))
  if (!st.hash.startsWith('#/p/')) {
    const m = st.text.match(/(Dekódujem[^…]*…|Pripravujem časť \d+\/\d+…|Ukladám súbor…|Hľadám[^…]*…)/)
    if (m && m[0] !== last) {
      last = m[0]
      console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)} s] ${last}`)
    }
    const err = st.text.match(/(Import zlyhal[^\n]{0,200}|Súbor sa nepodarilo spracovať[^\n]{0,80})/)
    if (err) {
      status = 'IMPORT ERROR: ' + err[0]
      break
    }
    continue
  }
  const m = st.text.match(/Prepisuje sa \d+\/\d+|Prepis je hotový|Prepis zlyhal|V nahrávke sa nenašla reč|Prepísať aj tiché úseky/)
  if (m && m[0] !== last) {
    last = m[0]
    console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)} s] ${last}`)
  }
  if (m && m[0] !== 'Prepisuje sa' && !m[0].startsWith('Prepisuje sa')) {
    status = m[0]
    break
  }
}

const db = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const r = indexedDB.open('skuskovnik')
      r.onsuccess = () => {
        const tx = r.result.transaction(['segments', 'transcripts', 'lectures'], 'readonly')
        const s = tx.objectStore('segments').getAll()
        const t = tx.objectStore('transcripts').getAll()
        const l = tx.objectStore('lectures').getAll()
        tx.oncomplete = () =>
          resolve({
            lecture: l.result.map((x) => ({ status: x.status, durationSec: Math.round(x.durationSec), error: x.error })),
            segments: s.result
              .sort((a, b) => a.index - b.index)
              .map((x) => ({ i: x.index, status: x.status, start: Math.round(x.startSec), dur: Math.round(x.durationSec), ext: x.ext, MB: +(x.size / 1048576).toFixed(2), attempts: x.attempts, err: x.error })),
            paragraphs: t.result[0]?.paragraphs ?? [],
          })
      }
    }),
)

console.log(`\nVýsledok: ${status || 'časový limit'} za ${((Date.now() - t0) / 1000).toFixed(1)} s`)
console.log('Prednáška:', JSON.stringify(db.lecture))
console.log('Úseky:')
for (const s of db.segments) console.log('  ', JSON.stringify(s))
if (!real) {
  console.log('Požiadavky na API:')
  for (const r of requests) console.log('  ', JSON.stringify(r))
}
console.log(`Prepis: ${db.paragraphs.length} odsekov`)
for (const p of db.paragraphs.slice(0, 8)) console.log(`   [${Math.floor(p.t / 60)}:${String(Math.floor(p.t % 60)).padStart(2, '0')}] ${p.text.slice(0, 160)}`)

// zobrazenie prepisu v appke
if (status === 'Prepis je hotový') {
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Prepis')?.click())
  await sleep(800)
  const cues = await page.evaluate(() => ({ exam: document.querySelectorAll('mark.hl.skuska').length, imp: document.querySelectorAll('mark.hl.dolezite').length, org: document.querySelectorAll('mark.hl.organizacne').length }))
  console.log('Zvýraznené vety v prepise:', JSON.stringify(cues))
  await page.screenshot({ path: `screenshots/e2e-prepis-${model}.png` })
}

const problems = requests.flatMap((r) => r.problems.map((p) => `požiadavka ${r.call}: ${p}`))
await browser.close()
server.close()
if (errors.length) console.log('\nChyby v prehliadači:\n - ' + errors.join('\n - '))
if (problems.length) console.log('\nProblémy v požiadavkách:\n - ' + problems.join('\n - '))
process.exit(status === 'Prepis je hotový' && !problems.length && !errors.length ? 0 : 1)
