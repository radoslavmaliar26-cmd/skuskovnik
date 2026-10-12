import { useEffect, useRef, useState } from 'react'
import { groupLive, LANG_CODES, LiveSpeech, liveSpeechSupported } from '../audio/liveSpeech'
import { db } from '../db/db'
import type { MarkType } from '../db/types'
import { fmtTime, uid } from '../lib/text'
import { useLive } from '../ui/hooks'
import { TopBar } from '../ui/Layout'
import { navigate } from '../ui/router'
import { toast } from '../ui/toast'

/** Experimentálny režim: živý prepis cez Web Speech API (bez nahrávania zvuku). */
export function LivePage({ lectureId }: { lectureId?: string }) {
  const id = lectureId ?? ''
  const lecture = useLive(() => db.lectures.get(id), [id])
  const subject = useLive(async () => (lecture ? db.subjects.get(lecture.subjectId) : undefined), [lecture?.subjectId])
  const [parts, setParts] = useState<{ t: number; text: string }[]>([])
  const [interim, setInterim] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(0)
  const live = useRef<LiveSpeech | null>(null)
  const partsRef = useRef<{ t: number; text: string }[]>([])
  const wake = useRef<WakeLockSentinel | null>(null)

  // načítaj predchádzajúci text (pokračovanie)
  useEffect(() => {
    void db.transcripts.get(id).then((tr) => {
      const prev = (tr?.paragraphs ?? []).map((p) => ({ t: p.t, text: p.text }))
      partsRef.current = prev
      setParts(prev)
    })
  }, [id])

  const persist = async (list: { t: number; text: string }[], durationSec: number) => {
    await db.transcripts.put({ lectureId: id, paragraphs: groupLive(list), edited: false, updatedAt: Date.now() })
    await db.lectures.update(id, { durationSec: Math.round(durationSec), updatedAt: Date.now() })
  }

  useEffect(() => {
    const t = setInterval(() => setNow(live.current?.elapsed() ?? 0), 500)
    return () => {
      clearInterval(t)
      // pri odchode z obrazovky zastav a ulož
      if (live.current) {
        const dur = live.current.stop()
        void persist(partsRef.current, dur)
        void db.lectures.update(id, { status: partsRef.current.length ? 'transcribed' : 'draft' })
      }
      void wake.current?.release().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!lecture) return null
  const supported = liveSpeechSupported()

  const start = async () => {
    setError(null)
    const ls = new LiveSpeech(LANG_CODES[subject?.language ?? 'sk'] ?? 'sk-SK', {
      onFinal: (text, t) => {
        partsRef.current = [...partsRef.current, { t, text }]
        setParts(partsRef.current)
        void persist(partsRef.current, t)
      },
      onInterim: setInterim,
      onError: setError,
      onState: setRunning,
    })
    live.current = ls
    ls.start(lecture.durationSec || 0)
    await db.lectures.update(id, { status: 'recording', updatedAt: Date.now() })
    try {
      wake.current = await navigator.wakeLock?.request('screen')
    } catch {
      /* nepodporované */
    }
  }

  const stop = async () => {
    const dur = live.current?.stop() ?? lecture.durationSec
    live.current = null
    await persist(partsRef.current, dur)
    await db.lectures.update(id, { status: partsRef.current.length ? 'transcribed' : 'draft' })
    await wake.current?.release().catch(() => {})
    navigate(`/p/${id}/prepis`, true)
  }

  const mark = async (type: MarkType) => {
    const t = live.current?.elapsed() ?? 0
    await db.marks.add({ id: uid(), lectureId: id, type, t, createdAt: Date.now() })
    toast(`${type === 'exam' ? '🎯 Bude na skúške' : '⭐ Dôležité'} – ${fmtTime(t)}`, 'info', 1500)
  }

  return (
    <>
      <TopBar title={lecture.title} back={running ? undefined : '/'} />
      <div className="page">
        <div className="warn-box small">
          🧪 <b>Experimentálny živý prepis</b> (Web Speech API): text vzniká priamo v telefóne/u Apple, <b>zvuk sa neukladá</b>. Presnosť je nižšia ako pri bežnom nahrávaní s prepisom cez Groq.
        </div>
        {!supported ? <div className="err">Tento prehliadač živý prepis nepodporuje. Použi bežné nahrávanie.</div> : null}
        {error ? <div className="err small">{error}</div> : null}
        <div className="card center">
          <div className="small muted">{running ? '🔴 Počúvam…' : 'Zastavené'}</div>
          <div className="rec-timer">{fmtTime(running ? now : lecture.durationSec)}</div>
        </div>
        {running ? (
          <>
            <div className="mark-btns">
              <button className="btn secondary" onClick={() => void mark('star')}>
                <span className="e">⭐</span>Dôležité
              </button>
              <button className="btn danger" onClick={() => void mark('exam')}>
                <span className="e">🎯</span>Bude na skúške
              </button>
            </div>
            <button className="btn block red" onClick={() => void stop()}>
              ⏹ Ukončiť
            </button>
          </>
        ) : (
          <button className="btn block big red" disabled={!supported} onClick={() => void start()}>
            ● {parts.length ? 'Pokračovať v živom prepise' : 'Začať živý prepis'}
          </button>
        )}
        <div className="card" style={{ marginTop: 12 }}>
          {parts.length || interim ? (
            <>
              {parts.slice(-12).map((p, i) => (
                <p key={i} style={{ margin: '4px 0' }}>
                  <span className="time-link">{fmtTime(p.t)}</span> {p.text}
                </p>
              ))}
              {interim ? <p className="muted" style={{ margin: '4px 0' }}>{interim}</p> : null}
            </>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              Tu sa bude priebežne zobrazovať text.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
