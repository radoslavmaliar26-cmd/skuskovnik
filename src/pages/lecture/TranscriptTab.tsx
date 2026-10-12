import { useMemo, useState } from 'react'
import { db } from '../../db/db'
import type { Lecture, Mark, Paragraph, Transcript } from '../../db/types'
import { CUE_LABELS, findCues, type Cue } from '../../exam/examCues'
import { fmtTime } from '../../lib/text'
import { highlight, searchRanges, type Range } from '../../ui/Highlight'
import { PhotoStrip } from '../../ui/Photos'
import { toast } from '../../ui/toast'

const CUE_ICON = { skuska: '🔴', dolezite: '🟠', organizacne: '📅' } as const

export function TranscriptTab({
  lecture,
  transcript,
  marks,
  focusT,
}: {
  lecture: Lecture
  transcript: Transcript | undefined
  marks: Mark[]
  focusT?: number
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [onlyCues, setOnlyCues] = useState(false)
  const paragraphs = useMemo(() => transcript?.paragraphs ?? [], [transcript])
  const cues = useMemo(() => findCues(paragraphs, lecture.durationSec), [paragraphs, lecture.durationSec])

  const cuesByPara = useMemo(() => {
    const m = new Map<number, Cue[]>()
    for (const c of cues) m.set(c.paragraph, [...(m.get(c.paragraph) ?? []), c])
    return m
  }, [cues])

  const marksByPara = useMemo(() => {
    const m = new Map<number, Mark[]>()
    for (const mk of marks) {
      let idx = 0
      for (let i = 0; i < paragraphs.length; i++) if (paragraphs[i].t <= mk.t) idx = i
      m.set(idx, [...(m.get(idx) ?? []), mk])
    }
    return m
  }, [marks, paragraphs])

  const focusIdx = useMemo(() => {
    if (focusT === undefined) return -1
    let idx = -1
    for (let i = 0; i < paragraphs.length; i++) if (paragraphs[i].t <= focusT + 1) idx = i
    return idx
  }, [focusT, paragraphs])

  if (!paragraphs.length) {
    return <div className="empty">Prepis zatiaľ nie je k dispozícii.</div>
  }

  const save = async (i: number) => {
    const next: Paragraph[] = paragraphs.map((p, j) => (j === i ? { ...p, text: draft.trim() } : p)).filter((p) => p.text)
    await db.transcripts.put({ lectureId: lecture.id, paragraphs: next, edited: true, updatedAt: Date.now() })
    setEditing(null)
    toast('Prepis uložený')
  }

  const counts = { skuska: 0, dolezite: 0, organizacne: 0 }
  cues.forEach((c) => counts[c.typ]++)
  const matches = query.trim().length >= 2 ? paragraphs.filter((p) => searchRanges(p.text, query).length).length : null

  return (
    <div>
      <div className="card flat small">
        Nájdené frázy: <span className="badge skuska">🔴 Na skúške {counts.skuska}</span>{' '}
        <span className="badge dolezite">🟠 Dôležité {counts.dolezite}</span>{' '}
        <span className="badge organizacne">📅 Organizačné {counts.organizacne}</span>
        <div className="row" style={{ marginTop: 10 }}>
          <input type="search" placeholder="Hľadať v prepise…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={onlyCues} onChange={(e) => setOnlyCues(e.target.checked)} />
          Len odseky s nájdenými frázami a značkami
        </label>
        {matches !== null ? <div className="muted">Výsledky: {matches} {matches === 1 ? 'odsek' : 'odsekov'}</div> : null}
      </div>
      <PhotoStrip lectureId={lecture.id} />
      {transcript?.edited ? <p className="small muted">✏️ Prepis bol ručne upravený.</p> : null}
      <div className="card">
        {paragraphs.map((p, i) => {
          const pc = cuesByPara.get(i) ?? []
          const pm = (marksByPara.get(i) ?? []).filter((m) => m.type !== 'gap')
          const gap = (marksByPara.get(i) ?? []).some((m) => m.type === 'gap')
          const sr = searchRanges(p.text, query)
          if (query.trim().length >= 2 && !sr.length) return null
          if (onlyCues && !pc.length && !pm.length) return null
          const ranges: Range[] = [...sr, ...pc.map((c) => ({ start: c.start, end: c.end, cls: c.typ, title: CUE_LABELS[c.typ] }))]
          return (
            <div key={i} className="para" id={`para-${i}`} style={i === focusIdx ? { background: 'var(--yellow-soft)', borderRadius: 8 } : undefined}>
              <div className="t">
                <a className="time-link" href={`#/p/${lecture.id}/audio?t=${Math.floor(p.t)}`}>
                  {fmtTime(p.t)}
                </a>
              </div>
              <div className="txt">
                {gap ? <div className="small muted">⏸ Medzera v nahrávke (nahrávanie bolo prerušené)</div> : null}
                {pm.length ? (
                  <div className="row wrap" style={{ marginBottom: 4 }}>
                    {pm.map((m) => (
                      <span key={m.id} className={`badge ${m.type === 'exam' ? 'skuska' : 'oznacene'}`}>
                        {m.type === 'exam' ? '🎯 Označil si: na skúške' : '⭐ Označil si'} {fmtTime(m.t)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {editing === i ? (
                  <div className="stack">
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 160 }} />
                    <div className="btn-row">
                      <button className="btn small" onClick={() => void save(i)}>
                        Uložiť
                      </button>
                      <button className="btn small ghost" onClick={() => setEditing(null)}>
                        Zrušiť
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span>{highlight(p.text, ranges)}</span>{' '}
                    {pc.length ? <span className="small">{[...new Set(pc.map((c) => CUE_ICON[c.typ]))].join('')}</span> : null}
                    <button
                      className="time-link no-print"
                      style={{ marginLeft: 6, background: 'transparent' }}
                      onClick={() => {
                        setEditing(i)
                        setDraft(p.text)
                      }}
                      aria-label="Upraviť odsek"
                    >
                      ✏️
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
