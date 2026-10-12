import type { Lecture, StoredMaterial } from '../../db/types'

// Dočasné – implementuje sa vo fáze 5.
export function TestTab(_p: { lecture: Lecture; material?: StoredMaterial }) {
  void _p
  return <div className="empty">Testy sa pripravujú.</div>
}
