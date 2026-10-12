import type { Settings, TranscriptionProviderId } from '../db/types'
import { ApiError, errorFromResponse, networkError } from '../lib/httpErrors'

export interface RawPart {
  start: number
  end: number
  text: string
  noSpeechProb?: number
  avgLogprob?: number
  compressionRatio?: number
}

export interface TranscribeRequest {
  file: Blob
  filename: string
  /** sk | cs | en | auto */
  language?: string
  prompt?: string
  /** Dĺžka nahrávky (s) – použije sa, ak API nevráti časy */
  durationSec?: number
  signal?: AbortSignal
}

export interface TranscribeResult {
  text: string
  /** Časy relatívne k začiatku súboru */
  parts: RawPart[]
  /** API vrátilo presné časy (verbose_json) */
  timed: boolean
}

export interface TranscriptionProvider {
  readonly name: string
  transcribe(req: TranscribeRequest): Promise<TranscribeResult>
  testKey(signal?: AbortSignal): Promise<void>
}

export const PROVIDERS: Record<TranscriptionProviderId, { label: string; baseUrl: string; models: string[]; keyUrl?: string }> = {
  groq: {
    label: 'Groq (bezplatný limit)',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['whisper-large-v3', 'whisper-large-v3-turbo'],
    keyUrl: 'https://console.groq.com/keys',
  },
  openai: {
    label: 'OpenAI (platený)',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1', 'gpt-transcribe'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  custom: {
    label: 'Vlastný (OpenAI-kompatibilný)',
    baseUrl: '',
    models: ['whisper-1', 'whisper-large-v3'],
  },
}

/** Modely gpt-4o-* (a novšie gpt-transcribe) podporujú len response_format=json. */
export function supportsVerbose(model: string): boolean {
  return !/^gpt-(4o|transcribe)/i.test(model.trim())
}

export class OpenAICompatibleProvider implements TranscriptionProvider {
  readonly name: string
  private baseUrl: string
  private apiKey: string
  private model: string

  constructor(opts: { name: string; baseUrl: string; apiKey: string; model: string }) {
    this.name = opts.name
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey.trim()
    this.model = opts.model.trim()
  }

  private form(req: TranscribeRequest, verbose: boolean): FormData {
    const fd = new FormData()
    fd.append('file', req.file, req.filename)
    fd.append('model', this.model)
    if (req.language && req.language !== 'auto') fd.append('language', req.language)
    fd.append('temperature', '0')
    if (req.prompt) fd.append('prompt', req.prompt)
    if (verbose) {
      fd.append('response_format', 'verbose_json')
      fd.append('timestamp_granularities[]', 'segment')
    } else {
      fd.append('response_format', 'json')
    }
    return fd
  }

  private async post(req: TranscribeRequest, verbose: boolean): Promise<TranscribeResult> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: this.form(req, verbose),
        signal: req.signal,
      })
    } catch (e) {
      throw networkError(e, this.name)
    }
    if (!res.ok) throw await errorFromResponse(res, this.name)
    let j: Record<string, unknown>
    try {
      j = await res.json()
    } catch {
      throw new ApiError('badRequest', `${this.name}: služba vrátila neplatnú odpoveď.`)
    }
    const text = typeof j.text === 'string' ? j.text : ''
    const segs = Array.isArray(j.segments) ? (j.segments as Record<string, unknown>[]) : null
    if (verbose && segs) {
      return {
        text,
        timed: true,
        parts: segs.map((s) => ({
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          text: String(s.text ?? '').trim(),
          noSpeechProb: typeof s.no_speech_prob === 'number' ? s.no_speech_prob : undefined,
          avgLogprob: typeof s.avg_logprob === 'number' ? s.avg_logprob : undefined,
          compressionRatio: typeof s.compression_ratio === 'number' ? s.compression_ratio : undefined,
        })),
      }
    }
    const duration = typeof j.duration === 'number' ? j.duration : (req.durationSec ?? 0)
    return { text, timed: false, parts: text.trim() ? [{ start: 0, end: duration, text: text.trim() }] : [] }
  }

  async transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    if (!this.apiKey) throw new ApiError('auth', `${this.name}: chýba API kľúč. Zadaj ho v Nastaveniach.`)
    if (!supportsVerbose(this.model)) return this.post(req, false)
    try {
      return await this.post(req, true)
    } catch (e) {
      // model nepodporuje verbose_json → zopakuj s json (čas = začiatok segmentu)
      if (e instanceof ApiError && (e.kind === 'format' || (e.kind === 'badRequest' && e.status === 400))) {
        return this.post(req, false)
      }
      throw e
    }
  }

  async testKey(signal?: AbortSignal) {
    if (!this.apiKey) throw new ApiError('auth', 'Najprv zadaj kľúč.')
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/models`, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal })
    } catch (e) {
      throw networkError(e, this.name)
    }
    if (!res.ok) throw await errorFromResponse(res, this.name)
  }
}

/** Testovací/demo poskytovateľ – vráti zadaný text. */
export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'Mock'
  calls: TranscribeRequest[] = []
  private impl: (req: TranscribeRequest, call: number) => TranscribeResult | Promise<TranscribeResult>
  constructor(impl: (req: TranscribeRequest, call: number) => TranscribeResult | Promise<TranscribeResult>) {
    this.impl = impl
  }
  async transcribe(req: TranscribeRequest) {
    this.calls.push(req)
    return this.impl(req, this.calls.length)
  }
  async testKey() {}
}

export function providerFromSettings(s: Settings): TranscriptionProvider | null {
  const id = s.provider
  const key = s.keys[id]?.trim()
  if (!key) return null
  const baseUrl = id === 'custom' ? s.customBaseUrl.trim() : PROVIDERS[id].baseUrl
  if (!baseUrl) return null
  return new OpenAICompatibleProvider({
    name: id === 'groq' ? 'Groq' : id === 'openai' ? 'OpenAI' : 'Vlastný server',
    baseUrl,
    apiKey: key,
    model: s.models[id] || PROVIDERS[id].models[0] || 'whisper-1',
  })
}
