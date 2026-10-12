import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, saveSettings } from '../db/db'
import { DEMO_MATERIAL } from '../demo/demoMaterial'
import { DEMO_TRANSCRIPT } from '../demo/demoTranscript'
import { parsePastedTranscript } from '../transcription/assemble'
import { AnthropicProvider, MockLlmProvider, supportsForcedTool, type StructuredRequest } from './anthropic'
import { generateMaterialApi, setLlmProviderForTests } from './jobs'
import { buildMaterialPrompt, splitParagraphs } from './prompts'
import { jsonSchemaFor, MaterialSchema } from './schema'

function sse(events: Record<string, unknown>[], splitEvery = 37): Response {
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      // pošli po kúskoch, aby sa otestovalo skladanie riadkov
      for (let i = 0; i < text.length; i += splitEvery) c.enqueue(enc.encode(text.slice(i, i + splitEvery)))
      c.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function toolEvents(input: unknown, stop = 'tool_use') {
  const json = JSON.stringify(input)
  const half = Math.floor(json.length / 2)
  return [
    { type: 'message_start', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 1234 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'ulozit_material', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(0, half) } },
    { type: 'ping' },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(half) } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5678 } },
    { type: 'message_stop' },
  ]
}

const baseReq = (model = 'claude-sonnet-5-5'): StructuredRequest => ({
  model,
  system: 'sys',
  user: 'prompt',
  toolName: 'ulozit_material',
  toolDescription: 'desc',
  inputSchema: jsonSchemaFor(MaterialSchema),
  maxTokens: 64000,
})

describe('Anthropic klient', () => {
  it('posiela správne hlavičky a telo, číta stream nástroja', async () => {
    const fetchMock = vi.fn(async (_u: string, _i: RequestInit) => sse(toolEvents({ a: 1, b: 'čšž \\frac' })))
    const p = new AnthropicProvider(' sk-ant-test ', { fetchImpl: fetchMock as unknown as typeof fetch })
    const progress: number[] = []
    const r = await p.structured({ ...baseReq(), onProgress: (x) => progress.push(x.chars) })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const h = init.headers as Record<string, string>
    expect(h['x-api-key']).toBe('sk-ant-test')
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(h['content-type']).toBe('application/json')
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 64000, stream: true, system: 'sys' })
    expect(body.messages).toEqual([{ role: 'user', content: 'prompt' }])
    expect(body.tools[0]).toMatchObject({ name: 'ulozit_material', description: 'desc', eager_input_streaming: true })
    expect(body.tools[0].input_schema.type).toBe('object')
    // Sonnet 5.5 nepodporuje vynútený nástroj → auto
    expect(body.tool_choice).toEqual({ type: 'auto' })
    expect(r.input).toEqual({ a: 1, b: 'čšž \\frac' })
    expect(r.stopReason).toBe('tool_use')
    expect(r.usage).toEqual({ input: 1234, output: 5678 })
    expect(progress.length).toBeGreaterThan(0)
  })

  it('pri starších modeloch vynúti nástroj', async () => {
    expect(supportsForcedTool('claude-haiku-4-5')).toBe(true)
    expect(supportsForcedTool('claude-opus-5-5')).toBe(false)
    const fetchMock = vi.fn(async (_u: string, _i: RequestInit) => sse(toolEvents({ ok: true })))
    const p = new AnthropicProvider('k', { fetchImpl: fetchMock as unknown as typeof fetch })
    await p.structured(baseReq('claude-haiku-4-5'))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'ulozit_material' })
    expect(body.fallbacks).toBeUndefined()
  })

  it('pri 400 kvôli tool_choice zopakuje s auto', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'tool_choice: type "tool" is not supported for this model.' } }), { status: 400 }))
      .mockResolvedValueOnce(sse(toolEvents({ ok: true })))
    const p = new AnthropicProvider('k', { fetchImpl: fetchMock as unknown as typeof fetch })
    const r = await p.structured(baseReq('claude-new-model'))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tool_choice.type).toBe('tool')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tool_choice.type).toBe('auto')
    expect(r.input).toEqual({ ok: true })
  })

  it('pri 529 a 429 opakuje (rešpektuje retry-after)', async () => {
    const sleeps: number[] = []
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"type":"overloaded_error","message":"Overloaded"}}', { status: 529 }))
      .mockResolvedValueOnce(new Response('{"error":{"message":"rate"}}', { status: 429, headers: { 'retry-after': '3' } }))
      .mockResolvedValueOnce(sse(toolEvents({ ok: 1 })))
    const p = new AnthropicProvider('k', { fetchImpl: fetchMock as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms) })
    const r = await p.structured(baseReq())
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sleeps[1]).toBe(3000)
    expect(r.input).toEqual({ ok: 1 })
  })

  it('zlý kľúč neopakuje', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 }))
    const p = new AnthropicProvider('k', { fetchImpl: fetchMock as unknown as typeof fetch, sleep: async () => {} })
    await expect(p.structured(baseReq())).rejects.toMatchObject({ kind: 'auth' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('zoznam modelov a stop_reason max_tokens', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }] })))
    const p = new AnthropicProvider('k', { fetchImpl: fetchMock as unknown as typeof fetch })
    expect(await p.listModels()).toEqual([{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }])
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0][0]).toBe('https://api.anthropic.com/v1/models?limit=100')
    const events = toolEvents({ a: 1 }, 'max_tokens')
    // useknutý JSON
    ;(events[6] as { delta: { partial_json: string } }).delta.partial_json = '"x'
    const p2 = new AnthropicProvider('k', { fetchImpl: (async () => sse(events)) as unknown as typeof fetch })
    const r = await p2.structured(baseReq())
    expect(r.stopReason).toBe('max_tokens')
    expect(r.input).toBeNull()
  })
})

describe('prompt materiálu', () => {
  it('obsahuje pravidlá, kandidátov, značky a prepis; režim A aj schému', () => {
    const paragraphs = parsePastedTranscript(DEMO_TRANSCRIPT)
    const a = buildMaterialPrompt({
      title: 'T', subject: 'P', paragraphs, marks: [{ id: 'm', lectureId: 'l', type: 'exam', t: 125, createdAt: 0 }],
      allowSupplement: true, examShare: 50, mode: 'claudeApp',
    })
    expect(a).toContain('Doplnenie (mimo prednášky)')
    expect(a).toContain('JSON SCHÉMA VÝSTUPU')
    expect(a).toContain('iba jedným blokom kódu'.replace('iba', 'IBA'))
    expect(a).toContain('[02:05] 🎯')
    expect(a).toContain('(SKÚŠKA) „Definícia napätia aj s jednotkami, toto bude na skúške, takže si to dobre naučte.“')
    expect(a).toContain('[00:00] Dobrý deň')
    expect(a).toContain('Aspoň 50 %')
    const b = buildMaterialPrompt({ title: 'T', subject: 'P', paragraphs, marks: [], allowSupplement: false, examShare: 70, mode: 'api' })
    expect(b).not.toContain('JSON SCHÉMA')
    expect(b).toContain('Nepridávaj žiadne informácie mimo prednášky')
    expect(b).toContain('zavolaním nástroja')
  })

  it('rozdelí odseky na časti', () => {
    const paragraphs = parsePastedTranscript(DEMO_TRANSCRIPT)
    const parts = splitParagraphs(paragraphs, 2)
    expect(parts).toHaveLength(2)
    expect(parts[0].length + parts[1].length).toBe(paragraphs.length)
  })
})

describe('generovanie materiálu cez API (end-to-end s mockom)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await saveSettings({ keys: { groq: '', openai: '', custom: '', anthropic: 'sk-ant-x' } })
    await db.subjects.add({ id: 's', name: 'Pružnosť', language: 'sk', glossary: '', createdAt: 1 })
    await db.lectures.add({ id: 'l', subjectId: 's', title: 'Prednáška 1', createdAt: 1, source: 'text', status: 'transcribed', durationSec: 2500, updatedAt: 1 })
    await db.transcripts.put({ lectureId: 'l', paragraphs: parsePastedTranscript(DEMO_TRANSCRIPT), edited: false, updatedAt: 1 })
  })
  afterEach(() => setLlmProviderForTests(null))

  it('uloží materiál, overí citáty, vytvorí test a kartičky', async () => {
    const mock = new MockLlmProvider(() => ({ input: DEMO_MATERIAL, rawToolJson: '', text: '', stopReason: 'tool_use', usage: { input: 10, output: 20 }, model: 'm' }))
    setLlmProviderForTests(mock)
    await generateMaterialApi('l')
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].model).toBe('claude-sonnet-5-5')
    const mat = await db.materials.get('l')
    expect(mat?.mode).toBe('api')
    expect(mat?.data.naSkuske.every((n) => n.overene)).toBe(true)
    expect((await db.lectures.get('l'))?.status).toBe('done')
    const tests = await db.tests.where('lectureId').equals('l').toArray()
    expect(tests[0].questions).toHaveLength(DEMO_MATERIAL.test.length)
    expect(await db.cards.where('lectureId').equals('l').count()).toBe(DEMO_MATERIAL.karticky.length)
    expect((await db.usage.get('total'))?.outputTokens).toBe(20)
  })

  it('vymyslený citát označí ako neoverený', async () => {
    const m = structuredClone(DEMO_MATERIAL)
    m.naSkuske[0].citat = 'Toto je úplne vymyslená veta, ktorú vyučujúci nikdy nepovedal na prednáške.'
    setLlmProviderForTests(new MockLlmProvider(() => ({ input: m, rawToolJson: '', text: '', stopReason: 'tool_use', usage: { input: 1, output: 1 }, model: 'm' })))
    await generateMaterialApi('l')
    const mat = await db.materials.get('l')
    expect(mat?.data.naSkuske[0].overene).toBe(false)
    expect(mat?.data.naSkuske[1].overene).toBe(true)
  })

  it('pri max_tokens rozdelí prednášku na časti a spojí ich', async () => {
    const mock = new MockLlmProvider((_req, n) =>
      n === 1
        ? { input: null, rawToolJson: '{"naz', text: '', stopReason: 'max_tokens', usage: { input: 1, output: 1 }, model: 'm' }
        : { input: DEMO_MATERIAL, rawToolJson: '', text: '', stopReason: 'tool_use', usage: { input: 1, output: 1 }, model: 'm' },
    )
    setLlmProviderForTests(mock)
    await generateMaterialApi('l')
    expect(mock.calls).toHaveLength(3)
    expect(String(mock.calls[1].user)).toContain('ČASŤ 1 Z 2')
    const mat = await db.materials.get('l')
    expect(mat?.data.sekcie.length).toBe(DEMO_MATERIAL.sekcie.length * 2)
    expect(new Set(mat?.data.test.map((q) => q.id)).size).toBe(DEMO_MATERIAL.test.length * 2)
  })

  it('chyba → stav prednášky „chyba“ s krokom generovania', async () => {
    setLlmProviderForTests(new MockLlmProvider(() => ({ input: { nazov: 1 }, rawToolJson: '', text: '', stopReason: 'tool_use', usage: { input: 1, output: 1 }, model: 'm' })))
    await expect(generateMaterialApi('l')).rejects.toThrow()
    const l = await db.lectures.get('l')
    expect(l).toMatchObject({ status: 'error', errorStep: 'generate' })
  })
})
