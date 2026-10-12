import { describe, expect, it } from 'vitest'
import { containsSpeech, CutPolicy, findCutPoints, meterValue, mixToMono, rms } from './levels'
import { describeFile, extForMime } from './mime'
import { encodeWav, wavBytes } from './wav'

describe('WAV enkodér', () => {
  it('zapíše platnú hlavičku a dáta', () => {
    const s = new Float32Array([0, 1, -1, 0.5])
    const buf = encodeWav(s, 16000)
    const v = new DataView(buf)
    const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(buf, o, n))
    expect(str(0, 4)).toBe('RIFF')
    expect(str(8, 4)).toBe('WAVE')
    expect(str(36, 4)).toBe('data')
    expect(v.getUint32(4, true)).toBe(36 + 8)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint32(40, true)).toBe(8)
    expect(v.getInt16(44, true)).toBe(0)
    expect(v.getInt16(46, true)).toBe(32767)
    expect(v.getInt16(48, true)).toBe(-32768)
    expect(buf.byteLength).toBe(wavBytes(4 / 16000))
  })

  it('10 min pri 16 kHz je pod 25 MB', () => {
    expect(wavBytes(600)).toBeLessThan(20 * 1024 * 1024)
  })
})

describe('rez segmentu v tichu (CutPolicy)', () => {
  it('nereže pred cieľovou dĺžkou', () => {
    const p = new CutPolicy({ targetMs: 1000 })
    for (let t = 0; t < 1000; t += 100) expect(p.update(t, 0)).toBe(false)
  })

  it('po cieli čaká na 300 ms ticha', () => {
    const p = new CutPolicy({ targetMs: 1000 })
    let t = 0
    for (; t < 1000; t += 100) p.update(t, 0.2) // reč
    expect(p.update(1000, 0.2)).toBe(false)
    expect(p.update(1100, 0.001)).toBe(false) // začiatok ticha
    expect(p.update(1300, 0.001)).toBe(false)
    expect(p.update(1400, 0.001)).toBe(true) // 300 ms ticha
  })

  it('najneskôr po +30 s reže aj bez ticha', () => {
    const p = new CutPolicy({ targetMs: 1000 })
    let cut = false
    let t = 0
    for (; t <= 40_000 && !cut; t += 100) cut = p.update(t, 0.3)
    expect(cut).toBe(true)
    expect(t - 100).toBe(31_000)
  })

  it('rozpozná, či segment obsahoval reč', () => {
    const quiet = new CutPolicy({ targetMs: 10_000 })
    for (let t = 0; t < 10_000; t += 100) quiet.update(t, 0.003)
    expect(quiet.hasSpeech).toBe(false)
    const loud = new CutPolicy({ targetMs: 10_000 })
    for (let t = 0; t < 10_000; t += 100) loud.update(t, t % 400 < 200 ? 0.15 : 0.004)
    expect(loud.hasSpeech).toBe(true)
  })
})

describe('delenie dlhej nahrávky', () => {
  const sr = 100 // malá vzorkovacia frekvencia pre test
  it('reže v najtichšom mieste okolo hranice', () => {
    const sec = 35
    const s = new Float32Array(sec * sr).map((_, i) => Math.sin(i) * 0.5)
    // ticho v okolí 11. sekundy (hranica je 10 s, okno ±2 s)
    for (let i = 11 * sr; i < 11.3 * sr; i++) s[i] = 0
    const cuts = findCutPoints(s, sr, 10, 2)
    expect(cuts.length).toBeGreaterThanOrEqual(2)
    expect(cuts[0] / sr).toBeGreaterThanOrEqual(11)
    expect(cuts[0] / sr).toBeLessThanOrEqual(11.3)
    // ďalší rez je ~10 s po prvom
    expect((cuts[1] - cuts[0]) / sr).toBeGreaterThanOrEqual(8)
    expect((cuts[1] - cuts[0]) / sr).toBeLessThanOrEqual(12)
  })

  it('krátka nahrávka sa nedelí', () => {
    expect(findCutPoints(new Float32Array(5 * sr), sr, 10, 2)).toEqual([])
  })

  it('mono mix a hlasitosť', () => {
    const m = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])])
    expect(Array.from(m)).toEqual([0.5, 0.5])
    expect(rms(new Float32Array([1, -1]))).toBe(1)
    expect(meterValue(0)).toBe(0)
    expect(meterValue(1)).toBe(1)
    expect(containsSpeech(new Float32Array(10 * sr), sr)).toBe(false)
  })
})

describe('MIME a prípony', () => {
  it('mapuje MIME na príponu', () => {
    expect(extForMime('audio/mp4')).toBe('m4a')
    expect(extForMime('audio/webm;codecs=opus')).toBe('webm')
    expect(extForMime('audio/wav')).toBe('wav')
  })
  it('opisuje importovaný súbor', () => {
    expect(describeFile({ name: 'Nahravka 3.m4a', type: '' })).toEqual({ mime: 'audio/mp4', ext: 'm4a' })
    expect(describeFile({ name: 'x.MP3', type: 'audio/mpeg' })).toEqual({ mime: 'audio/mpeg', ext: 'mp3' })
  })
})
