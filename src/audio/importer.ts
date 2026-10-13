import { db, getSettings } from '../db/db'
import type { Segment } from '../db/types'
import { uid } from '../lib/text'
import { containsSpeech, findCutPoints, mixToMono } from './levels'
import { describeFile } from './mime'
import { maxSegmentSec, notifySegments } from './session'
import { encodeWav } from './wav'

/** Hranica pre priame poslanie súboru na prepis (API limit je 25 MB). */
export const DIRECT_LIMIT = 24 * 1024 * 1024
const SAMPLE_RATE = 16_000

export type ImportProgress = (text: string, frac?: number) => void

export class ImportError extends Error {}

/** Zistí dĺžku zvukového súboru cez <audio> (bez dekódovania celého súboru). */
export function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const a = new Audio()
    const done = (d: number) => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(d) && d > 0 ? d : 0)
    }
    const t = setTimeout(() => done(0), 8000)
    a.preload = 'metadata'
    a.onloadedmetadata = () => {
      clearTimeout(t)
      done(a.duration)
    }
    a.onerror = () => {
      clearTimeout(t)
      done(0)
    }
    a.src = url
  })
}

const DECODE_HELP =
  'Súbor sa nepodarilo spracovať (je príliš veľký alebo v nepodporovanom formáte). ' +
  'Tip: v appke Hlasové poznámky nahrávku oreť na kratšie časti, alebo v Nastaveniach iPhonu → Hlasové poznámky → Kvalita zvuku zvoľ „Komprimovaná“ a nahrávku importuj znova.'

async function decodeToMono16k(file: Blob): Promise<Float32Array> {
  const data = await file.arrayBuffer()
  const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  let ctx: BaseAudioContext
  try {
    ctx = new AC({ sampleRate: SAMPLE_RATE })
  } catch {
    // staršie Safari nepodporujú voľbu sampleRate
    ctx = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE)
  }
  try {
    const audio = await new Promise<AudioBuffer>((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject)
      if (p && typeof p.then === 'function') p.then(resolve, reject)
    })
    const channels: Float32Array[] = []
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c))
    let mono = mixToMono(channels)
    if (audio.sampleRate !== SAMPLE_RATE) mono = resample(mono, audio.sampleRate, SAMPLE_RATE)
    return mono
  } finally {
    if ('close' in ctx && typeof (ctx as AudioContext).close === 'function') await (ctx as AudioContext).close().catch(() => {})
  }
}

/** Jednoduché prevzorkovanie (lineárna interpolácia) – stačí pre reč. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const i1 = Math.min(input.length - 1, i0 + 1)
    const f = x - i0
    out[i] = input[i0] * (1 - f) + input[i1] * f
  }
  return out
}

/**
 * Importuje zvukový súbor do prednášky ako segmenty na prepis.
 * Do 24 MB sa pošle priamo; väčší sa dekóduje (16 kHz mono), rozdelí na ~10 min časti
 * s rezom v tichu a každá sa zakóduje ako WAV.
 */
export async function importAudioFile(lectureId: string, file: File, progress: ImportProgress = () => {}) {
  const { mime, ext } = describeFile(file)
  const existing = await db.segments.where('lectureId').equals(lectureId).toArray()
  let index = existing.reduce((m, s) => Math.max(m, s.index + 1), 0)
  const base = existing.reduce((m, s) => Math.max(m, s.startSec + s.durationSec), 0)
  const now = Date.now()
  // modely bez časových značiek (gpt-4o-*) majú obmedzený výstup → kratšie časti
  const partSec = maxSegmentSec(await getSettings())
  const duration = file.size <= DIRECT_LIMIT ? await probeDuration(file) : 0
  const directOk = file.size <= DIRECT_LIMIT && (partSec >= 600 || (duration > 0 && duration <= partSec + 30))

  if (directOk) {
    progress('Ukladám súbor…', 0.3)
    const data = await file.arrayBuffer()
    const seg: Segment = {
      id: uid(),
      lectureId,
      index: index++,
      startSec: base,
      durationSec: duration,
      mime,
      ext,
      hasSpeech: true,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      size: data.byteLength,
      createdAt: now,
    }
    await db.transaction('rw', db.segments, db.chunks, db.lectures, async () => {
      await db.segments.add(seg)
      await db.chunks.add({ segmentId: seg.id, seq: 0, data })
      await db.lectures.update(lectureId, { durationSec: base + duration, status: 'transcribing', updatedAt: Date.now() })
    })
    progress('Hotovo', 1)
    notifySegments()
    return { parts: 1, durationSec: duration }
  }

  progress('Dekódujem zvuk (môže to chvíľu trvať)…', 0.05)
  let samples: Float32Array
  try {
    samples = await decodeToMono16k(file)
  } catch (e) {
    console.error(e)
    throw new ImportError(DECODE_HELP)
  }
  if (!samples.length) throw new ImportError(DECODE_HELP)
  const durationSec = samples.length / SAMPLE_RATE
  progress('Hľadám miesta na rozdelenie…', 0.15)
  const cuts = [0, ...findCutPoints(samples, SAMPLE_RATE, partSec, 10), samples.length]
  const total = cuts.length - 1
  for (let i = 0; i < total; i++) {
    progress(`Pripravujem časť ${i + 1}/${total}…`, 0.2 + (0.8 * i) / total)
    const part = samples.subarray(cuts[i], cuts[i + 1])
    const wav = encodeWav(part, SAMPLE_RATE)
    const hasSpeech = containsSpeech(part, SAMPLE_RATE)
    const seg: Segment = {
      id: uid(),
      lectureId,
      index: index++,
      startSec: base + cuts[i] / SAMPLE_RATE,
      durationSec: part.length / SAMPLE_RATE,
      mime: 'audio/wav',
      ext: 'wav',
      hasSpeech,
      status: hasSpeech ? 'pending' : 'skipped',
      attempts: 0,
      nextAttemptAt: 0,
      size: wav.byteLength,
      createdAt: Date.now(),
    }
    await db.transaction('rw', db.segments, db.chunks, async () => {
      await db.segments.add(seg)
      await db.chunks.add({ segmentId: seg.id, seq: 0, data: wav })
    })
    // nechaj prehliadač nadýchnuť sa (UI, GC)
    await new Promise((r) => setTimeout(r, 0))
  }
  await db.lectures.update(lectureId, { durationSec: base + durationSec, status: 'transcribing', updatedAt: Date.now() })
  progress('Hotovo', 1)
  notifySegments()
  return { parts: total, durationSec }
}
