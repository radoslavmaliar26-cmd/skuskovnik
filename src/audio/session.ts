import { db, getSettings } from '../db/db'
import type { MarkType, Segment } from '../db/types'
import { uid } from '../lib/text'
import { Store } from '../ui/hooks'
import { CutPolicy, meterValue, rms } from './levels'
import { extForMime, pickRecorderMime } from './mime'

/**
 * Nahrávanie prednášky po segmentoch s ochranou proti strate dát.
 * Beží mimo Reactu (singleton), takže prepínanie obrazoviek nahrávanie nepreruší.
 */

export type RecPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'interrupted' | 'stopping'

export interface RecorderState {
  active: boolean
  lectureId: string | null
  phase: RecPhase
  /** Čas prednášky (bez páuz), s */
  elapsedSec: number
  /** Ukazovateľ hlasitosti 0..1 */
  level: number
  segmentIndex: number
  wakeLock: 'on' | 'off' | 'unsupported'
  error?: string
  lastMark?: { type: MarkType; t: number; at: number }
  mime?: string
}

const initial: RecorderState = {
  active: false,
  lectureId: null,
  phase: 'idle',
  elapsedSec: 0,
  level: 0,
  segmentIndex: 0,
  wakeLock: 'off',
}

export const recorderState = new Store<RecorderState>(initial)

/** Oznámenie pre frontu prepisu, že pribudli segmenty. */
export function notifySegments() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('skuskovnik:segments'))
}

export function recordingSupported(): string | null {
  if (typeof window === 'undefined') return 'Nahrávanie nie je dostupné.'
  if (!window.isSecureContext) return 'Nahrávanie funguje len cez zabezpečené pripojenie (HTTPS).'
  if (!navigator.mediaDevices?.getUserMedia) return 'Tento prehliadač nepodporuje prístup k mikrofónu.'
  if (typeof MediaRecorder === 'undefined')
    return 'Tento prehliadač nevie nahrávať zvuk (chýba MediaRecorder). Aktualizuj iOS alebo použi import súboru.'
  return null
}

export function micErrorText(e: unknown): string {
  const name = (e as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Prístup k mikrofónu je zamietnutý. Na iPhone: Nastavenia → Safari → Mikrofón → Povoliť (alebo pri ďalšom pokuse ťukni na „Povoliť“).'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenašiel sa žiadny mikrofón.'
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'Mikrofón je obsadený inou aplikáciou (napr. telefonát alebo iné nahrávanie). Ukonči ju a skús znova.'
  return `Mikrofón sa nepodarilo spustiť: ${(e as Error)?.message ?? String(e)}`
}

interface SegState {
  id: string
  index: number
  startSec: number
  startPerf: number
  seq: number
  size: number
  recorder: MediaRecorder
  policy: CutPolicy
  maxLevel: number
  writeChain: Promise<void>
  finishing: boolean
}

const TIMESLICE = 10_000

class RecordingSession {
  lectureId: string
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private buf: Float32Array<ArrayBuffer> | null = null
  private mime: string | undefined
  private seg: SegState | null = null
  private baseSec = 0
  private nextIndex = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private wakeLock: WakeLockSentinel | null = null
  private rotating = false
  private targetMs = 5 * 60_000
  private muteTimer: ReturnType<typeof setTimeout> | null = null

  constructor(lectureId: string) {
    this.lectureId = lectureId
  }

  private set(patch: Partial<RecorderState>) {
    recorderState.set((s) => ({ ...s, ...patch }))
  }

  /** Musí sa volať priamo z ťuknutia (AudioContext a mikrofón vyžadujú gesto používateľa). */
  async open(gapBefore: boolean) {
    // AudioContext vytvoríme ešte synchrónne v rámci gesta (Safari ho inak nechá pozastavený)
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = AC ? new AC() : null
    void this.ctx?.resume().catch(() => {})
    this.set({ active: true, lectureId: this.lectureId, phase: 'starting', error: undefined })
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      })
    } catch (e) {
      await this.ctx?.close().catch(() => {})
      this.ctx = null
      throw e
    }
    const settings = await getSettings()
    this.targetMs = Math.max(1, settings.segmentMinutes || 5) * 60_000
    const lecture = await db.lectures.get(this.lectureId)
    const segs = await db.segments.where('lectureId').equals(this.lectureId).toArray()
    this.nextIndex = segs.reduce((m, s) => Math.max(m, s.index + 1), 0)
    this.baseSec = Math.max(lecture?.durationSec ?? 0, ...segs.map((s) => s.startSec + s.durationSec))
    this.mime = pickRecorderMime()

    if (this.ctx) {
      try {
        const src = this.ctx.createMediaStreamSource(this.stream)
        this.analyser = this.ctx.createAnalyser()
        this.analyser.fftSize = 2048
        src.connect(this.analyser)
        this.buf = new Float32Array(this.analyser.fftSize)
      } catch {
        this.analyser = null
      }
    }
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener('ended', () => void this.interrupt('Mikrofón bol prerušený (napr. hovorom alebo inou appkou).'))
      track.addEventListener('mute', () => this.onMute())
      track.addEventListener('unmute', () => this.onUnmute())
    }
    if (gapBefore) {
      await db.marks.add({ id: uid(), lectureId: this.lectureId, type: 'gap', t: this.baseSec, createdAt: Date.now() })
    }
    await db.lectures.update(this.lectureId, { status: 'recording', interrupted: false, updatedAt: Date.now() })
    await this.startSegment(gapBefore)
    await this.acquireWakeLock()
    this.timer = setInterval(() => this.tick(), 100)
    this.set({ phase: 'recording', mime: this.mime })
  }

  private async startSegment(gapBefore: boolean) {
    if (!this.stream) throw new Error('Mikrofón nie je spustený.')
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(this.stream, { ...(this.mime ? { mimeType: this.mime } : {}), audioBitsPerSecond: 64_000 })
    } catch {
      recorder = new MediaRecorder(this.stream)
    }
    const mime = recorder.mimeType || this.mime || 'audio/mp4'
    const seg: SegState = {
      id: uid(),
      index: this.nextIndex++,
      startSec: this.baseSec,
      startPerf: performance.now(),
      seq: 0,
      size: 0,
      recorder,
      policy: new CutPolicy({ targetMs: this.targetMs }),
      maxLevel: 0,
      writeChain: Promise.resolve(),
      finishing: false,
    }
    const row: Segment = {
      id: seg.id,
      lectureId: this.lectureId,
      index: seg.index,
      startSec: seg.startSec,
      durationSec: 0,
      mime: mime.split(';')[0],
      ext: extForMime(mime),
      hasSpeech: false,
      status: 'recording',
      attempts: 0,
      nextAttemptAt: 0,
      size: 0,
      gapBefore,
      createdAt: Date.now(),
    }
    await db.segments.add(row)
    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return
      const blob = e.data
      const seq = seg.seq++
      // zápisy idú za sebou, aby sa zachovalo poradie kúskov
      seg.writeChain = seg.writeChain.then(async () => {
        try {
          const data = await blob.arrayBuffer()
          seg.size += data.byteLength
          await db.chunks.add({ segmentId: seg.id, seq, data })
          await db.segments.update(seg.id, { size: seg.size, durationSec: this.segElapsed(seg) })
        } catch (err) {
          console.error('Uloženie kúska zlyhalo', err)
          this.set({ error: 'Nepodarilo sa uložiť časť nahrávky – môže byť plné úložisko.' })
        }
      })
    }
    recorder.onerror = () => void this.interrupt('Nahrávanie zlyhalo (chyba prehliadača).')
    recorder.start(TIMESLICE)
    this.seg = seg
    this.set({ segmentIndex: seg.index })
  }

  private segElapsed(seg: SegState) {
    return Math.max(0, (performance.now() - seg.startPerf) / 1000)
  }

  /** Ukončí segment: počká na posledný kúsok, uloží dĺžku a pošle ho do fronty prepisu. */
  private finishSegment(seg: SegState): Promise<void> {
    if (seg.finishing) return seg.writeChain
    seg.finishing = true
    const dur = this.segElapsed(seg)
    return new Promise<void>((resolve) => {
      let done = false
      const finalize = async () => {
        if (done) return
        done = true
        await seg.writeChain
        const chunkCount = await db.chunks.where('segmentId').equals(seg.id).count()
        if (chunkCount === 0) {
          await db.segments.delete(seg.id)
        } else {
          // ak analyzátor nefungoval (nulová úroveň), radšej predpokladáme reč
          const hasSpeech = seg.policy.hasSpeech || seg.maxLevel < 1e-5
          await db.segments.update(seg.id, {
            durationSec: dur,
            hasSpeech,
            status: hasSpeech ? 'pending' : 'skipped',
            size: seg.size,
          })
          const l = await db.lectures.get(this.lectureId)
          if (l) await db.lectures.update(this.lectureId, { durationSec: Math.max(l.durationSec, seg.startSec + dur), updatedAt: Date.now() })
          notifySegments()
        }
        resolve()
      }
      seg.recorder.onstop = () => void finalize()
      // poistka: niektoré prehliadače po prerušení „stop“ nevyvolajú
      setTimeout(() => void finalize(), 4000)
      try {
        if (seg.recorder.state !== 'inactive') seg.recorder.stop()
        else void finalize()
      } catch {
        void finalize()
      }
    })
  }

  private tick() {
    const seg = this.seg
    let level = 0
    if (this.analyser && this.buf) {
      this.analyser.getFloatTimeDomainData(this.buf)
      level = rms(this.buf)
    }
    if (!seg) {
      this.set({ elapsedSec: this.baseSec, level: 0 })
      return
    }
    const elapsedMs = performance.now() - seg.startPerf
    seg.maxLevel = Math.max(seg.maxLevel, level)
    const cut = seg.policy.update(elapsedMs, level)
    this.set({ elapsedSec: seg.startSec + elapsedMs / 1000, level: meterValue(level) })
    if (cut && !this.rotating && recorderState.get().phase === 'recording') void this.rotate()
  }

  /** Zastaví aktuálny MediaRecorder a hneď spustí nový na tom istom streame. */
  private async rotate() {
    const old = this.seg
    if (!old) return
    this.rotating = true
    try {
      this.baseSec = old.startSec + this.segElapsed(old)
      await this.startSegment(false)
      await this.finishSegment(old)
    } catch (e) {
      console.error(e)
      void this.interrupt('Nepodarilo sa začať nový úsek nahrávky.')
    } finally {
      this.rotating = false
    }
  }

  /** Okamžite uloží, čo je nahraté (pri odchode z appky). */
  flush() {
    try {
      if (this.seg && this.seg.recorder.state === 'recording') this.seg.recorder.requestData()
    } catch {
      /* ignore */
    }
  }

  private onMute() {
    this.flush()
    if (this.muteTimer) clearTimeout(this.muteTimer)
    this.muteTimer = setTimeout(() => {
      const muted = this.stream?.getAudioTracks().some((t) => t.muted)
      if (muted && document.visibilityState === 'visible' && recorderState.get().phase === 'recording') {
        void this.interrupt('Mikrofón prestal posielať zvuk (systém ho prerušil).')
      }
    }, 3000)
  }

  private onUnmute() {
    if (this.muteTimer) clearTimeout(this.muteTimer)
    this.muteTimer = null
  }

  async onVisibility(visible: boolean) {
    if (!visible) {
      this.flush()
      return
    }
    const phase = recorderState.get().phase
    if (phase !== 'recording' && phase !== 'paused') return
    const ended = this.stream?.getAudioTracks().some((t) => t.readyState === 'ended')
    if (ended) {
      await this.interrupt('Nahrávanie bolo prerušené, keď si odišiel z appky alebo sa zamkla obrazovka.')
      return
    }
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
    await this.acquireWakeLock()
  }

  private async acquireWakeLock() {
    if (!('wakeLock' in navigator)) {
      this.set({ wakeLock: 'unsupported' })
      return
    }
    if (this.wakeLock && !this.wakeLock.released) return
    try {
      this.wakeLock = await navigator.wakeLock.request('screen')
      this.wakeLock.addEventListener('release', () => this.set({ wakeLock: 'off' }))
      this.set({ wakeLock: 'on' })
    } catch {
      this.set({ wakeLock: 'off' })
    }
  }

  async pause() {
    if (recorderState.get().phase !== 'recording' || !this.seg) return
    const seg = this.seg
    this.seg = null
    this.baseSec = seg.startSec + this.segElapsed(seg)
    this.set({ phase: 'paused', elapsedSec: this.baseSec, level: 0 })
    await this.finishSegment(seg)
  }

  async resume() {
    if (recorderState.get().phase !== 'paused') return
    const live = this.stream?.getAudioTracks().some((t) => t.readyState === 'live')
    if (!live) {
      await this.interrupt('Mikrofón sa medzitým vypol.')
      return
    }
    await this.startSegment(false)
    this.set({ phase: 'recording' })
    await this.acquireWakeLock()
  }

  async addMark(type: MarkType) {
    const t = recorderState.get().elapsedSec
    await db.marks.add({ id: uid(), lectureId: this.lectureId, type, t, createdAt: Date.now() })
    this.set({ lastMark: { type, t, at: Date.now() } })
    try {
      navigator.vibrate?.(30)
    } catch {
      /* iOS vibráciu nepodporuje */
    }
  }

  /** Prerušenie systémom – uloží rozpracovaný segment a čaká na „Pokračovať v nahrávaní“. */
  async interrupt(message: string) {
    const phase = recorderState.get().phase
    if (phase === 'interrupted' || phase === 'idle' || phase === 'stopping') return
    const seg = this.seg
    this.seg = null
    if (seg) this.baseSec = seg.startSec + this.segElapsed(seg)
    this.set({ phase: 'interrupted', error: message, level: 0, elapsedSec: this.baseSec })
    if (seg) await this.finishSegment(seg)
    await this.release()
    await db.lectures.update(this.lectureId, { interrupted: true, updatedAt: Date.now() })
  }

  private async release() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.muteTimer) clearTimeout(this.muteTimer)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.analyser = null
    await this.ctx?.close().catch(() => {})
    this.ctx = null
    try {
      await this.wakeLock?.release()
    } catch {
      /* ignore */
    }
    this.wakeLock = null
  }

  async stop() {
    const seg = this.seg
    this.seg = null
    this.set({ phase: 'stopping' })
    if (seg) await this.finishSegment(seg)
    await this.release()
    await finalizeLectureAfterRecording(this.lectureId)
    recorderState.set(initial)
  }
}

/** Po skončení nahrávania nastaví stav prednášky (prepis / chyba, ak nebola reč). */
export async function finalizeLectureAfterRecording(lectureId: string) {
  const segs = await db.segments.where('lectureId').equals(lectureId).toArray()
  const lecture = await db.lectures.get(lectureId)
  if (!lecture) return
  const durationSec = Math.max(lecture.durationSec, ...segs.map((s) => s.startSec + s.durationSec), 0)
  const toTranscribe = segs.filter((s) => s.status !== 'skipped')
  if (toTranscribe.length === 0) {
    await db.lectures.update(lectureId, {
      status: 'error',
      errorStep: 'transcribe',
      interrupted: false,
      durationSec,
      error: segs.length
        ? 'V nahrávke sa nenašla reč – bola príliš tichá. Ak si myslíš, že tam reč je, ťukni na „Prepísať aj tiché úseky“.'
        : 'Nahrávka je prázdna.',
      updatedAt: Date.now(),
    })
    return
  }
  await db.lectures.update(lectureId, { status: 'transcribing', interrupted: false, durationSec, updatedAt: Date.now() })
  notifySegments()
}

let session: RecordingSession | null = null

export function currentSession() {
  return session
}

/** Začne (alebo po prerušení obnoví) nahrávanie. Volať priamo z ťuknutia. */
export async function startRecording(lectureId: string, opts: { gapBefore?: boolean } = {}) {
  const unsupported = recordingSupported()
  if (unsupported) throw new Error(unsupported)
  if (session && recorderState.get().active && session.lectureId !== lectureId && recorderState.get().phase !== 'interrupted') {
    throw new Error('Už prebieha nahrávanie inej prednášky. Najprv ho ukonči.')
  }
  session = new RecordingSession(lectureId)
  try {
    await session.open(!!opts.gapBefore)
  } catch (e) {
    recorderState.set({ ...initial })
    session = null
    throw new Error(micErrorText(e))
  }
}

export async function pauseRecording() {
  await session?.pause()
}

export async function resumeRecording() {
  await session?.resume()
}

export async function stopRecording() {
  if (session) {
    await session.stop()
    session = null
  }
}

/** Ukončí prerušené nahrávanie bez pokračovania. */
export async function finishInterrupted(lectureId: string) {
  if (session && session.lectureId === lectureId) session = null
  recorderState.set({ ...initial })
  await finalizeLectureAfterRecording(lectureId)
}

export async function addMark(type: MarkType) {
  await session?.addMark(type)
}

/** Obnova po páde/zatvorení appky počas nahrávania: rozpracované segmenty pošle na prepis. */
export async function recoverRecordings() {
  if (recorderState.get().active) return
  const open = await db.segments.where('status').equals('recording').toArray()
  for (const s of open) {
    const n = await db.chunks.where('segmentId').equals(s.id).count()
    if (n === 0) await db.segments.delete(s.id)
    else
      await db.segments.update(s.id, {
        status: 'pending',
        hasSpeech: true,
        durationSec: Math.max(s.durationSec, (n - 0.5) * (TIMESLICE / 1000)),
      })
  }
  const lectures = await db.lectures.where('status').equals('recording').toArray()
  for (const l of lectures) {
    const segs = await db.segments.where('lectureId').equals(l.id).toArray()
    const durationSec = Math.max(l.durationSec, ...segs.map((s) => s.startSec + s.durationSec), 0)
    await db.lectures.update(l.id, { interrupted: true, durationSec })
  }
  if (open.length) notifySegments()
}

/** Globálne poslucháče (volá sa raz pri štarte appky). */
export function installRecorderGuards() {
  document.addEventListener('visibilitychange', () => {
    void session?.onVisibility(document.visibilityState === 'visible')
  })
  window.addEventListener('pagehide', () => session?.flush())
  window.addEventListener('beforeunload', (e) => {
    const p = recorderState.get().phase
    if (p === 'recording' || p === 'paused' || p === 'starting') {
      session?.flush()
      e.preventDefault()
      e.returnValue = ''
    }
  })
}
