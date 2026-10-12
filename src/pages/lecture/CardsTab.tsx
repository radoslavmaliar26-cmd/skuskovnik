import type { Lecture } from '../../db/types'

// Dočasné – implementuje sa vo fáze 7.
export function CardsTab(_p: { lecture: Lecture }) {
  void _p
  return <div className="empty">Kartičky sa pripravujú.</div>
}
