import { describe, expect, it } from 'vitest'
import { classifySentence, findCues } from './examCues'

describe('examCues – klasifikácia viet', () => {
  const skuska = [
    'Toto bude na skúške, takže si to dobre naučte.',
    'toto bude na skuske',
    'TOTO BUDE NA SKÚŠKE!',
    'Hookov zákon určite príde na písomke.',
    'Na zápočte dostanete presne takýto príklad.',
    'Toto sa vás budem pýtať.',
    'Na toto sa budem pýtať na ústnej.',
    'To je typická skúšková otázka.',
    'To chcem, aby ste vedeli naspamäť.',
    'Tohle bude na zkoušce.',
    'Na písemce to určitě bude.',
    'Tohle se vás budu ptát.',
    'Na previerke budú dve úlohy na výpočet napätia.',
    'Bude to aj na teste.',
  ]
  for (const s of skuska) it(`skúška: ${s}`, () => expect(classifySentence(s)).toBe('skuska'))

  const dolezite = [
    'Zapíšte si túto definíciu.',
    'Toto je veľmi dôležité.',
    'Zapamätajte si, že napätie je sila na plochu.',
    'Pozor, tu sa často robí chyba.',
    'Častá chyba je zabudnúť na jednotky.',
    'Toto musíte vedieť.',
    'Tohle je důležité.',
    'Podčiarknite si to.',
  ]
  for (const s of dolezite) it(`dôležité: ${s}`, () => expect(classifySentence(s)).toBe('dolezite'))

  const org = [
    'Písomka bude 12. 11. o desiatej.',
    'Budúci týždeň prednáška nebude.',
    'Protokoly treba odovzdať do piatku.',
    'Podmienky zápočtu sú dve písomky nad 50 percent.',
    'Prineste si kalkulačku.',
    'Toto na skúške nebude.',
    'Písomka bude v stredu.',
  ]
  for (const s of org) it(`organizačné: ${s}`, () => expect(classifySentence(s)).toBe('organizacne'))

  const nic = [
    'Napätie je sila pôsobiaca na jednotku plochy.',
    'Teraz si ukážeme príklad.',
    'Testovanie materiálov prebieha v laboratóriu.',
    'Dobre, ideme ďalej.',
  ]
  for (const s of nic) it(`nič: ${s}`, () => expect(classifySentence(s)).toBeNull())
})

describe('examCues – findCues', () => {
  it('vráti citát a odhadnutý čas', () => {
    const cues = findCues(
      [
        { t: 0, text: 'Úvod do pružnosti. Toto bude na skúške. Ďalej.' },
        { t: 120, text: 'Zapíšte si vzorec.' },
      ],
      200,
    )
    expect(cues).toHaveLength(2)
    expect(cues[0]).toMatchObject({ typ: 'skuska', citat: 'Toto bude na skúške.', paragraph: 0 })
    expect(cues[0].t).toBeGreaterThan(0)
    expect(cues[0].t).toBeLessThan(120)
    expect(cues[1]).toMatchObject({ typ: 'dolezite', t: 120 })
  })
})

describe('delenie na vety', () => {
  it('dátumy a desatinné čísla nerozdelia vetu', async () => {
    const { splitSentences } = await import('../lib/text')
    const s = splitSentences('Zapíšte si: prvá písomka bude 12. 11. 2026 o desiatej. Modul je 2.1 GPa! Protokoly do 18. 12. Na písomku si prineste kalkulačku.')
    expect(s.map((x) => x.text)).toEqual([
      'Zapíšte si: prvá písomka bude 12. 11. 2026 o desiatej.',
      'Modul je 2.1 GPa!',
      'Protokoly do 18. 12.',
      'Na písomku si prineste kalkulačku.',
    ])
  })
})

describe('examCues – angličtina', () => {
  const cases: [string, string | null][] = [
    ['This will be on the exam, so learn it well.', 'skuska'],
    ["Hooke's law is definitely going to be... no wait, it will definitely be on the final exam.", 'skuska'],
    ["I'm going to ask you about this.", 'skuska'],
    ['This is a typical exam question.', 'skuska'],
    ["Write this down: the first written test will be on November twelfth at ten o'clock.", 'organizacne'],
    ['The deadline for the report is next Friday.', 'organizacne'],
    ['This will not be on the exam.', 'organizacne'],
    ['Be careful, a common mistake is mixing millimeters and meters.', 'dolezite'],
    ['This is really important.', 'dolezite'],
    ['Normal stress is force divided by area.', null],
    ['We will test the material in the lab.', null],
  ]
  for (const [s, typ] of cases) it(`${typ ?? 'nič'}: ${s}`, () => expect(classifySentence(s)).toBe(typ))
})
