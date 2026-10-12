import { addUsage, db, getSegmentBlob, getSettings } from '../db/db'
import type { Segment } from '../db/types'
import { ApiError, retryDelayMs } from '../lib/httpErrors'
import { Store } from '../ui/hooks'
import { paragraphsFromSegments } from './assemble'
import { filterHallucinations } from './hallucinations'
import { providerFromSettings, type TranscriptionProvider } from './provider'

/**
 * Fronta prepisu: spracúva segmenty postupne po jednom. Stav je v IndexedDB,
 * takže po zatvorení a opätovnom otvorení appky pokračuje tam, kde skončila.
 */

export type QueueWaiting = null | 'offline' | 'noKey' | 'auth'

export interface QueueState {
  busy: boolean
  segmentId: string | null
  lectureId: string | null
  waiting: QueueWaiting
  message: string | null
  nextWakeAt: number | null
}

export const queueState = new Store<QueueState>({
  busy: false,
  segmentId: null,
  lectureId: null,
  waiting: null,
  message: null,
  nextWakeAt: null,
})

const PROMPT_MAX = 600

/** Prompt pre Whisper: slovník pojmov predmetu + koniec prepisu predchádzajúceho segmentu (max ~600 znakov). */
export function buildPrompt(glossary: string, prevText: string): string {
  const g = glossary.trim().replace(/\s+/g, ' ').slice(0, 300)
  const room = PROMPT_MAX - (g ? g.length + 1 : 0)
  let tail = prevText.trim().replace(/\s+/g, ' ')
  if (tail.length > room) {
    tail = tail.slice(tail.length - room)
    const sp = tail.indexOf(' ')
    if (sp > 0 && sp < 40) tail = tail.slice(sp + 1)
  }
  return [g, tail].filter(Boolean).join(' ').slice(0, PROMPT_MAX)
}

export interface QueueDeps {
  getProvider: () => Promise<TranscriptionProvider | null>
  now: () => number
  isOnline: () => boolean
}

const defaultDeps: QueueDeps = {
  getProvider: async () => providerFromSettings(await getSettings()),
  now: () => Date.now(),
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
}

export class TranscriptionQueue {
  private deps: QueueDeps
  private running = false
  private again = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: Partial<QueueDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps }
  }

  private set(p: Partial<QueueState>) {
    queueState.set((s) => ({ ...s, ...p }))
  }

  /** Spusti spracovanie (ak už beží, prebehne ešte raz po skončení). */
  kick() {
    if (this.running) {
      this.again = true
      return
    }
    void this.drain()
  }

  /** Spracúva, kým sú pripravené segmenty. */
  async drain(): Promise<void> {
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      for (;;) {
        this.again = false
        const next = await this.pickNext()
        if (!next) {
          this.set({ busy: false, segmentId: null, lectureId: null, nextWakeAt: null, waiting: null, message: null })
          break
        }
        if ('waitUntil' in next) {
          const ms = Math.max(500, next.waitUntil - this.deps.now())
          this.set({ busy: false, segmentId: null, nextWakeAt: next.waitUntil })
          this.timer = setTimeout(() => this.kick(), ms)
          break
        }
        if (!this.deps.isOnline()) {
          this.set({ busy: false, waiting: 'offline', message: 'Si offline – prepis počká na internet.' })
          break
        }
        const provider = await this.deps.getProvider()
        if (!provider) {
          this.set({ busy: false, waiting: 'noKey', message: 'Na prepis treba zadať API kľúč v Nastaveniach (Groq je zadarmo).' })
          break
        }
        const stop = await this.process(next.seg, provider)
        if (stop) break
      }
    } finally {
      this.running = false
      if (this.again) this.kick()
    }
  }

  private async pickNext(): Promise<{ seg: Segment } | { waitUntil: number } | null> {
    const pending = await db.segments.where('status').equals('pending').toArray()
    if (!pending.length) return null
    const now = this.deps.now()
    const ready = pending.filter((s) => s.nextAttemptAt <= now)
    if (!ready.length) return { waitUntil: Math.min(...pending.map((s) => s.nextAttemptAt)) }
    ready.sort((a, b) => a.createdAt - b.createdAt || a.index - b.index)
    return { seg: ready[0] }
  }

  /** Spracuje jeden segment. Vráti true, ak treba frontu zastaviť (chýba kľúč, offline …). */
  private async process(seg: Segment, provider: TranscriptionProvider): Promise<boolean> {
    this.set({ busy: true, segmentId: seg.id, lectureId: seg.lectureId, waiting: null, message: null })
    await db.segments.update(seg.id, { status: 'transcribing' })
    const blob = await getSegmentBlob(seg)
    if (!blob) {
      await db.segments.update(seg.id, { status: 'error', errorKind: 'noAudio', error: 'Zvuk tohto úseku chýba (bol zmazaný).' })
      await updateLecture(seg.lectureId)
      return false
    }
    const lecture = await db.lectures.get(seg.lectureId)
    const subject = lecture ? await db.subjects.get(lecture.subjectId) : undefined
    const prev = await db.segments.where('[lectureId+index]').equals([seg.lectureId, seg.index - 1]).first()
    const prevText = prev?.status === 'done' ? (prev.parts ?? []).map((p) => p.text).join(' ') : ''
    try {
      const res = await provider.transcribe({
        file: blob,
        filename: `usek-${seg.index + 1}.${seg.ext}`,
        language: subject?.language ?? 'sk',
        prompt: buildPrompt(subject?.glossary ?? '', prevText) || undefined,
        durationSec: seg.durationSec,
      })
      const filtered = filterHallucinations(res.parts, { timed: res.timed })
      const parts = filtered.map((p) => ({
        start: seg.startSec + p.start,
        end: seg.startSec + (p.end || p.start),
        text: p.text,
      }))
      if (!res.timed && parts.length === 1) parts[0].end = seg.startSec + seg.durationSec
      await db.segments.update(seg.id, { status: 'done', parts, error: undefined, errorKind: undefined, attempts: seg.attempts + 1 })
      await addUsage({ audioSec: seg.durationSec })
      await updateLecture(seg.lectureId)
      return false
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('unknown', `Prepis zlyhal: ${(e as Error)?.message ?? e}`)
      const attempts = seg.attempts + 1
      if (err.kind === 'offline') {
        await db.segments.update(seg.id, { status: 'pending', error: err.message, nextAttemptAt: 0 })
        this.set({ busy: false, waiting: 'offline', message: err.message })
        return true
      }
      if (err.kind === 'auth') {
        // zlý kľúč: neplytvaj pokusmi, počkaj na opravu v Nastaveniach
        await db.segments.update(seg.id, { status: 'pending', error: err.message, errorKind: 'auth', nextAttemptAt: 0 })
        this.set({ busy: false, waiting: 'auth', message: err.message })
        return true
      }
      const delay = retryDelayMs(err.kind, attempts, err.retryAfterSec)
      if (delay !== null) {
        await db.segments.update(seg.id, {
          status: 'pending',
          attempts,
          nextAttemptAt: this.deps.now() + delay,
          error: err.message,
          errorKind: err.kind,
        })
      } else {
        await db.segments.update(seg.id, { status: 'error', attempts, error: err.message, errorKind: err.kind })
      }
      await updateLecture(seg.lectureId)
      return false
    }
  }
}

/** Po zmene segmentov aktualizuje prepis a stav prednášky. */
export async function updateLecture(lectureId: string) {
  const lecture = await db.lectures.get(lectureId)
  if (!lecture) return
  const segs = await db.segments.where('lectureId').equals(lectureId).toArray()
  const paragraphs = paragraphsFromSegments(segs)
  const tr = await db.transcripts.get(lectureId)
  if (!tr?.edited && paragraphs.length) {
    await db.transcripts.put({ lectureId, paragraphs, edited: false, updatedAt: Date.now() })
  }
  if (lecture.status === 'recording' || lecture.status === 'generating' || lecture.status === 'done') return
  const active = segs.some((s) => s.status === 'pending' || s.status === 'transcribing' || s.status === 'recording')
  if (active) {
    if (lecture.status !== 'transcribing') await db.lectures.update(lectureId, { status: 'transcribing', error: undefined, errorStep: undefined })
    return
  }
  const errors = segs.filter((s) => s.status === 'error')
  const done = segs.filter((s) => s.status === 'done')
  if (errors.length) {
    await db.lectures.update(lectureId, {
      status: 'error',
      errorStep: 'transcribe',
      error: `Prepis ${errors.length} z ${errors.length + done.length} úsekov zlyhal: ${errors[0].error ?? 'neznáma chyba'}`,
      updatedAt: Date.now(),
    })
    return
  }
  if (done.length && paragraphs.length) {
    await db.lectures.update(lectureId, { status: 'transcribed', error: undefined, errorStep: undefined, updatedAt: Date.now() })
    return
  }
  await db.lectures.update(lectureId, {
    status: 'error',
    errorStep: 'transcribe',
    error: segs.some((s) => s.status === 'skipped')
      ? 'V nahrávke sa nenašla reč – bola príliš tichá. Ak si myslíš, že tam reč je, ťukni na „Prepísať aj tiché úseky“.'
      : 'Prepis je prázdny – v nahrávke sa nenašla reč.',
    updatedAt: Date.now(),
  })
}

/** Znovu zaradí zlyhané úseky do fronty. */
export async function retryTranscription(lectureId: string) {
  await db.segments
    .where('lectureId')
    .equals(lectureId)
    .filter((s) => s.status === 'error' || (s.status === 'pending' && s.nextAttemptAt > Date.now()))
    .modify({ status: 'pending', attempts: 0, nextAttemptAt: 0, error: undefined, errorKind: undefined })
  await db.lectures.update(lectureId, { status: 'transcribing', error: undefined, errorStep: undefined })
  queue.kick()
}

/** Pošle na prepis aj úseky, ktoré appka vyhodnotila ako ticho. */
export async function transcribeSkipped(lectureId: string) {
  await db.segments.where('lectureId').equals(lectureId).filter((s) => s.status === 'skipped').modify({ status: 'pending', nextAttemptAt: 0 })
  await db.lectures.update(lectureId, { status: 'transcribing', error: undefined, errorStep: undefined })
  queue.kick()
}

/** Pokračuje s tým, čo sa podarilo prepísať (zlyhané úseky vynechá). */
export async function continueWithPartial(lectureId: string) {
  const segs = await db.segments.where('lectureId').equals(lectureId).toArray()
  const paragraphs = paragraphsFromSegments(segs)
  if (!paragraphs.length) throw new Error('Zatiaľ nie je prepísaný žiadny úsek.')
  const tr = await db.transcripts.get(lectureId)
  if (!tr?.edited) await db.transcripts.put({ lectureId, paragraphs, edited: false, updatedAt: Date.now() })
  await db.lectures.update(lectureId, { status: 'transcribed', error: undefined, errorStep: undefined })
}

/** Po štarte appky: rozpracované segmenty vráti do fronty. */
export async function resetStaleSegments() {
  await db.segments.where('status').equals('transcribing').modify({ status: 'pending' })
}

export const queue = new TranscriptionQueue()

export function installQueueTriggers() {
  window.addEventListener('skuskovnik:segments', () => queue.kick())
  window.addEventListener('online', () => queue.kick())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') queue.kick()
  })
}
