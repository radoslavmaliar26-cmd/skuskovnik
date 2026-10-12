import { describe, expect, it } from 'vitest'
import type { Question } from '../ai/schema'
import { DEMO_MATERIAL } from '../demo/demoMaterial'
import { answerText, correctAnswerText, isAnswered, normAnswer, parseNumber, scoreQuestion, summarize } from './scoring'

const base = { vysvetlenie: '', zdroj: {}, skuskova: true, obtiaznost: 1 as const }

describe('skórovanie testov', () => {
  it('jedna správna', () => {
    const q: Question = { ...base, id: 'a', typ: 'jedna', otazka: '?', moznosti: ['x', 'y'], spravne: 1 }
    expect(scoreQuestion(q, 1)).toEqual({ score: 1, correct: true })
    expect(scoreQuestion(q, 0)).toEqual({ score: 0, correct: false })
    expect(scoreQuestion(q, undefined).correct).toBe(false)
  })

  it('viac správnych – presná zhoda aj čiastočné body', () => {
    const q: Question = { ...base, id: 'b', typ: 'viac', otazka: '?', moznosti: ['a', 'b', 'c', 'd'], spravne: [0, 2] }
    expect(scoreQuestion(q, [2, 0])).toEqual({ score: 1, correct: true })
    expect(scoreQuestion(q, [0])).toEqual({ score: 0.5, correct: false })
    expect(scoreQuestion(q, [0, 1])).toEqual({ score: 0, correct: false })
    expect(scoreQuestion(q, [0, 1, 2]).score).toBe(0.5)
  })

  it('pravda/nepravda', () => {
    const q: Question = { ...base, id: 'c', typ: 'pravdaNepravda', otazka: '?', spravne: false }
    expect(scoreQuestion(q, false).correct).toBe(true)
    expect(scoreQuestion(q, true).correct).toBe(false)
  })

  it('doplňovačka bez diakritiky a veľkosti písmen', () => {
    const q: Question = { ...base, id: 'd', typ: 'doplnenie', otazka: 'modul ___', spravne: ['pružnosti'] }
    expect(scoreQuestion(q, 'Pruznosti').correct).toBe(true)
    expect(scoreQuestion(q, '  PRUŽNOSTI. ').correct).toBe(true)
    expect(scoreQuestion(q, 'pevnosti').correct).toBe(false)
    const n: Question = { ...base, id: 'e', typ: 'doplnenie', otazka: '___', spravne: ['0,3'] }
    expect(scoreQuestion(n, '0.3').correct).toBe(true)
    expect(normAnswer('„Ťahová tuhosť“')).toBe('tahova tuhost')
  })

  it('výpočet s toleranciou a jednotkou v odpovedi', () => {
    const q: Question = { ...base, id: 'f', typ: 'vypocet', otazka: '?', spravne: 0.95, tolerancia: 0.02, jednotka: 'mm' }
    expect(scoreQuestion(q, '0,95 mm').correct).toBe(true)
    expect(scoreQuestion(q, '0.97').correct).toBe(true)
    expect(scoreQuestion(q, '0,98').correct).toBe(false)
    expect(scoreQuestion(q, 'neviem').correct).toBe(false)
    expect(parseNumber('31 400 N')).toBe(31400)
    expect(parseNumber('4,76·10^-4')).toBeCloseTo(4.76e-4)
    expect(parseNumber('−3,5')).toBe(-3.5)
  })

  it('otvorená – samohodnotenie a AI skóre', () => {
    const q = DEMO_MATERIAL.test.find((x) => x.typ === 'otvorena')!
    expect(scoreQuestion(q, 'text', { selfGrade: 'vedel' }).score).toBe(1)
    expect(scoreQuestion(q, 'text', { selfGrade: 'ciastocne' }).score).toBe(0.5)
    expect(scoreQuestion(q, 'text', { selfGrade: 'nevedel' }).score).toBe(0)
    expect(scoreQuestion(q, 'text', { aiScore: 0.5 })).toEqual({ score: 0.5, correct: false })
  })

  it('celý demo test – všetky správne odpovede dajú plný počet', () => {
    const results: Record<string, ReturnType<typeof scoreQuestion>> = {}
    for (const q of DEMO_MATERIAL.test) {
      const a =
        q.typ === 'jedna' || q.typ === 'viac' || q.typ === 'pravdaNepravda'
          ? q.spravne
          : q.typ === 'doplnenie'
            ? q.spravne[0]
            : q.typ === 'vypocet'
              ? String(q.spravne)
              : 'odpoveď'
      expect(isAnswered(q, a)).toBe(true)
      results[q.id] = scoreQuestion(q, a, { selfGrade: 'vedel' })
      expect(correctAnswerText(q).length).toBeGreaterThan(0)
      expect(answerText(q, a).length).toBeGreaterThan(0)
    }
    const s = summarize(DEMO_MATERIAL.test, results)
    expect(s.score).toBe(DEMO_MATERIAL.test.length)
    expect(s.examMax).toBe(DEMO_MATERIAL.test.filter((q) => q.skuskova).length)
  })
})
