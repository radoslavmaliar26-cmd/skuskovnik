/**
 * Experimentálny živý prepis cez Web Speech API (webkitSpeechRecognition).
 * Bez nahrávania zvuku – výsledkom je priamo text s časmi.
 */

interface SRResult {
  isFinal: boolean
  0: { transcript: string }
}
interface SREvent {
  resultIndex: number
  results: ArrayLike<SRResult>
}
interface SpeechRec {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SRCtor = new () => SpeechRec

function ctor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function liveSpeechSupported(): boolean {
  return typeof window !== 'undefined' && !!ctor()
}

export const LANG_CODES: Record<string, string> = { sk: 'sk-SK', cs: 'cs-CZ', en: 'en-US', auto: 'sk-SK' }

export interface LiveCallbacks {
  onFinal: (text: string, t: number) => void
  onInterim: (text: string) => void
  onError: (message: string) => void
  onState: (running: boolean) => void
}

export class LiveSpeech {
  private rec: SpeechRec | null = null
  private active = false
  private startedAt = 0
  private offset = 0
  private restarts = 0
  private cb: LiveCallbacks
  private lang: string

  constructor(lang: string, cb: LiveCallbacks) {
    this.lang = lang
    this.cb = cb
  }

  /** Čas od začiatku (s), vrátane predchádzajúcich častí. */
  elapsed() {
    return this.offset + (this.active ? (performance.now() - this.startedAt) / 1000 : 0)
  }

  start(offsetSec = 0) {
    const C = ctor()
    if (!C) {
      this.cb.onError('Tento prehliadač nepodporuje živý prepis (Web Speech API).')
      return
    }
    this.offset = offsetSec
    this.startedAt = performance.now()
    this.active = true
    this.restarts = 0
    this.spawn(C)
    this.cb.onState(true)
  }

  private spawn(C: SRCtor) {
    const rec = new C()
    rec.lang = this.lang
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const text = r[0]?.transcript ?? ''
        if (r.isFinal) {
          if (text.trim()) this.cb.onFinal(text.trim(), this.elapsed())
        } else interim += text
      }
      this.cb.onInterim(interim)
      this.restarts = 0
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.active = false
        this.cb.onError('Prístup k mikrofónu alebo rozpoznávaniu reči je zamietnutý (Nastavenia iPhonu → Safari / Siri a diktovanie).')
        this.cb.onState(false)
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.cb.onError(`Rozpoznávanie reči: ${e.error}`)
      }
    }
    // Safari po chvíli ticha rozpoznávanie ukončí – automaticky ho reštartujeme
    rec.onend = () => {
      if (!this.active) return
      if (this.restarts++ > 20) {
        this.active = false
        this.cb.onError('Rozpoznávanie sa opakovane zastavilo. Skús to znova.')
        this.cb.onState(false)
        return
      }
      setTimeout(() => {
        if (this.active) this.spawn(C)
      }, 250)
    }
    this.rec = rec
    try {
      rec.start()
    } catch (err) {
      this.cb.onError(`Rozpoznávanie sa nepodarilo spustiť: ${(err as Error).message}`)
    }
  }

  stop(): number {
    const t = this.elapsed()
    this.active = false
    try {
      this.rec?.stop()
    } catch {
      /* ignore */
    }
    this.rec = null
    this.cb.onState(false)
    return t
  }
}

/** Zoskupí vety do odsekov (~45 s). */
export function groupLive(parts: { t: number; text: string }[], maxSec = 45): { t: number; text: string }[] {
  const out: { t: number; text: string }[] = []
  for (const p of parts) {
    const last = out[out.length - 1]
    if (!last || p.t - last.t > maxSec) out.push({ t: Math.round(p.t), text: p.text })
    else last.text += ' ' + p.text
  }
  return out
}
