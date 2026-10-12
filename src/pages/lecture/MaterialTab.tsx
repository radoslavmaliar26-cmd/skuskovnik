import { useEffect, useState } from 'react'
import type { NaSkuske, Zvyraznenie } from '../../ai/schema'
import type { Lecture, Mark, StoredMaterial, Transcript } from '../../db/types'
import { parseTime } from '../../lib/text'
import { local } from '../../lib/clipboard'
import { Md, Tex } from '../../ui/Markdown'
import { GenerateCard } from './GenerateCard'
import { ExportBar } from './ExportBar'

/** Odkaz na čas v prepise. */
export function TimeLink({ lectureId, cas }: { lectureId: string; cas?: string }) {
  const t = parseTime(cas)
  if (t === null) return null
  return (
    <a className="time-link" href={`#/p/${lectureId}/prepis?t=${Math.floor(t)}`} title="Ukázať v prepise">
      {cas}
    </a>
  )
}

export function examBadge(n: NaSkuske) {
  if (!n.overene) return <span className="badge neoverene">⚪ NEOVERENÉ</span>
  if (n.typ === 'vyslovne') return <span className="badge skuska">🔴 NA SKÚŠKE</span>
  if (n.typ === 'oznacene') return <span className="badge oznacene">⭐ OZNAČIL SI</span>
  return <span className="badge dolezite">🟠 DÔLEŽITÉ</span>
}

const ZV: Record<Zvyraznenie['typ'], { cls: string; label: string }> = {
  skuska: { cls: 'skuska', label: '🔴 NA SKÚŠKE' },
  dolezite: { cls: 'dolezite', label: '🟠 DÔLEŽITÉ' },
  pozor: { cls: 'pozor', label: '🟠 POZOR' },
  definicia: { cls: 'definicia', label: '🔵 DEFINÍCIA' },
  vzorec: { cls: 'vzorec', label: '🔵 VZOREC' },
  priklad: { cls: 'priklad', label: '🔵 PRÍKLAD' },
}

function Callout({ z, lectureId }: { z: Zvyraznenie; lectureId: string }) {
  // neoverená „skúšková“ značka nikdy nie je červená
  const unverifiedExam = z.typ === 'skuska' && !z.overene
  const meta = unverifiedExam ? { cls: 'neoverene', label: '⚪ NEOVERENÉ (skúška?)' } : ZV[z.typ]
  return (
    <div className={`callout ${meta.cls}`}>
      <span className={`badge ${meta.cls}`}>{meta.label}</span> <Md text={z.text} inline />
      {z.citat ? (
        <div className="meta">
          <span className="quote">„{z.citat}“</span> <TimeLink lectureId={lectureId} cas={z.cas} />
          {z.citat && !z.overene ? <span className="badge neoverene" style={{ marginLeft: 4 }}>citát sa v prepise nenašiel</span> : null}
        </div>
      ) : z.cas ? (
        <div className="meta">
          <TimeLink lectureId={lectureId} cas={z.cas} />
        </div>
      ) : null}
    </div>
  )
}

export function ExamList({ items, lectureId }: { items: NaSkuske[]; lectureId: string }) {
  if (!items.length) return <p className="small muted">Vyučujúci výslovne nespomenul nič, čo bude na skúške.</p>
  // overené výslovné najprv
  const order = (n: NaSkuske) => (n.overene ? 0 : 3) + (n.typ === 'vyslovne' ? 0 : n.typ === 'oznacene' ? 1 : 2)
  return (
    <div>
      {[...items]
        .sort((a, b) => order(a) - order(b))
        .map((n) => (
          <div key={n.id} className={`callout ${n.overene && n.typ === 'vyslovne' ? 'skuska' : n.overene ? 'dolezite' : 'neoverene'}`}>
            <div className="row wrap">
              {examBadge(n)}
              <b>
                <Md text={n.tema} inline />
              </b>
            </div>
            <Md text={n.vysvetlenie} />
            <div className="meta">
              <span className="quote">„{n.citat}“</span> <TimeLink lectureId={lectureId} cas={n.cas} />
            </div>
          </div>
        ))}
    </div>
  )
}

export function MaterialTab({
  lecture,
  material,
  transcript,
  marks,
  focusSection,
}: {
  lecture: Lecture
  material?: StoredMaterial
  transcript?: Transcript
  marks: Mark[]
  focusSection?: string
}) {
  const [onlyExam, setOnlyExamState] = useState(() => local.get('skuskovnik:lenSkuskove', false))
  const [regen, setRegen] = useState(false)
  const setOnlyExam = (v: boolean) => {
    setOnlyExamState(v)
    local.set('skuskovnik:lenSkuskove', v)
  }

  useEffect(() => {
    if (!focusSection || !material) return
    const el = document.getElementById(`sec-${focusSection}`)
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }, [focusSection, material])

  if (!material) {
    return <GenerateCard lecture={lecture} transcript={transcript} marks={marks} />
  }
  const m = material.data
  const sections = onlyExam ? m.sekcie.filter((s) => s.zvyraznenia.some((z) => z.typ === 'skuska')) : m.sekcie

  return (
    <div>
      <div className="card">
        <h2 style={{ marginBottom: 6 }}>
          <Md text={m.nazov} inline />
        </h2>
        <Md text={m.zhrnutie} />
        <label className="check no-print">
          <input type="checkbox" checked={onlyExam} onChange={(e) => setOnlyExam(e.target.checked)} />
          <span>
            <b>Len skúškové</b> – zobraziť iba to, čo bude na skúške
          </span>
        </label>
      </div>

      <div className="card" style={{ borderTop: '4px solid var(--red)' }}>
        <h3>🔴 Bude na skúške</h3>
        <ExamList items={m.naSkuske} lectureId={lecture.id} />
      </div>

      {m.organizacne.length ? (
        <div className="card" style={{ borderTop: '4px solid var(--purple)' }}>
          <h3>📅 Organizačné</h3>
          {m.organizacne.map((o, i) => (
            <div key={i} className="callout organizacne">
              <div className="row wrap">
                {o.datum ? <span className="badge organizacne">📅 {o.datum}</span> : null}
                <span>
                  <Md text={o.text} inline />
                </span>
              </div>
              <div className="meta">
                <span className="quote">„{o.citat}“</span> <TimeLink lectureId={lecture.id} cas={o.cas} />
                {!o.overene ? <span className="badge neoverene" style={{ marginLeft: 4 }}>⚪ neoverené</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {sections.map((s) => (
        <div key={s.id} className="card" id={`sec-${s.id}`} style={focusSection === s.id ? { outline: '2px solid var(--accent)' } : undefined}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <h3 className="grow">
              <Md text={s.nadpis} inline />
            </h3>
            <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
              <TimeLink lectureId={lecture.id} cas={s.casOd} />
            </span>
          </div>
          {onlyExam ? null : <Md text={s.obsah} />}
          {(onlyExam ? s.zvyraznenia.filter((z) => z.typ === 'skuska') : s.zvyraznenia).map((z, i) => (
            <Callout key={i} z={z} lectureId={lecture.id} />
          ))}
        </div>
      ))}

      {!onlyExam && m.vzorce.length ? (
        <div className="card">
          <h3>🔵 Vzorce</h3>
          {m.vzorce.map((v, i) => (
            <div key={i} className="callout vzorec">
              <div className="row">
                <b className="grow">
                  <Md text={v.popis} inline />
                </b>
                <TimeLink lectureId={lecture.id} cas={v.cas} />
              </div>
              <Tex latex={v.latex} />
              <div className="small">
                <Md text={v.veliciny} inline />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!onlyExam && m.pojmy.length ? (
        <div className="card">
          <h3>🔵 Pojmy</h3>
          {m.pojmy.map((p, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <b>
                <Md text={p.pojem} inline />
              </b>{' '}
              <TimeLink lectureId={lecture.id} cas={p.cas} />
              <div>
                <Md text={p.definicia} inline />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!onlyExam && m.naOverenie.length ? (
        <div className="card">
          <h3>⚪ Na overenie</h3>
          <p className="small muted">Miesta, kde automatický prepis nedával zmysel – over si ich v poznámkach alebo u vyučujúceho.</p>
          {m.naOverenie.map((n, i) => (
            <div key={i} className="callout neoverene">
              <Md text={n.text} inline /> <TimeLink lectureId={lecture.id} cas={n.cas} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="card flat small no-print">
        <b>Značky:</b> <span className="badge skuska">🔴 NA SKÚŠKE</span> vyučujúci výslovne povedal ·{' '}
        <span className="badge dolezite">🟠 DÔLEŽITÉ</span> zdôraznil · <span className="badge oznacene">⭐ OZNAČIL SI</span> tvoja značka ·{' '}
        <span className="badge definicia">🔵 DEFINÍCIA / VZOREC</span> · <span className="badge organizacne">📅 ORGANIZAČNÉ</span> ·{' '}
        <span className="badge neoverene">⚪ NEOVERENÉ</span> citát sa v prepise nenašiel
      </div>

      <ExportBar lecture={lecture} material={material} />

      <div className="no-print">
        {regen ? (
          <GenerateCard lecture={lecture} transcript={transcript} marks={marks} regenerate />
        ) : (
          <button className="btn block ghost" onClick={() => setRegen(true)}>
            ↻ Vytvoriť materiál znova
          </button>
        )}
      </div>
    </div>
  )
}
