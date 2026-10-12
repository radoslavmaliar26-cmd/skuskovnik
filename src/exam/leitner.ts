import type { Card } from '../db/types'

/** Leitnerove priečinky: interval opakovania v dňoch pre priečinok 1–5. */
export const INTERVAL_DAYS = [0, 1, 2, 4, 8, 16]
const DAY = 24 * 60 * 60 * 1000

/** Nový stav kartičky po odpovedi „vedel / nevedel“. */
export function review(card: Card, knew: boolean, now = Date.now()): Card {
  if (!knew) return { ...card, box: 1, due: now, updatedAt: now }
  const box = Math.min(5, card.box + 1)
  return { ...card, box, due: now + INTERVAL_DAYS[box] * DAY, updatedAt: now }
}

export function isDue(card: Card, now = Date.now()): boolean {
  return card.due <= now
}

/** Poradie na opakovanie: najprv skúškové, potom nižšie priečinky, potom najstaršie. */
export function sortForReview(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => Number(b.skuskova) - Number(a.skuskova) || a.box - b.box || a.due - b.due)
}
