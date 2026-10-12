import { useMemo, useState } from 'react'
import { db } from '../db/db'
import type { Card } from '../db/types'
import { review, sortForReview } from '../exam/leitner'
import { Progress } from './Layout'
import { Md } from './Markdown'

/** Opakovanie kartičiek: ťuknutím sa otočí, potom „Vedel / Nevedel“. */
export function CardReview({ cards, onDone, showSource }: { cards: Card[]; onDone?: () => void; showSource?: boolean }) {
  const initial = useMemo(() => sortForReview(cards), [cards])
  const [queue, setQueue] = useState<Card[]>(initial)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)
  const [knew, setKnew] = useState(0)
  const total = initial.length
  const card = queue[0]

  if (!total) return null
  if (!card) {
    return (
      <div className="card center">
        <div style={{ fontSize: '2.4rem' }}>🎉</div>
        <b>Hotovo!</b>
        <p className="small muted">
          Vedel si {knew} z {done} odpovedí. Kartičky, ktoré si vedel, sa vrátia neskôr podľa Leitnerovho systému.
        </p>
        {onDone ? (
          <button className="btn" onClick={onDone}>
            Zavrieť
          </button>
        ) : null}
      </div>
    )
  }

  const answer = async (ok: boolean) => {
    const next = review(card, ok)
    await db.cards.put(next)
    setDone((d) => d + 1)
    if (ok) setKnew((k) => k + 1)
    setFlipped(false)
    // nevedel → kartička sa zopakuje na konci tohto kola
    setQueue((q) => (ok ? q.slice(1) : [...q.slice(1), next]))
  }

  return (
    <div>
      <div className="row small muted" style={{ marginBottom: 6 }}>
        <span className="grow">
          Zostáva {queue.length} · priečinok {card.box}/5
        </span>
        {card.skuskova ? <span className="badge skuska">🔴 skúškové</span> : null}
      </div>
      <Progress value={total - new Set(queue.map((c) => c.id)).size} max={total} />
      <div className="card flashcard" style={{ marginTop: 12 }} onClick={() => setFlipped(true)}>
        <div>
          <Md text={card.otazka} />
        </div>
        {flipped ? (
          <div className="answer">
            <Md text={card.odpoved} />
          </div>
        ) : (
          <div className="small muted" style={{ marginTop: 16 }}>
            Ťukni pre odpoveď
          </div>
        )}
      </div>
      {flipped ? (
        <div className="btn-row">
          <button className="btn danger" onClick={() => void answer(false)}>
            ❌ Nevedel
          </button>
          <button className="btn" style={{ background: 'var(--green)' }} onClick={() => void answer(true)}>
            ✅ Vedel
          </button>
        </div>
      ) : (
        <button className="btn block secondary" onClick={() => setFlipped(true)}>
          Ukázať odpoveď
        </button>
      )}
      {showSource ? (
        <p className="small center" style={{ marginTop: 10 }}>
          <a href={`#/p/${card.lectureId}/material${card.sekciaId ? `?s=${encodeURIComponent(card.sekciaId)}` : ''}`}>Ukázať v materiáli</a>
        </p>
      ) : null}
    </div>
  )
}
