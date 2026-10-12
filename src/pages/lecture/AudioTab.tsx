import { useEffect, useMemo, useRef, useState } from 'react'
import { db, deleteLectureAudio, getSegmentBlob } from '../../db/db'
import type { Lecture, Segment } from '../../db/types'
import { fmtBytes, fmtTime } from '../../lib/text'
import { toast } from '../../ui/toast'

const SEG_STATUS: Record<Segment['status'], string> = {
  recording: 'nahráva sa',
  pending: 'čaká na prepis',
  transcribing: 'prepisuje sa…',
  done: 'prepísané',
  skipped: 'ticho – preskočené',
  error: 'chyba',
}

export function AudioTab({ lecture, segments, startT }: { lecture: Lecture; segments: Segment[]; startT?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const sorted = useMemo(() => [...segments].sort((a, b) => a.index - b.index), [segments])
  const [current, setCurrent] = useState<{ seg: Segment; url: string } | null>(null)
  const [pendingOffset, setPendingOffset] = useState<number | null>(null)
  const urlRef = useRef<string | null>(null)

  const segAt = (t: number) => {
    let found = sorted[0]
    for (const s of sorted) if (s.startSec <= t + 0.01) found = s
    return found
  }

  const load = async (seg: Segment) => {
    const blob = await getSegmentBlob(seg)
    if (!blob) {
      toast('Zvuk tohto úseku nie je k dispozícii.', 'error')
      return null
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const url = URL.createObjectURL(blob)
    urlRef.current = url
    setCurrent({ seg, url })
    return url
  }

  // predpriprav úsek pre „Prehrať od“ (aby sa play() dalo zavolať priamo z ťuknutia)
  useEffect(() => {
    if (!sorted.length || lecture.audioDeleted) return
    const seg = startT !== undefined ? segAt(startT) : sorted[0]
    if (!seg) return
    void load(seg).then(() => setPendingOffset(startT !== undefined ? Math.max(0, startT - seg.startSec) : null))
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startT, sorted.length, lecture.audioDeleted])

  const playFrom = (offset: number) => {
    const a = audioRef.current
    if (!a) return
    const go = () => {
      try {
        a.currentTime = offset
      } catch {
        /* ignore */
      }
      void a.play().catch(() => {})
    }
    if (a.readyState >= 1) go()
    else a.addEventListener('loadedmetadata', go, { once: true })
  }

  const onEnded = async () => {
    if (!current) return
    const next = sorted.find((s) => s.index > current.seg.index && s.status !== 'recording')
    if (!next) return
    const url = await load(next)
    if (url && audioRef.current) {
      audioRef.current.src = url
      void audioRef.current.play().catch(() => {})
    }
  }

  const removeAudio = async () => {
    if (!confirm('Zmazať zvuk tejto prednášky? Prepis, materiál aj testy zostanú. Uvoľní sa miesto v telefóne.')) return
    await deleteLectureAudio(lecture.id)
    setCurrent(null)
    toast('Audio zmazané')
  }

  const totalSize = sorted.reduce((s, x) => s + (x.size || 0), 0)

  return (
    <div>
      {lecture.audioDeleted ? (
        <div className="info-box">Zvuk tejto prednášky bol zmazaný (prepis a materiál zostali).</div>
      ) : sorted.length === 0 ? (
        <div className="empty">Táto prednáška nemá zvukovú nahrávku{lecture.source === 'text' || lecture.source === 'demo' ? ' (prepis bol vložený ako text)' : ''}.</div>
      ) : (
        <div className="card">
          {current ? (
            <>
              <div className="small muted">
                Úsek {current.seg.index + 1} · od {fmtTime(current.seg.startSec)}
              </div>
              <audio ref={audioRef} src={current.url} controls preload="metadata" style={{ width: '100%', marginTop: 6 }} onEnded={() => void onEnded()} />
            </>
          ) : (
            <div className="muted small">Načítavam…</div>
          )}
          {startT !== undefined && current ? (
            <button className="btn block" style={{ marginTop: 10 }} onClick={() => playFrom(pendingOffset ?? 0)}>
              ▶︎ Prehrať od {fmtTime(startT)}
            </button>
          ) : null}
        </div>
      )}

      {sorted.length ? (
        <>
          <div className="section-title">Úseky nahrávky</div>
          <div className="list">
            {sorted.map((s) => (
              <div key={s.id} className="list-item" style={{ cursor: 'default' }}>
                <div className="grow">
                  <div className="title">
                    Úsek {s.index + 1} · {fmtTime(s.startSec)}–{fmtTime(s.startSec + s.durationSec)}
                    {s.gapBefore ? ' · po prerušení' : ''}
                  </div>
                  <div className="sub">
                    {SEG_STATUS[s.status]}
                    {s.status === 'pending' && s.nextAttemptAt > Date.now() ? ` · ďalší pokus o ${fmtTime((s.nextAttemptAt - Date.now()) / 1000)}` : ''}
                    {s.size ? ` · ${fmtBytes(s.size)}` : ''} · .{s.ext}
                  </div>
                  {s.error && s.status !== 'done' ? <div className="small" style={{ color: 'var(--red)' }}>{s.error}</div> : null}
                </div>
                {!lecture.audioDeleted ? (
                  <button
                    className="btn small ghost"
                    onClick={async () => {
                      const url = await load(s)
                      if (url && audioRef.current) {
                        audioRef.current.src = url
                        void audioRef.current.play().catch(() => {})
                      }
                    }}
                  >
                    ▶︎
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {!lecture.audioDeleted ? (
            <button className="btn block danger" onClick={() => void removeAudio()}>
              🗑 Zmazať audio ({fmtBytes(totalSize)}) – prepis zostane
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export async function lectureHasAudio(lectureId: string) {
  const segs = await db.segments.where('lectureId').equals(lectureId).primaryKeys()
  return segs.length > 0
}
