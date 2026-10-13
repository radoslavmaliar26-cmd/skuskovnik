import { useMemo, useState } from 'react'
import { cancelGeneration, generateMaterialApi, genState, saveMaterialFromApp } from '../../ai/jobs'
import { parseMaterialResponse } from '../../ai/parser'
import { buildMaterialPrompt, buildRepairPrompt, CLAUDE_APP_LIMIT, splitParagraphs } from '../../ai/prompts'
import type { Material } from '../../ai/schema'
import { db } from '../../db/db'
import { effectiveAiMode, type AiMode, type Lecture, type Mark, type Transcript } from '../../db/types'
import { copyText, local, readClipboard } from '../../lib/clipboard'
import { plural } from '../../lib/text'
import { useLive, useOnline, useSettings, useStore } from '../../ui/hooks'
import { Progress } from '../../ui/Layout'
import { toast, toastError } from '../../ui/toast'

interface Draft {
  split: boolean
  /** odpovede (časti správ) pre každú časť prednášky */
  parts: string[][]
}

const draftKey = (id: string) => `skuskovnik:odpoved:${id}`

export function GenerateCard({ lecture, transcript, marks, regenerate }: { lecture: Lecture; transcript?: Transcript; marks: Mark[]; regenerate?: boolean }) {
  const settings = useSettings()
  const online = useOnline()
  const gen = useStore(genState)[lecture.id]
  const subject = useLive(() => db.subjects.get(lecture.subjectId), [lecture.subjectId])
  const photoCount = useLive(() => db.photos.where('lectureId').equals(lecture.id).count(), [lecture.id]) ?? 0
  const [mode, setMode] = useState<AiMode | null>(null)
  const [draft, setDraftState] = useState<Draft>(() => local.get<Draft>(draftKey(lecture.id), { split: false, parts: [[]] }))
  const [chunk, setChunk] = useState(0)
  const [paste, setPaste] = useState('')
  const [errors, setErrors] = useState<{ chunk: number; list: string[]; truncated?: boolean } | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const paragraphs = useMemo(() => transcript?.paragraphs ?? [], [transcript])
  const fullPrompt = useMemo(
    () =>
      settings && subject !== undefined
        ? buildMaterialPrompt({
            title: lecture.title,
            subject: subject?.name ?? '',
            paragraphs,
            marks,
            totalSec: lecture.durationSec || undefined,
            allowSupplement: settings.allowSupplement,
            examShare: settings.examShare,
            mode: 'claudeApp',
          })
        : '',
    [settings, subject, lecture, paragraphs, marks],
  )
  const chunks = useMemo(() => (draft.split ? splitParagraphs(paragraphs, 2) : [paragraphs]), [draft.split, paragraphs])
  const chunkPrompt = (k: number) => {
    if (!draft.split || !settings) return fullPrompt
    const c = chunks[k]
    const from = c[0]?.t ?? 0
    const to = chunks[k + 1]?.[0]?.t ?? Infinity
    return buildMaterialPrompt({
      title: lecture.title,
      subject: subject?.name ?? '',
      paragraphs: c,
      marks: marks.filter((m) => m.t >= from && m.t < to),
      totalSec: lecture.durationSec || undefined,
      allowSupplement: settings.allowSupplement,
      examShare: settings.examShare,
      mode: 'claudeApp',
      part: { index: k + 1, count: chunks.length },
    })
  }

  if (!settings) return null
  if (!paragraphs.length) {
    return <div className="info-box">Materiál sa dá vytvoriť, keď bude hotový prepis.</div>
  }

  const activeMode = mode ?? effectiveAiMode(settings)
  const hasKey = !!settings.keys.anthropic.trim()
  const running = lecture.status === 'generating' || gen?.phase === 'running'

  const setDraft = (d: Draft) => {
    setDraftState(d)
    local.set(draftKey(lecture.id), d)
  }

  const copyPrompt = async (k: number) => {
    const ok = await copyText(chunkPrompt(k))
    if (ok) toast('Zadanie skopírované – vlož ho do Claude')
    else toastError('Kopírovanie zlyhalo. Skús to znova.')
  }

  const addPart = (text: string) => {
    if (!text.trim()) return
    const parts = draft.parts.map((p) => [...p])
    while (parts.length <= chunk) parts.push([])
    parts[chunk].push(text)
    setDraft({ ...draft, parts })
    setPaste('')
    setErrors(null)
  }

  const pasteFromClipboard = async () => {
    const t = await readClipboard()
    if (t === null) {
      toastError('Appka nemá prístup k schránke – vlož odpoveď do poľa nižšie (podrž prst → Vložiť).')
      return
    }
    if (!t.trim()) {
      toastError('Schránka je prázdna.')
      return
    }
    addPart(t)
    toast(`Vložených ${t.length.toLocaleString('sk-SK')} znakov`)
  }

  const removePart = (k: number, i: number) => {
    const parts = draft.parts.map((p) => [...p])
    parts[k].splice(i, 1)
    setDraft({ ...draft, parts })
  }

  const process = async () => {
    setBusy(true)
    setErrors(null)
    try {
      const results: Material[] = []
      const warn: string[] = []
      for (let k = 0; k < chunks.length; k++) {
        const r = parseMaterialResponse(draft.parts[k] ?? [])
        if (!r.ok) {
          setChunk(k)
          setErrors({ chunk: k, list: r.errors, truncated: r.truncated })
          return
        }
        results.push(r.data)
        warn.push(...r.warnings)
      }
      const res = await saveMaterialFromApp(lecture.id, results, lecture.title)
      local.remove(draftKey(lecture.id))
      setWarnings(warn)
      toast(`Materiál uložený · overené citáty ${res.ok}/${res.total}`)
    } catch (e) {
      toastError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const runApi = async () => {
    try {
      await generateMaterialApi(lecture.id)
      toast('Materiál je hotový')
    } catch (e) {
      toastError((e as Error).message)
    }
  }

  const promptLen = fullPrompt.length
  const tooLong = promptLen > CLAUDE_APP_LIMIT
  const allReady = chunks.every((_, k) => (draft.parts[k] ?? []).length > 0)

  return (
    <div className="card">
      <h3>{regenerate ? 'Vytvoriť materiál znova' : '✨ Vytvoriť učebný materiál'}</h3>
      <div className="seg">
        <button className={activeMode === 'claudeApp' ? 'on' : ''} onClick={() => setMode('claudeApp')}>
          Cez Claude appku
        </button>
        <button className={activeMode === 'api' ? 'on' : ''} onClick={() => setMode('api')}>
          Automaticky (API)
        </button>
      </div>
      <p className="small muted">
        {activeMode === 'claudeApp'
          ? 'Bez platenia za API: zadanie skopíruješ do Claude (claude.ai alebo appka), odpoveď vložíš späť.'
          : 'Claude cez Anthropic API vytvorí materiál sám. Platí sa podľa spotreby z tvojho API účtu.'}
      </p>

      {photoCount ? (
        <p className="small muted">
          📷 Fotky z prednášky ({photoCount}) sa Claudovi posielajú automaticky len v režime API.
        </p>
      ) : null}
      {activeMode === 'api' ? (
        <>
          {!hasKey ? (
            <div className="warn-box small">
              Chýba Anthropic API kľúč. <a href="#/nastavenia">Zadaj ho v Nastaveniach</a> alebo použi režim „Cez Claude appku“.
            </div>
          ) : null}
          {!online ? <div className="warn-box small">Si offline – generovanie potrebuje internet.</div> : null}
          {running ? (
            <div className="stack">
              <div className="row">
                <span className="spin" />
                <span className="grow">
                  {gen?.message || 'Vytváram materiál…'}
                  {gen && gen.parts > 1 ? ` (časť ${gen.part}/${gen.parts})` : ''}
                </span>
              </div>
              <Progress value={Math.min(gen?.chars ?? 0, 60_000)} max={60_000} />
              <div className="small muted">
                Prijaté: {(gen?.chars ?? 0).toLocaleString('sk-SK')} znakov. Nechaj appku otvorenú – trvá to zvyčajne 1–4 minúty.
              </div>
              <button className="btn ghost small" onClick={() => cancelGeneration(lecture.id)}>
                Zrušiť
              </button>
            </div>
          ) : (
            <button className="btn block" disabled={!hasKey || !online} onClick={() => void runApi()}>
              ✨ Vytvoriť automaticky
            </button>
          )}
        </>
      ) : (
        <>
          {tooLong ? (
            <div className="warn-box small">
              Zadanie má {promptLen.toLocaleString('sk-SK')} znakov – to je na jednu správu v Claude veľa (odporúčané do{' '}
              {CLAUDE_APP_LIMIT.toLocaleString('sk-SK')}).
              <label className="check">
                <input type="checkbox" checked={draft.split} onChange={(e) => setDraft({ split: e.target.checked, parts: e.target.checked ? [[], []] : [[]] })} />
                Rozdeliť na 2 časti (2 samostatné správy, appka ich potom spojí)
              </label>
            </div>
          ) : null}
          {draft.split ? (
            <div className="tabs">
              {chunks.map((_, k) => (
                <button key={k} className={chunk === k ? 'on' : ''} onClick={() => setChunk(k)}>
                  Časť {k + 1}
                  {(draft.parts[k] ?? []).length ? ' ✓' : ''}
                </button>
              ))}
            </div>
          ) : null}

          <ol style={{ paddingLeft: '1.2em', margin: '8px 0' }}>
            <li style={{ marginBottom: 10 }}>
              <button className="btn block" onClick={() => void copyPrompt(chunk)}>
                📋 Kopírovať pre Claude{draft.split ? ` (časť ${chunk + 1})` : ''}
              </button>
              <div className="small muted">{(draft.split ? chunkPrompt(chunk).length : promptLen).toLocaleString('sk-SK')} znakov</div>
            </li>
            <li style={{ marginBottom: 10 }}>
              <a className="btn block secondary" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
                Otvoriť Claude ↗
              </a>
              <div className="small muted">Vlož zadanie (podrž prst → Vložiť), odošli, počkaj na odpoveď, skopíruj ju a vráť sa sem.</div>
            </li>
            <li>
              <button className="btn block ghost" onClick={() => void pasteFromClipboard()}>
                📥 Vložiť odpoveď zo schránky
              </button>
              <details style={{ marginTop: 6 }}>
                <summary className="small">alebo vlož ručne</summary>
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Sem vlož odpoveď od Claude…" />
                <button className="btn small" style={{ marginTop: 6 }} disabled={!paste.trim()} onClick={() => addPart(paste)}>
                  Pridať
                </button>
              </details>
            </li>
          </ol>

          {(draft.parts[chunk] ?? []).length ? (
            <div className="list">
              {(draft.parts[chunk] ?? []).map((p, i) => (
                <div key={i} className="list-item" style={{ minHeight: 44 }}>
                  <span className="grow small">
                    Časť odpovede {i + 1} – {p.length.toLocaleString('sk-SK')} znakov
                  </span>
                  <button className="btn small ghost" onClick={() => removePart(chunk, i)} aria-label="Odstrániť">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {(draft.parts[chunk] ?? []).length ? (
            <p className="small muted">
              Ak odpoveď v Claude pokračovala v ďalšej správe (po „pokračuj“), vlož aj tú – pridá sa ako ďalšia časť.
            </p>
          ) : null}

          {errors ? (
            <div className="err small">
              <b>Odpoveď{draft.split ? ` pre časť ${errors.chunk + 1}` : ''} sa nedá spracovať:</b>
              <ul style={{ margin: '4px 0', paddingLeft: '1.2em' }}>
                {errors.list.slice(0, 6).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              {!errors.truncated ? (
                <button
                  className="btn small"
                  onClick={async () => {
                    const ok = await copyText(buildRepairPrompt(errors.list, 'material'))
                    if (ok) toast('Opravná výzva skopírovaná – vlož ju do toho istého rozhovoru v Claude')
                    else toastError('Kopírovanie zlyhalo – skús to znova.')
                  }}
                >
                  📋 Kopírovať opravnú výzvu
                </button>
              ) : null}
            </div>
          ) : null}

          <button className="btn block" style={{ marginTop: 10 }} disabled={!allReady || busy} onClick={() => void process()}>
            {busy ? <span className="spin" /> : '✅'} Spracovať odpoveď
            {draft.split ? ` (${chunks.filter((_, k) => (draft.parts[k] ?? []).length).length}/${chunks.length} ${plural(chunks.length, 'časť', 'časti', 'častí')})` : ''}
          </button>
        </>
      )}
      {warnings.length ? (
        <details className="small" style={{ marginTop: 8 }}>
          <summary>Upozornenia ({warnings.length})</summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
