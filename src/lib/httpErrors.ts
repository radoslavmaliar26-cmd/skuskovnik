/** Spoločné triedenie chýb pri volaní API (prepis aj Claude) so slovenskými vysvetleniami. */

export type ApiErrorKind =
  | 'auth'
  | 'rate'
  | 'tooLarge'
  | 'offline'
  | 'network'
  | 'badRequest'
  | 'format'
  | 'server'
  | 'overloaded'
  | 'noAudio'
  | 'aborted'
  | 'unknown'

export class ApiError extends Error {
  kind: ApiErrorKind
  status?: number
  retryAfterSec?: number
  constructor(kind: ApiErrorKind, message: string, opts: { status?: number; retryAfterSec?: number } = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = opts.status
    this.retryAfterSec = opts.retryAfterSec
  }
}

export function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined
  const n = Number(h)
  if (Number.isFinite(n)) return Math.max(0, n)
  const d = Date.parse(h)
  if (Number.isFinite(d)) return Math.max(0, (d - Date.now()) / 1000)
  return undefined
}

/** Vytiahne zrozumiteľnú správu z tela chyby (OpenAI/Groq/Anthropic tvar). */
export async function readErrorMessage(res: Response): Promise<string> {
  try {
    const text = await res.text()
    try {
      const j = JSON.parse(text)
      return j?.error?.message ?? j?.message ?? text.slice(0, 300)
    } catch {
      return text.slice(0, 300)
    }
  } catch {
    return ''
  }
}

/** Prevedie HTTP odpoveď s chybou na ApiError so slovenským popisom. */
export async function errorFromResponse(res: Response, service: string): Promise<ApiError> {
  const msg = await readErrorMessage(res)
  const retryAfterSec = parseRetryAfter(res.headers.get('retry-after'))
  const s = res.status
  const detail = msg ? ` (${msg})` : ''
  if (s === 401 || s === 403)
    return new ApiError('auth', `${service}: kľúč je neplatný alebo nemá oprávnenie. Skontroluj ho v Nastaveniach.${detail}`, { status: s })
  if (s === 413 || /too large|maximum.*size|file size/i.test(msg))
    return new ApiError('tooLarge', `${service}: súbor je príliš veľký (limit 25 MB).${detail}`, { status: s })
  if (s === 429)
    return new ApiError('rate', `${service}: dosiahol si limit požiadaviek. Appka to skúsi znova o chvíľu.${detail}`, { status: s, retryAfterSec })
  if (s === 529)
    return new ApiError('overloaded', `${service}: služba je momentálne preťažená. Skúsi sa znova.${detail}`, { status: s, retryAfterSec })
  if (s >= 500)
    return new ApiError('server', `${service}: chyba na strane služby (${s}). Skúsi sa znova.${detail}`, { status: s, retryAfterSec })
  if (s === 400 && /response_format|verbose_json|timestamp_granularities/i.test(msg))
    return new ApiError('format', `${service}: model nepodporuje formát s časmi.${detail}`, { status: s })
  if (s === 404)
    return new ApiError('badRequest', `${service}: model alebo adresa neexistuje – skontroluj názov modelu a URL v Nastaveniach.${detail}`, { status: s })
  return new ApiError('badRequest', `${service}: požiadavka bola odmietnutá (${s}).${detail}`, { status: s })
}

/** Chyba z fetch (bez HTTP odpovede) – offline, sieť alebo CORS. */
export function networkError(e: unknown, service: string): ApiError {
  if ((e as Error)?.name === 'AbortError') return new ApiError('aborted', 'Zrušené.')
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return new ApiError('offline', 'Si offline. Prepis a generovanie počkajú, kým bude internet.')
  return new ApiError(
    'network',
    `${service}: nepodarilo sa spojiť so serverom. Skontroluj internet; ak používaš vlastnú URL, server musí povoliť prístup z prehliadača (CORS).`,
  )
}

/** Či má zmysel požiadavku automaticky opakovať. */
export function isRetryable(kind: ApiErrorKind): boolean {
  return kind === 'rate' || kind === 'server' || kind === 'overloaded' || kind === 'network' || kind === 'offline'
}

/**
 * Exponenciálne čakanie: 5 s, 10 s, 20 s … max 5 min; pri 429 rešpektuje retry-after.
 * Vráti null, ak sa už opakovať nemá.
 */
export function retryDelayMs(kind: ApiErrorKind, attempts: number, retryAfterSec?: number, maxAttempts = 6): number | null {
  if (!isRetryable(kind)) return null
  if (kind === 'offline') return 0 // čaká sa na udalosť „online“
  if (attempts >= maxAttempts) return null
  if (retryAfterSec !== undefined && (kind === 'rate' || kind === 'overloaded' || kind === 'server')) {
    return Math.min(15 * 60_000, Math.max(1000, retryAfterSec * 1000))
  }
  return Math.min(5 * 60_000, 5000 * 2 ** Math.max(0, attempts - 1))
}
