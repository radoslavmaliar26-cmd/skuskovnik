import { useState } from 'react'
import { db } from '../../db/db'
import type { Lecture } from '../../db/types'
import { useLive } from '../../ui/hooks'
import { toast } from '../../ui/toast'

export function LectureActions({ lecture, onDelete }: { lecture: Lecture; onDelete: () => void }) {
  const [title, setTitle] = useState(lecture.title)
  const subjects = useLive(() => db.subjects.orderBy('createdAt').toArray(), [])

  const save = async () => {
    await db.lectures.update(lecture.id, { title: title.trim() || lecture.title, updatedAt: Date.now() })
    toast('Uložené')
  }

  const move = async (subjectId: string) => {
    await db.transaction('rw', [db.lectures, db.tests, db.cards, db.attempts], async () => {
      await db.lectures.update(lecture.id, { subjectId })
      await db.tests.where('lectureId').equals(lecture.id).modify({ subjectId })
      await db.cards.where('lectureId').equals(lecture.id).modify({ subjectId })
      await db.attempts.where('lectureId').equals(lecture.id).modify({ subjectId })
    })
    toast('Prednáška presunutá')
  }

  return (
    <div className="card no-print">
      <label className="field">
        <span>Názov prednášky</span>
        <div className="row">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn small" onClick={() => void save()}>
            Uložiť
          </button>
        </div>
      </label>
      <label className="field">
        <span>Predmet</span>
        <select value={lecture.subjectId} onChange={(e) => void move(e.target.value)}>
          {(subjects ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button className="btn block danger" onClick={onDelete}>
        🗑 Zmazať prednášku
      </button>
    </div>
  )
}
