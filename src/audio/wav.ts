/** Zakóduje mono PCM (Float32, −1..1) do 16-bit WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2
  const dataLen = samples.length * bytesPerSample
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + dataLen, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true) // veľkosť fmt chunku
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * bytesPerSample, true) // byte rate
  v.setUint16(32, bytesPerSample, true) // block align
  v.setUint16(34, 16, true) // bitov na vzorku
  str(36, 'data')
  v.setUint32(40, dataLen, true)
  let off = 44
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

/** Veľkosť WAV súboru pre daný počet sekúnd (16 kHz, 16 bit, mono ≈ 1,92 MB/min). */
export function wavBytes(seconds: number, sampleRate = 16000): number {
  return 44 + Math.round(seconds * sampleRate) * 2
}
