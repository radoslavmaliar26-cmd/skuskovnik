import { describe, expect, it } from 'vitest'
import type { Card } from '../db/types'
import { isDue, review, sortForReview } from './leitner'

const card = (p: Partial<Card> = {}): Card => ({
  id: 'c', lectureId: 'l', subjectId: 's', otazka: 'q', odpoved: 'a', skuskova: false, box: 1, due: 0, updatedAt: 0, ...p,
})

describe('Leitnerove priečinky', () => {
  it('vedel → vyšší priečinok a dlhší interval', () => {
    const now = 1_000_000
    const c2 = review(card(), true, now)
    expect(c2.box).toBe(2)
    expect(c2.due).toBe(now + 2 * 86_400_000)
    const c5 = review(card({ box: 5 }), true, now)
    expect(c5.box).toBe(5)
    expect(c5.due).toBe(now + 16 * 86_400_000)
    expect(isDue(c2, now)).toBe(false)
  })

  it('nevedel → späť do 1. priečinka, hneď na zopakovanie', () => {
    const c = review(card({ box: 4, due: 5 }), false, 100)
    expect(c).toMatchObject({ box: 1, due: 100 })
    expect(isDue(c, 100)).toBe(true)
  })

  it('poradie: skúškové a nižšie priečinky najprv', () => {
    const list = sortForReview([card({ id: 'a', box: 1 }), card({ id: 'b', box: 3, skuskova: true }), card({ id: 'c', box: 1, skuskova: true })])
    expect(list.map((c) => c.id)).toEqual(['c', 'b', 'a'])
  })
})
