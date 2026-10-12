/** Výpočet hlasitosti a rozhodovanie, kedy rezať segment (čisté funkcie – testovateľné). */

export function rms(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  let sum = 0
  const n = Math.max(1, to - from)
  for (let i = from; i < to; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / n)
}

/** Hlasitosť 0..1 pre ukazovateľ (logaritmicky, −60 dB → 0, 0 dB → 1). */
export function meterValue(level: number): number {
  if (level <= 0) return 0
  const db = 20 * Math.log10(level)
  return Math.max(0, Math.min(1, (db + 60) / 60))
}

export interface CutPolicyOptions {
  /** Cieľová dĺžka segmentu (ms) */
  targetMs: number
  /** Ako dlho musí trvať ticho, aby sme rezali (ms) */
  silenceMs?: number
  /** Najviac koľko po cieľovej dĺžke čakáme na ticho (ms) */
  maxExtraMs?: number
}

/**
 * Sleduje hlasitosť počas segmentu. Po dosiahnutí cieľovej dĺžky čaká na krátke ticho
 * (~300 ms pod prahom), najviac +30 s; potom povie „rež“. Zároveň zisťuje, či segment obsahoval reč.
 */
export class CutPolicy {
  private silenceStart: number | null = null
  private noiseFloor = 0.01
  speechMs = 0
  private lastT: number | null = null
  readonly targetMs: number
  readonly silenceMs: number
  readonly maxExtraMs: number

  constructor(opts: CutPolicyOptions) {
    this.targetMs = opts.targetMs
    this.silenceMs = opts.silenceMs ?? 300
    this.maxExtraMs = opts.maxExtraMs ?? 30_000
  }

  get silenceThreshold() {
    return Math.max(0.006, Math.min(0.05, this.noiseFloor * 1.8))
  }

  get speechThreshold() {
    return Math.max(0.02, this.noiseFloor * 3)
  }

  /**
   * @param elapsedMs čas od začiatku segmentu
   * @param level RMS hlasitosť 0..1
   * @returns true = teraz rezať
   */
  update(elapsedMs: number, level: number): boolean {
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(1000, elapsedMs - this.lastT))
    this.lastT = elapsedMs
    // pomaly sledovaná úroveň šumu pozadia
    if (level < this.noiseFloor) this.noiseFloor = this.noiseFloor * 0.8 + level * 0.2
    else this.noiseFloor = this.noiseFloor * 0.999 + level * 0.001
    if (level > this.speechThreshold) this.speechMs += dt

    if (level < this.silenceThreshold) {
      if (this.silenceStart === null) this.silenceStart = elapsedMs
    } else {
      this.silenceStart = null
    }
    if (elapsedMs < this.targetMs) return false
    if (elapsedMs >= this.targetMs + this.maxExtraMs) return true
    return this.silenceStart !== null && elapsedMs - this.silenceStart >= this.silenceMs
  }

  /** Segment obsahoval reč (aspoň ~1 s nad prahom reči; radšej prepísať ticho ako stratiť reč). */
  get hasSpeech() {
    return this.speechMs >= 1000
  }
}

/**
 * Nájde body rezu pre dlhú nahrávku: približne každých targetSec, v najtichšom mieste
 * ±windowSec okolo hranice (meria sa po 100 ms rámcoch). Vráti indexy vzoriek (bez 0 a konca).
 */
export function findCutPoints(samples: Float32Array, sampleRate: number, targetSec = 600, windowSec = 10): number[] {
  const total = samples.length
  const target = Math.round(targetSec * sampleRate)
  const win = Math.round(windowSec * sampleRate)
  const frame = Math.max(1, Math.round(sampleRate * 0.1))
  const cuts: number[] = []
  let last = 0
  while (total - last > target + win) {
    const center = last + target
    const from = Math.max(last + frame, center - win)
    const to = Math.min(total - frame, center + win)
    let best = center
    let bestLevel = Infinity
    for (let s = from; s + frame <= to; s += frame) {
      const l = rms(samples, s, s + frame)
      if (l < bestLevel) {
        bestLevel = l
        best = s + Math.floor(frame / 2)
      }
    }
    cuts.push(best)
    last = best
  }
  return cuts
}

/** Zmieša kanály AudioBuffer-u do mono. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const len = channels[0].length
  const out = new Float32Array(len)
  for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i]
  const k = 1 / channels.length
  for (let i = 0; i < len; i++) out[i] *= k
  return out
}

/** Či časť nahrávky obsahuje reč (hrubý odhad podľa podielu hlasných rámcov). */
export function containsSpeech(samples: Float32Array, sampleRate: number): boolean {
  const frame = Math.round(sampleRate * 0.1)
  let loud = 0
  for (let s = 0; s + frame <= samples.length; s += frame) if (rms(samples, s, s + frame) > 0.02) loud++
  return loud * 0.1 >= 1.5
}
