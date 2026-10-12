import type { Lecture, Segment } from '../db/types'

export interface SegProgress {
  done: number
  total: number
  errors: number
}

export function segProgress(segs: Segment[]): SegProgress {
  const relevant = segs.filter((s) => s.status !== 'recording' && s.status !== 'skipped')
  return {
    done: relevant.filter((s) => s.status === 'done').length,
    total: relevant.length,
    errors: relevant.filter((s) => s.status === 'error').length,
  }
}

export function statusText(l: Lecture, p?: SegProgress): string {
  switch (l.status) {
    case 'draft':
      return 'Rozpracovaná'
    case 'recording':
      return l.interrupted ? 'Nahrávanie prerušené' : 'Nahráva sa'
    case 'transcribing':
      return p && p.total ? `Prepisuje sa (${p.done}/${p.total})` : 'Prepisuje sa'
    case 'transcribed':
      return 'Prepísaná – čaká na materiál'
    case 'generating':
      return 'Vytvára sa materiál'
    case 'done':
      return 'Hotovo'
    case 'error':
      return 'Chyba'
  }
}

export function StatusBadge({ l, p }: { l: Lecture; p?: SegProgress }) {
  const cls =
    l.status === 'done' ? 'ok' : l.status === 'error' ? 'skuska' : l.status === 'recording' ? 'skuska' : 'muted'
  return <span className={`badge ${cls}`}>{statusText(l, p)}</span>
}
