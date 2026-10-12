import { ApiError, errorFromResponse, networkError, retryDelayMs, type ApiErrorKind } from '../lib/httpErrors'

/**
 * Klient Anthropic Messages API priamo z prehliadača (fetch + SSE stream).
 * Štruktúrovaný výstup cez nástroj (tool) s input_schema.
 */

export const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'
export const ANTHROPIC_VERSION = '2023-06-01'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export interface StructuredRequest {
  model: string
  system: string
  /** Text alebo bloky obsahu (text + obrázky) */
  user: string | ContentBlock[]
  toolName: string
  toolDescription: string
  inputSchema: Record<string, unknown>
  maxTokens: number
  onProgress?: (p: { chars: number; phase: 'thinking' | 'writing' }) => void
  signal?: AbortSignal
}

export interface StructuredResult {
  /** Vstup nástroja (už ako objekt), alebo null ak model nástroj nezavolal / JSON je useknutý */
  input: unknown | null
  /** Surový JSON nástroja (aj useknutý) */
  rawToolJson: string
  /** Text mimo nástroja */
  text: string
  stopReason: string | null
  usage: { input: number; output: number }
  model: string
}

export interface LlmProvider {
  structured(req: StructuredRequest): Promise<StructuredResult>
  listModels(signal?: AbortSignal): Promise<{ id: string; name: string }[]>
}

/** Modely, ktoré odmietajú vynútený nástroj (tool_choice typu „tool“/„any“ → 400). */
export function supportsForcedTool(model: string): boolean {
  return !/(sonnet-5-5|opus-5-5|fable-5-1|mythos-5-1)/.test(model)
}

/** Modely, pri ktorých posielame server-side fallback pri odmietnutí (refusal). */
export function supportsFallbacks(model: string): boolean {
  return /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5-1)$/.test(model)
}

interface Variant {
  forced: boolean
  eager: boolean
  fallbacks: boolean
}

function errorKindFromStreamType(t: string | undefined): ApiErrorKind {
  if (t === 'overloaded_error') return 'overloaded'
  if (t === 'rate_limit_error') return 'rate'
  if (t === 'api_error') return 'server'
  if (t === 'authentication_error' || t === 'permission_error') return 'auth'
  return 'badRequest'
}

export class AnthropicProvider implements LlmProvider {
  private apiKey: string
  private fetchImpl: typeof fetch
  private sleep: (ms: number) => Promise<void>

  constructor(apiKey: string, opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}) {
    this.apiKey = apiKey.trim()
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a))
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...extra,
    }
  }

  async listModels(signal?: AbortSignal) {
    if (!this.apiKey) throw new ApiError('auth', 'Najprv zadaj Anthropic kľúč.')
    let res: Response
    try {
      res = await this.fetchImpl(`${ANTHROPIC_BASE}/models?limit=100`, { headers: this.headers(), signal })
    } catch (e) {
      throw networkError(e, 'Anthropic')
    }
    if (!res.ok) throw await errorFromResponse(res, 'Anthropic')
    const j = (await res.json()) as { data?: { id: string; display_name?: string }[] }
    return (j.data ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.id }))
  }

  private body(req: StructuredRequest, v: Variant) {
    const tool: Record<string, unknown> = {
      name: req.toolName,
      description: req.toolDescription,
      input_schema: req.inputSchema,
    }
    if (v.eager) tool.eager_input_streaming = true
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      stream: true,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      tools: [tool],
      tool_choice: v.forced ? { type: 'tool', name: req.toolName } : { type: 'auto' },
    }
    if (v.fallbacks) body.fallbacks = 'default'
    return body
  }

  async structured(req: StructuredRequest): Promise<StructuredResult> {
    if (!this.apiKey) throw new ApiError('auth', 'Chýba Anthropic API kľúč. Zadaj ho v Nastaveniach.')
    let v: Variant = { forced: supportsForcedTool(req.model), eager: true, fallbacks: supportsFallbacks(req.model) }
    let attempts = 0
    let degraded = false
    for (;;) {
      attempts++
      try {
        return await this.once(req, v)
      } catch (e) {
        if (!(e instanceof ApiError)) throw e
        // 400 kvôli voliteľným parametrom → skús jednoduchšiu variantu
        if (e.kind === 'badRequest' && e.status === 400 && !degraded) {
          const m = e.message
          const next = { ...v }
          if (/tool_choice/i.test(m)) next.forced = false
          if (/eager_input_streaming/i.test(m)) next.eager = false
          if (/fallback/i.test(m)) next.fallbacks = false
          if (/thinking/i.test(m) && v.forced) next.forced = false
          if (next.forced === v.forced && next.eager === v.eager && next.fallbacks === v.fallbacks) {
            // chyba nesúvisí s voliteľnými parametrami; ak sú ešte nejaké zapnuté, skús raz bez nich
            if (!v.forced && !v.eager && !v.fallbacks) throw e
            if (!/tool|eager|fallback|beta|thinking|unexpected|extra inputs/i.test(m)) throw e
            degraded = true
            v = { forced: false, eager: false, fallbacks: false }
          } else {
            v = next
          }
          continue
        }
        const delay = retryDelayMs(e.kind === 'offline' ? 'network' : e.kind, attempts, e.retryAfterSec, 4)
        if (delay === null || e.kind === 'offline') throw e
        await this.sleep(Math.min(delay, 60_000))
      }
    }
  }

  private async once(req: StructuredRequest, v: Variant): Promise<StructuredResult> {
    let res: Response
    const extra: Record<string, string> = v.fallbacks ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}
    try {
      res = await this.fetchImpl(`${ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: this.headers(extra),
        body: JSON.stringify(this.body(req, v)),
        signal: req.signal,
      })
    } catch (e) {
      throw networkError(e, 'Anthropic')
    }
    if (!res.ok) throw await errorFromResponse(res, 'Anthropic')
    if (!res.body) throw new ApiError('server', 'Anthropic: odpoveď neobsahuje dáta.')
    return this.readStream(res.body, req)
  }

  private async readStream(stream: ReadableStream<Uint8Array>, req: StructuredRequest): Promise<StructuredResult> {
    const reader = stream.getReader()
    const dec = new TextDecoder()
    let buf = ''
    const blocks: { type: string; name?: string; json: string; text: string }[] = []
    let stopReason: string | null = null
    const usage = { input: 0, output: 0 }
    let model = req.model
    let chars = 0
    let lastReport = 0

    const handle = (raw: string) => {
      const data = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (!data) return
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(data)
      } catch {
        return
      }
      switch (ev.type) {
        case 'message_start': {
          const msg = ev.message as { usage?: { input_tokens?: number }; model?: string }
          usage.input = msg?.usage?.input_tokens ?? 0
          if (msg?.model) model = msg.model
          break
        }
        case 'content_block_start': {
          const cb = ev.content_block as { type: string; name?: string }
          blocks[ev.index as number] = { type: cb.type, name: cb.name, json: '', text: '' }
          if (cb.type === 'thinking') req.onProgress?.({ chars, phase: 'thinking' })
          break
        }
        case 'content_block_delta': {
          const d = ev.delta as { type: string; partial_json?: string; text?: string }
          const b = blocks[ev.index as number]
          if (!b) break
          if (d.type === 'input_json_delta' && d.partial_json) {
            b.json += d.partial_json
            chars += d.partial_json.length
          } else if (d.type === 'text_delta' && d.text) {
            b.text += d.text
            chars += d.text.length
          }
          if (chars - lastReport > 400) {
            lastReport = chars
            req.onProgress?.({ chars, phase: 'writing' })
          }
          break
        }
        case 'message_delta': {
          const d = ev.delta as { stop_reason?: string }
          if (d?.stop_reason) stopReason = d.stop_reason
          const u = ev.usage as { output_tokens?: number; input_tokens?: number } | undefined
          if (u?.output_tokens) usage.output = u.output_tokens
          if (u?.input_tokens) usage.input = u.input_tokens
          break
        }
        case 'error': {
          const err = ev.error as { type?: string; message?: string }
          const kind = errorKindFromStreamType(err?.type)
          throw new ApiError(kind, `Anthropic: ${err?.message ?? 'chyba počas generovania'}`)
        }
      }
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          handle(raw)
        }
      }
      if (buf.trim()) handle(buf)
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw networkError(e, 'Anthropic')
    }

    req.onProgress?.({ chars, phase: 'writing' })
    const tool = blocks.find((b) => b?.type === 'tool_use' && b.name === req.toolName) ?? blocks.find((b) => b?.type === 'tool_use')
    const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('')
    let input: unknown | null = null
    if (tool) {
      try {
        input = tool.json.trim() ? JSON.parse(tool.json) : null
      } catch {
        input = null
      }
    }
    if (stopReason === 'refusal') {
      throw new ApiError('badRequest', 'Claude odmietol túto požiadavku (bezpečnostný filter). Skús to cez Claude appku alebo uprav prepis.')
    }
    return { input, rawToolJson: tool?.json ?? '', text, stopReason, usage, model }
  }
}

/** Testovací poskytovateľ. */
export class MockLlmProvider implements LlmProvider {
  calls: StructuredRequest[] = []
  private impl: (req: StructuredRequest, n: number) => StructuredResult | Promise<StructuredResult>
  constructor(impl: (req: StructuredRequest, n: number) => StructuredResult | Promise<StructuredResult>) {
    this.impl = impl
  }
  async structured(req: StructuredRequest) {
    this.calls.push(req)
    return this.impl(req, this.calls.length)
  }
  async listModels() {
    return [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }]
  }
}
