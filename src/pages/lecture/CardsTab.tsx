import { useState } from 'react'
import { db } from '../../db/db'
import type { Card, Lecture } from '../../db/types'
import { isDue } from '../../exam/leitner'
import { plural } from '../../lib/text'
import { CardReview } from '../../ui/CardReview'
import { useLive } from '../../ui/hooks'
import { Md } from '../../ui/Markdown'

export function CardsTab({ lecture }: { lecture: Lecture }) {
  const cards = useLive(() => db.cards.where('lectureId').equals(lecture.id).toArray(), [lecture.id])
  const [session, setSession] = useState<Card[] | null>(null)

  if (!cards) return null
  if (!cards.length) return <div className="empty">Kartičky vzniknú spolu s materiálom.</div>
  const due = cards.filter((c) => isDue(c))

  if (session) return <CardReview cards={session} onDone={() => setSession(null)} />

  return (
    <div>
      <div className="card">
        <b>
          {cards.length} {plural(cards.length, 'kartička', 'kartičky', 'kartičiek')}
        </b>{' '}
        <span className="muted small">· na opakovanie teraz: {due.length}</span>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" disabled={!due.length} onClick={() => setSession(due)}>
            🔁 Opakovať ({due.length})
          </button>
          <button className="btn secondary" onClick={() => setSession(cards)}>
            Všetky ({cards.length})
          </button>
          <button className="btn secondary" disabled={!cards.some((c) => c.skuskova)} onClick={() => setSession(cards.filter((c) => c.skuskova))}>
            Len skúškové
          </button>
        </div>
      </div>
      <div className="list">
        {cards.map((c) => (
          <details key={c.id} className="list-item" style={{ display: 'block' }}>
            <summary>
              {c.skuskova ? '🔴 ' : ''}
              <Md text={c.otazka} inline />
            </summary>
            <div className="small" style={{ marginTop: 6 }}>
              <Md text={c.odpoved} />
              <span className="muted">Priečinok {c.box}/5</span>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
