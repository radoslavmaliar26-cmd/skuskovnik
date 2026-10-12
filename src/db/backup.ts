import { db } from './db'

/** Záloha a obnova všetkých dát (JSON). Binárne dáta (audio, fotky) sa ukladajú ako base64. */

const TABLES = ['subjects', 'lectures', 'segments', 'chunks', 'transcripts', 'marks', 'materials', 'tests', 'attempts', 'cards', 'photos', 'usage', 'settings'] as const
type TableName = (typeof TABLES)[number]

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function b64ToBuf(b64: string): ArrayBuffer {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out.buffer
}

export interface BackupOptions {
  includeAudio: boolean
  includeKeys: boolean
}

export async function exportBackup(opts: BackupOptions): Promise<string> {
  const data: Record<string, unknown[]> = {}
  for (const name of TABLES) {
    if (!opts.includeAudio && (name === 'chunks' || name === 'photos')) continue
    const rows = (await db.table(name).toArray()) as Record<string, unknown>[]
    data[name] = rows.map((r) => {
      const o = { ...r }
      if (o.data instanceof ArrayBuffer) o.data = { __b64: bufToB64(o.data) }
      if (name === 'settings' && !opts.includeKeys) o.keys = { groq: '', openai: '', custom: '', anthropic: '' }
      return o
    })
  }
  return JSON.stringify({ app: 'skuskovnik', version: 1, createdAt: Date.now(), includeAudio: opts.includeAudio, data })
}

/** Obnoví zálohu – zlúči ju s existujúcimi dátami (rovnaké id sa prepíšu). */
export async function importBackup(json: string): Promise<{ tables: number; rows: number }> {
  let parsed: { app?: string; data?: Record<string, Record<string, unknown>[]> }
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Súbor nie je platná záloha (neplatný JSON).')
  }
  if (parsed.app !== 'skuskovnik' || !parsed.data) throw new Error('Toto nie je záloha zo Skúškovníka.')
  let rows = 0
  let tables = 0
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const name of TABLES as readonly TableName[]) {
      const list = parsed.data![name]
      if (!Array.isArray(list)) continue
      tables++
      const fixed = list.map((r) => {
        const o = { ...r }
        const d = o.data as { __b64?: string } | undefined
        if (d && typeof d === 'object' && typeof d.__b64 === 'string') o.data = b64ToBuf(d.__b64)
        return o
      })
      if (name === 'settings') {
        // nepremaž existujúce kľúče prázdnymi zo zálohy
        const cur = await db.settings.get('app')
        for (const s of fixed) {
          const keys = s.keys as Record<string, string> | undefined
          if (cur && keys) for (const k of Object.keys(keys)) if (!keys[k]) keys[k] = (cur.keys as Record<string, string>)[k] ?? ''
        }
      }
      if (name === 'chunks') {
        // auto-increment kľúče môžu kolidovať – vlož bez id, ak segment ešte nemá kúsky
        for (const c of fixed) {
          const exists = await db.chunks.where('[segmentId+seq]').equals([c.segmentId as string, c.seq as number]).first()
          if (!exists) {
            delete c.id
            await db.chunks.add(c as never)
          }
        }
      } else {
        await db.table(name).bulkPut(fixed)
      }
      rows += fixed.length
    }
  })
  return { tables, rows }
}

/** Zmaže všetky dáta appky. */
export async function wipeAll() {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear()
  })
}
