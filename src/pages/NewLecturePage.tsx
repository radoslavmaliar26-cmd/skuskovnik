import { useEffect, useRef, useState } from 'react'
import { ImportError, importAudioFile } from '../audio/importer'
import { createLecture, createSubject, db, deleteLecture } from '../db/db'
import type { Lang } from '../db/types'
import { fmtBytes, fmtDate } from '../lib/text'
import { parsePastedTranscript } from '../transcription/assemble'
import { liveSpeechSupported } from '../audio/liveSpeech'
import { useLive } from '../ui/hooks'
import { Progress, TopBar } from '../ui/Layout'
import { navigate } from '../ui/router'

type Source = 'nahravat' | 'import' | 'text' | 'zivy'
const NEW = '__new__'

export function NewLecturePage({ query }: { query: URLSearchParams }) {
  const subjects = useLive(() => db.subjects.orderBy('createdAt').toArray(), [])
  const lastLecture = useLive(() => db.lectures.orderBy('createdAt').last(), [])
  const [subjectId, setSubjectId] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [lang, setLang] = useState<Lang>('sk')
  const [title, setTitle] = useState(() => `Prednáška ${fmtDate(Date.now())}`)
  const [source, setSource] = useState<Source>((query.get('zdroj') as Source) || 'nahravat')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [frac, setFrac] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const z = query.get('zdroj') as Source | null
    if (z) setSource(z)
  }, [query])

  // predvolený predmet: z URL, inak predmet poslednej prednášky
  useEffect(() => {
    if (subjectId || !subjects) return
    const fromQuery = query.get('predmet')
    if (fromQuery && subjects.some((s) => s.id === fromQuery)) setSubjectId(fromQuery)
    else if (lastLecture && subjects.some((s) => s.id === lastLecture.subjectId)) setSubjectId(lastLecture.subjectId)
    else if (subjects.length) setSubjectId(subjects[subjects.length - 1].id)
    else setSubjectId(NEW)
  }, [subjects, lastLecture, subjectId, query])

  const resolveSubject = async () => {
    if (subjectId === NEW || !subjectId) {
      if (!newName.trim()) throw new Error('Zadaj názov nového predmetu.')
      return (await createSubject(newName, lang)).id
    }
    return subjectId
  }

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  const startRecord = () =>
    run(async () => {
      const sid = await resolveSubject()
      const l = await createLecture(sid, title, 'record')
      navigate(`/nahravat/${l.id}`, true)
    })

  const onFile = (file: File | undefined) =>
    run(async () => {
      if (!file) return
      const sid = await resolveSubject()
      const l = await createLecture(sid, title, 'import')
      setBusy('Importujem…')
      try {
        await importAudioFile(l.id, file, (t, f) => {
          setBusy(t)
          if (f !== undefined) setFrac(f)
        })
      } catch (e) {
        await deleteLecture(l.id)
        throw e instanceof ImportError ? e : new Error(`Import zlyhal: ${(e as Error).message}`)
      }
      navigate(`/p/${l.id}`, true)
    })

  const startLive = () =>
    run(async () => {
      const sid = await resolveSubject()
      const l = await createLecture(sid, title, 'live')
      navigate(`/zivy/${l.id}`, true)
    })

  const saveText = () =>
    run(async () => {
      const paragraphs = parsePastedTranscript(text)
      if (!paragraphs.length) throw new Error('Vlož text prepisu.')
      const sid = await resolveSubject()
      const l = await createLecture(sid, title, 'text')
      const last = paragraphs[paragraphs.length - 1]
      const durationSec = Math.round(last.t + last.text.split(/\s+/).length / 2.3)
      await db.transcripts.put({ lectureId: l.id, paragraphs, edited: false, updatedAt: Date.now() })
      await db.lectures.update(l.id, { status: 'transcribed', durationSec })
      navigate(`/p/${l.id}`, true)
    })

  return (
    <>
      <TopBar title="Nová prednáška" back />
      <div className="page">
        <div className="card">
          <label className="field">
            <span>Predmet</span>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {(subjects ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value={NEW}>＋ Nový predmet…</option>
            </select>
          </label>
          {subjectId === NEW ? (
            <>
              <label className="field">
                <span>Názov nového predmetu</span>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="napr. Pružnosť a pevnosť" />
              </label>
              <label className="field">
                <span>Jazyk prednášok</span>
                <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                  <option value="sk">Slovenčina</option>
                  <option value="cs">Čeština</option>
                  <option value="en">Angličtina</option>
                  <option value="auto">Rozpoznať automaticky</option>
                </select>
              </label>
            </>
          ) : null}
          <label className="field">
            <span>Názov prednášky</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>

        <div className="section-title">Zdroj</div>
        <div className="seg" role="tablist">
          <button className={source === 'nahravat' ? 'on' : ''} onClick={() => setSource('nahravat')}>
            🎙 Nahrávať
          </button>
          <button className={source === 'import' ? 'on' : ''} onClick={() => setSource('import')}>
            📁 Importovať
          </button>
          <button className={source === 'text' ? 'on' : ''} onClick={() => setSource('text')}>
            📝 Vložiť text
          </button>
        </div>
        {liveSpeechSupported() ? (
          <p className="small center" style={{ margin: '8px 0 0' }}>
            <button className={`btn small ${source === 'zivy' ? '' : 'ghost'}`} onClick={() => setSource('zivy')}>
              🧪 Živý prepis (experimentálne)
            </button>
          </p>
        ) : null}
        <div className="spacer" />

        {error ? <div className="err">{error}</div> : null}

        {source === 'nahravat' ? (
          <div className="card">
            <p className="small muted" style={{ marginTop: 0 }}>
              Na ďalšej obrazovke spustíš nahrávanie. Appku nechaj otvorenú, ideálne na nabíjačke, a mobil polož čo najbližšie k vyučujúcemu.
            </p>
            <button className="btn block big red" onClick={startRecord}>
              ● Pokračovať k nahrávaniu
            </button>
          </div>
        ) : null}

        {source === 'import' ? (
          <div className="card">
            <p className="small muted" style={{ marginTop: 0 }}>
              Podporované: m4a, mp3, wav, aac, mp4, webm. Z Hlasových poznámok: otvor nahrávku → ⋯ → Uložiť do Súborov, potom ju tu vyber.
              Súbory do 24 MB sa posielajú priamo, väčšie appka rozdelí na časti.
            </p>
            {busy ? (
              <div className="stack">
                <div className="row">
                  <span className="spin" /> {busy}
                </div>
                <Progress value={frac} max={1} />
              </div>
            ) : (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/*,video/mp4,.m4a,.mp3,.wav,.aac,.mp4,.webm,.ogg,.flac,.caf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    void onFile(f)
                  }}
                />
                <button className="btn block big" onClick={() => fileRef.current?.click()}>
                  📁 Vybrať zvukový súbor
                </button>
              </>
            )}
          </div>
        ) : null}

        {source === 'zivy' ? (
          <div className="card">
            <p className="small muted" style={{ marginTop: 0 }}>
              🧪 Experimentálne: text vzniká priamo počas prednášky cez rozpoznávanie reči v prehliadači (bez API kľúča). Zvuk sa neukladá a presnosť je nižšia ako pri bežnom nahrávaní.
            </p>
            <button className="btn block big" onClick={startLive}>
              🗣 Pokračovať k živému prepisu
            </button>
          </div>
        ) : null}

        {source === 'text' ? (
          <div className="card">
            <label className="field">
              <span>Text prepisu</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'Vlož prepis prednášky. Ak odseky začínajú časom, napr. [12:30], appka ho použije.'}
                style={{ minHeight: 240 }}
              />
              <small>
                {text.trim() ? `${text.trim().split(/\s+/).length} slov · ${fmtBytes(new Blob([text]).size)}` : 'Časy bez značiek appka odhadne podľa dĺžky textu.'}
              </small>
            </label>
            <button className="btn block" onClick={saveText} disabled={!text.trim()}>
              Uložiť prepis
            </button>
          </div>
        ) : null}
      </div>
    </>
  )
}
