import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import type { Segment } from '../db/types'
import { ApiError, retryDelayMs } from '../lib/httpErrors'
import { collapseRepeats, filterHallucinations } from './hallucinations'
import { MockTranscriptionProvider, OpenAICompatibleProvider, supportsVerbose } from './provider'
import { buildPrompt, TranscriptionQueue } from './queue'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

describe('OpenAI-kompatibilný klient (Groq/OpenAI)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('Groq: správna URL, hlavička a polia formulára (verbose_json)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ text: 'Ahoj svet', segments: [{ start: 0, end: 2.5, text: ' Ahoj svet', no_speech_prob: 0.01, avg_logprob: -0.2 }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = new OpenAICompatibleProvider({ name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1/', apiKey: ' gsk_test ', model: 'whisper-large-v3' })
    const r = await p.transcribe({ file: new Blob(['x'], { type: 'audio/mp4' }), filename: 'usek-1.m4a', language: 'sk', prompt: 'napätie' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test')
    const fd = init.body as FormData
    expect((fd.get('file') as File).name).toBe('usek-1.m4a')
    expect(fd.get('model')).toBe('whisper-large-v3')
    expect(fd.get('language')).toBe('sk')
    expect(fd.get('temperature')).toBe('0')
    expect(fd.get('prompt')).toBe('napätie')
    expect(fd.get('response_format')).toBe('verbose_json')
    expect(fd.getAll('timestamp_granularities[]')).toEqual(['segment'])
    expect(r.timed).toBe(true)
    expect(r.parts[0]).toMatchObject({ start: 0, end: 2.5, text: 'Ahoj svet', noSpeechProb: 0.01 })
  })

  it('OpenAI gpt-4o-transcribe: len json, bez language pri auto', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: 'Text' }))
    vi.stubGlobal('fetch', fetchMock)
    const p = new OpenAICompatibleProvider({ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', model: 'gpt-4o-transcribe' })
    const r = await p.transcribe({ file: new Blob(['x']), filename: 'a.webm', language: 'auto', durationSec: 30 })
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const fd = calls[0][1].body as FormData
    expect(calls[0][0]).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(fd.get('response_format')).toBe('json')
    expect(fd.get('language')).toBeNull()
    expect(r).toMatchObject({ timed: false, parts: [{ start: 0, end: 30, text: 'Text' }] })
    expect(supportsVerbose('whisper-1')).toBe(true)
    expect(supportsVerbose('gpt-4o-mini-transcribe')).toBe(false)
  })

  it('pri chybe formátu zopakuje s json', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'response_format verbose_json is not supported' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ text: 'OK' }))
    vi.stubGlobal('fetch', fetchMock)
    const p = new OpenAICompatibleProvider({ name: 'X', baseUrl: 'https://x/v1', apiKey: 'k', model: 'whisper-x' })
    const r = await p.transcribe({ file: new Blob(['x']), filename: 'a.wav', durationSec: 10 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[1][1].body as FormData).get('response_format')).toBe('json')
    expect(r.text).toBe('OK')
  })

  it('rozlišuje chyby: zlý kľúč, limit s retry-after, príliš veľký súbor, sieť', async () => {
    const p = new OpenAICompatibleProvider({ name: 'Groq', baseUrl: 'https://x/v1', apiKey: 'k', model: 'gpt-4o-transcribe' })
    const req = { file: new Blob(['x']), filename: 'a.m4a' }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'Invalid API Key' } }, 401)))
    await expect(p.transcribe(req)).rejects.toMatchObject({ kind: 'auth' })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'Rate limit' } }, 429, { 'retry-after': '7' })))
    await expect(p.transcribe(req)).rejects.toMatchObject({ kind: 'rate', retryAfterSec: 7 })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'Request Entity Too Large' } }, 413)))
    await expect(p.transcribe(req)).rejects.toMatchObject({ kind: 'tooLarge' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(p.transcribe(req)).rejects.toMatchObject({ kind: 'network' })
  })

  it('test kľúča volá GET /models', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new OpenAICompatibleProvider({ name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'm' }).testKey()
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0][0]).toBe('https://api.groq.com/openai/v1/models')
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer k')
  })
})

describe('filtrovanie halucinácií', () => {
  it('vyhodí ticho podľa metadát a typické vety', () => {
    const out = filterHallucinations(
      [
        { start: 0, end: 5, text: 'Dnes budeme hovoriť o napätí.', noSpeechProb: 0.01, avgLogprob: -0.2 },
        { start: 5, end: 10, text: 'Ďakujem za pozornosť.', noSpeechProb: 0.7, avgLogprob: -1.2 },
        { start: 10, end: 15, text: 'Titulky vytvoril JohnyX', noSpeechProb: 0.2, avgLogprob: -0.5 },
        { start: 15, end: 20, text: 'Ďakujem za pozornosť.', noSpeechProb: 0.4, avgLogprob: -0.3 },
        { start: 20, end: 25, text: 'Napätie je sila na plochu.', noSpeechProb: 0.02, avgLogprob: -0.1 },
        { start: 25, end: 30, text: 'Napätie je sila na plochu.', noSpeechProb: 0.02, avgLogprob: -0.1 },
      ],
      { timed: true },
    )
    expect(out.map((p) => p.text)).toEqual(['Dnes budeme hovoriť o napätí.', 'Napätie je sila na plochu.'])
  })

  it('ponechá „Ďakujem za pozornosť“, keď je to reálna reč', () => {
    const out = filterHallucinations([{ start: 0, end: 3, text: 'Ďakujem za pozornosť.', noSpeechProb: 0.01, avgLogprob: -0.1 }], { timed: true })
    expect(out).toHaveLength(1)
  })

  it('zruší zacyklené opakovania', () => {
    expect(collapseRepeats('Toto je veta. Toto je veta. Toto je veta. Iná veta.')).toBe('Toto je veta. Iná veta.')
    expect(collapseRepeats('a potom a potom a potom a potom a potom koniec')).toBe('a potom koniec')
  })
})

describe('retry a prompt', () => {
  it('exponenciálne čakanie a retry-after', () => {
    expect(retryDelayMs('server', 1)).toBe(5000)
    expect(retryDelayMs('server', 2)).toBe(10000)
    expect(retryDelayMs('network', 3)).toBe(20000)
    expect(retryDelayMs('rate', 1, 30)).toBe(30000)
    expect(retryDelayMs('server', 6)).toBeNull()
    expect(retryDelayMs('auth', 1)).toBeNull()
    expect(retryDelayMs('tooLarge', 1)).toBeNull()
  })

  it('prompt = slovník + koniec predchádzajúceho segmentu, max 600 znakov', () => {
    const p = buildPrompt('Hookov zákon, napätie', 'x '.repeat(500) + 'koniec vety')
    expect(p.length).toBeLessThanOrEqual(600)
    expect(p.startsWith('Hookov zákon, napätie')).toBe(true)
    expect(p.endsWith('koniec vety')).toBe(true)
    expect(buildPrompt('', '')).toBe('')
  })
})

describe('fronta prepisu', () => {
  let now = 1_000_000
  beforeEach(async () => {
    await db.delete()
    await db.open()
    now = 1_000_000
    await db.subjects.add({ id: 's', name: 'P', language: 'sk', glossary: 'pojem', createdAt: 1 })
    await db.lectures.add({ id: 'l', subjectId: 's', title: 'T', createdAt: 1, source: 'record', status: 'transcribing', durationSec: 600, updatedAt: 1 })
    for (let i = 0; i < 2; i++) {
      const seg: Segment = {
        id: `g${i}`, lectureId: 'l', index: i, startSec: i * 300, durationSec: 300, mime: 'audio/mp4', ext: 'm4a',
        hasSpeech: true, status: 'pending', attempts: 0, nextAttemptAt: 0, size: 3, createdAt: i,
      }
      await db.segments.add(seg)
      await db.chunks.add({ segmentId: seg.id, seq: 0, data: new Uint8Array([1, 2, 3]).buffer })
    }
  })

  it('prepíše segmenty postupne, posunie časy a zloží prepis', async () => {
    const provider = new MockTranscriptionProvider((req) => ({
      text: req.filename,
      timed: true,
      parts: [{ start: 1, end: 4, text: `Text ${req.filename}.` }],
    }))
    const q = new TranscriptionQueue({ getProvider: async () => provider, now: () => now, isOnline: () => true })
    await q.drain()
    expect(provider.calls.map((c) => c.filename)).toEqual(['usek-1.m4a', 'usek-2.m4a'])
    expect(provider.calls[0].language).toBe('sk')
    expect(provider.calls[1].prompt).toContain('Text usek-1.m4a.')
    const segs = (await db.segments.toArray()).sort((a, b) => a.index - b.index)
    expect(segs.every((s) => s.status === 'done')).toBe(true)
    expect(segs[1].parts?.[0].start).toBe(301)
    const l = await db.lectures.get('l')
    expect(l?.status).toBe('transcribed')
    const tr = await db.transcripts.get('l')
    expect(tr?.paragraphs.map((p) => p.t)).toEqual([1, 301])
  })

  it('pri 429 čaká podľa retry-after a potom pokračuje', async () => {
    let fail = true
    const provider = new MockTranscriptionProvider(() => {
      if (fail) {
        fail = false
        throw new ApiError('rate', 'limit', { status: 429, retryAfterSec: 20 })
      }
      return { text: 'ok', timed: false, parts: [{ start: 0, end: 300, text: 'ok' }] }
    })
    const q = new TranscriptionQueue({ getProvider: async () => provider, now: () => now, isOnline: () => true })
    await q.drain()
    let s0 = await db.segments.get('g0')
    expect(s0).toMatchObject({ status: 'pending', attempts: 1, nextAttemptAt: now + 20_000, errorKind: 'rate' })
    // druhý segment medzitým prebehol
    expect((await db.segments.get('g1'))?.status).toBe('done')
    now += 21_000
    await q.drain()
    s0 = await db.segments.get('g0')
    expect(s0?.status).toBe('done')
    expect((await db.lectures.get('l'))?.status).toBe('transcribed')
  })

  it('zlý kľúč zastaví frontu bez plytvania pokusmi', async () => {
    const provider = new MockTranscriptionProvider(() => {
      throw new ApiError('auth', 'zlý kľúč', { status: 401 })
    })
    const q = new TranscriptionQueue({ getProvider: async () => provider, now: () => now, isOnline: () => true })
    await q.drain()
    expect(provider.calls).toHaveLength(1)
    expect((await db.segments.get('g0'))?.status).toBe('pending')
  })

  it('trvalá chyba (príliš veľký súbor) → stav chyby prednášky', async () => {
    const provider = new MockTranscriptionProvider(() => {
      throw new ApiError('tooLarge', 'príliš veľký', { status: 413 })
    })
    const q = new TranscriptionQueue({ getProvider: async () => provider, now: () => now, isOnline: () => true })
    await q.drain()
    const l = await db.lectures.get('l')
    expect(l?.status).toBe('error')
    expect(l?.error).toMatch(/2 z 2/)
  })

  it('bez kľúča a offline nič neposiela', async () => {
    const provider = new MockTranscriptionProvider(() => ({ text: '', timed: false, parts: [] }))
    await new TranscriptionQueue({ getProvider: async () => null, now: () => now, isOnline: () => true }).drain()
    await new TranscriptionQueue({ getProvider: async () => provider, now: () => now, isOnline: () => false }).drain()
    expect(provider.calls).toHaveLength(0)
  })
})
