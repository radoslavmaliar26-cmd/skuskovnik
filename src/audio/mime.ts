/** Výber formátu nahrávania a odvodenie prípon. */

const CANDIDATES = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const m of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m
    } catch {
      /* staršie prehliadače */
    }
  }
  return undefined
}

/** Prípona súboru podľa MIME (pre API prepisu je dôležitá správna prípona). */
export function extForMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return m.includes('aac') && !m.includes('mp4') ? 'aac' : 'm4a'
  if (m.includes('webm')) return 'webm'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('wav')) return 'wav'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('flac')) return 'flac'
  return 'm4a'
}

const EXT_MIME: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  mpga: 'audio/mpeg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  caf: 'audio/x-caf',
}

/** Zistí MIME a príponu importovaného súboru (Safari niekedy nevyplní file.type). */
export function describeFile(file: { name: string; type: string }): { mime: string; ext: string } {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (EXT_MIME[ext]) {
    // .mp4 posielame ako .mp4 (API ho prijíma), ostatné podľa prípony
    return { mime: file.type || EXT_MIME[ext], ext }
  }
  const mime = file.type || 'audio/mp4'
  return { mime, ext: extForMime(mime) }
}

/** Formáty, ktoré API prepisu (Whisper/OpenAI) prijíma priamo. */
export const API_EXTS = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm']
