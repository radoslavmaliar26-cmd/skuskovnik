import { describe, expect, it } from 'vitest'
import { buildIndex, findQuote } from './verify'

const paragraphs = [
  { t: 0, text: 'Dobrý deň, dnes začneme úvodom do pružnosti a pevnosti.' },
  { t: 60, text: 'Normálové napätie sigma je sila delená plochou, jednotkou je pascal. Toto bude na skúške.' },
  { t: 180, text: 'Hookov zákon hovorí, že napätie je úmerné pomernému predĺženiu.' },
]

describe('overenie citátov', () => {
  const idx = buildIndex(paragraphs, 240)

  it('nájde presný citát', () => {
    const m = findQuote(idx, 'Toto bude na skúške.')
    expect(m.found).toBe(true)
    expect(m.t).toBeGreaterThanOrEqual(60)
    expect(m.t).toBeLessThan(180)
  })

  it('ignoruje diakritiku a veľkosť písmen', () => {
    expect(findQuote(idx, 'NORMALOVE NAPATIE SIGMA JE SILA DELENA PLOCHOU').found).toBe(true)
  })

  it('toleruje drobné rozdiely (≥ 80 % slov)', () => {
    const m = findQuote(idx, 'Hookov zákon hovorí, že napätie je priamo úmerné pomernému predĺženiu')
    expect(m.found).toBe(true)
    expect(m.t).toBeGreaterThanOrEqual(180)
  })

  it('odmietne vymyslený citát', () => {
    expect(findQuote(idx, 'Modul pružnosti ocele je dvesto gigapascalov a toto bude na písomke').found).toBe(false)
  })

  it('krátky citát vyžaduje presnú zhodu', () => {
    expect(findQuote(idx, 'Hookov zákon').found).toBe(true)
    expect(findQuote(idx, 'Pascalov zákon').found).toBe(false)
  })

  it('prázdny prepis', () => {
    expect(findQuote(buildIndex([]), 'čokoľvek tu je').found).toBe(false)
  })
})
