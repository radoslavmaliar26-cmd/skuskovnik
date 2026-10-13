import { normalize, splitSentences } from '../lib/text'
import type { Paragraph } from '../db/types'

/**
 * Lokálna detekcia viet typu „toto bude na skúške“ (bez AI).
 * Porovnáva sa text bez diakritiky a malými písmenami; podporuje slovenčinu aj češtinu.
 */

export type CueType = 'skuska' | 'dolezite' | 'organizacne'

export interface Cue {
  typ: CueType
  /** Presná veta z prepisu */
  citat: string
  /** Odhadnutý čas vety v prednáške (s) */
  t: number
  /** Index odseku v prepise */
  paragraph: number
  /** Pozícia vety v odseku (znaky) */
  start: number
  end: number
}

// Tvary podstatných mien „skúška, písomka, test, zápočet, previerka“ (sk + cs) po predložke „na“
const EXAM_AFTER_NA =
  '(skuske|skusku|skuskach|skusky|pisomke|pisomku|pisomkach|pisomky|teste|test|testoch|testu|testy|zapocte|zapocet|zapoctoch|zapoctu|previerke|previerku|kolokviu|kolokvium|zkousce|zkousku|zkouskach|zkousky|pisemce|pisemku|pisemkach|pisemky|zapoctu|zapoctovem|zapoctove|zapoctovke)'
const NA_EXAM = new RegExp(`\\bna\\s+(tej\\s+|tom\\s+|te\\s+|tu\\s+|buducej\\s+|pristi\\s+|zaverecnej\\s+|zaverecne\\s+|pisomnej\\s+|ustnej\\s+|skuskovej\\s+)?${EXAM_AFTER_NA}\\b`)
const EXAM_NOUN = /\b(skusk\w*|pisomk\w*|zapoct\w*|previerk\w*|zkousk\w*|zkousc\w*|pisemk\w*|pisemc\w*|kolokvi\w*)\b/

const EXAM_TRIGGER =
  /\b(bude|budu|pride|pridu|prijde|prijdou|objavi|objevi|dostanete|dostanes|pytat|ptat|pytam|ptam|chcem|chci|budete|urcite|zarucene|naucte|naucit|nauct|vediet|vedet|ocakavam|ocekavam|zaujima|zajima|objavovat|chciet|chtit|davam|davat|dam)\b/
const EXAM_NEGATION = /\b(nebude|nebudu|neprijde|nepride|nepridu|nebudem|nebudu sa|nebudou)\b/

const EXAM_PHRASES: RegExp[] = [
  /\b(toto|to|na to|na toto|na tohle|tohle) (sa )?(vas )?budem (sa )?(vas )?pytat\b/,
  /\bbudem sa (vas )?(na )?(to|toto|tom|tohto)? ?pytat\b/,
  /\bbudem se (vas )?(na )?(to|tohle|toto)? ?ptat\b/,
  /\b(to|toto|tohle) se (vas )?budu ptat\b/,
  /\bskuskov(a|e|u|ych|ou) otazk/,
  /\bzkouskov(a|e|ou|ych) otazk/,
  /\b(to|toto) chcem,? (aby|by) ste (to )?(vedeli|ovladali|vedeli naspamat)\b/,
  /\bchcem,? aby ste (to|toto) (vedeli|ovladali)\b/,
  /\b(to|tohle|toto) chci,? (abyste|aby jste) (to )?(vedeli|umeli|znali)\b/,
  /\bchci,? (abyste|aby jste) (to|tohle) (vedeli|umeli|znali)\b/,
  /\btypick(a|y) (skuskov(y|a)|pisomkov(y|a)|zkouskov(y|a)) (priklad|otazka|uloha)/,
]

const IMPORTANT: RegExp[] = [
  /\bzapiste si\b/,
  /\bzapisujte si\b/,
  /\bpoznacte si\b/,
  /\bpoznamenajte si\b/,
  /\bzapamatajte si\b/,
  /\bzapamatujte si\b/,
  /\bpamatajte\b/,
  /\bpodciarknite\b/,
  /\bpodtrhnete\b/,
  /\bpodtrhnite\b/,
  /\b(je|to je|toto je|tohle je|je to|to su|toto su|su)( to)? (velmi |naozaj |strasne |mimoriadne |fakt |hrozne )?(dolezit\w*|podstatn\w*|klucov\w*|zasadn\w*|dulezit\w*|zakladn\w*)\b/,
  /\b(velmi |hrozne |strasne )?(dolezite|podstatne|klucove|dulezite) je\b/,
  /\bmusite (to )?(vediet|vedet|znat|ovladat|umet|umiet|pochopit)\b/,
  /\bto musite\b/,
  /\bpozor\b/,
  /\bcast(a|e|ou) chyb/,
  /\bcasto (sa|se) (robi|dela|myli|pletie|plete)\b/,
  /\bnezabudnite\b/,
  /\bnezapomente\b/,
  /\bsi (dobre )?zapamatajte\b/,
]

const ORGANIZATIONAL: RegExp[] = [
  /\b\d{1,2}\.\s?\d{1,2}\.(\s?\d{2,4})?/, // dátum 12. 11. / 12.11.2026
  /\b\d{1,2}\.\s?(januara|februara|marca|aprila|maja|juna|jula|augusta|septembra|oktobra|novembra|decembra|ledna|unora|brezna|dubna|kvetna|cervna|cervence|srpna|zari|rijna|listopadu|prosince)\b/,
  /\b(buduci|pristi|budouci|na buduci|na pristi) (tyzden|tyden|tyzdni|tydnu|pondelok|utorok|stredu|stvrtok|piatok|pondeli|utery|ctvrtek|patek|semester|mesiac|mesic|hodine|prednaske|cviceni|cviceniach)\b/,
  /\b(v|vo|ve) (pondelok|utorok|stredu|stvrtok|piatok|pondeli|utery|ctvrtek|patek)\b/,
  /\bodovzda(t|jte|vate|nie)\b/,
  /\bodevzd(at|ejte|avate|ani)\b/,
  /\btermin\w*\b/,
  /\bdeadline\b/,
  /\bpodmienk\w* (na |pre |k |udelenia )?(zapoct|absolv|skusk|ucast)/,
  /\bpodmink\w* (na |pro |k |udeleni )?(zapoct|absolv|zkousk|ucast)/,
  /\bkonzultaci\w*\b/,
  /\b(prineste|doneste|prineste si|vezmite si|prineste so sebou|doneste si|prineste si so sebou|prineste kalkulack\w*|vezmete si|prineste)\b/,
  /\b(kalkulack\w*|kalkulacka|kalkulacku)\b/,
  /\bdochadzk\w*\b/,
  /\bdochazk\w*\b/,
  /\bpovinn(a|e|y) (ucast|dochadzka|dochazka)\b/,
  /\bopravn(y|a|e) termin\w*\b/,
]

// Angličtina (predmety s jazykom „en“)
const EN_EXAM_NOUN = '(exam|exams|test|tests|quiz|midterm|final|finals)'
const EN_EXAM: RegExp[] = [
  new RegExp(
    `\\b(will|is going to|are going to|is gonna|might|may|could|should)\\s+(definitely |certainly |probably |surely |also )?(be|come up|appear|show up)\\s+(on|in)\\s+(the |your |our |this |next |every )?(final |midterm |written |oral )?${EN_EXAM_NOUN}\\b`,
  ),
  new RegExp(`\\b(this|that|it|these|those)\\s+(is|are|'s)\\s+(definitely |certainly |always )?(on|in)\\s+(the |your |every )?(final |midterm |written |oral )?${EN_EXAM_NOUN}\\b`),
  /\b(i will|i'll|i am going to|i'm going to|i'm gonna|i will definitely|i always)\s+(definitely\s+)?(ask|test|examine)\s+(you\s+)?(about\s+|on\s+)?(this|that|it|these)\b/,
  /\b(typical|classic|standard)\s+(exam|test)\s+(question|problem)\b/,
  /\bexam question\b/,
  new RegExp(`\\byou('ll| will)?\\s+(need|have) to know (this|that|these|it) for the ${EN_EXAM_NOUN}\\b`),
]
const EN_EXAM_NEGATION = new RegExp(`\\b(will not|won't|isn't going to|is not going to|wont)\\s+be\\s+(on|in)\\s+(the\\s+)?${EN_EXAM_NOUN}\\b|\\bnot (on|in) the ${EN_EXAM_NOUN}\\b`)
const EN_IMPORTANT: RegExp[] = [
  /\bwrite (this|that|it|these) down\b/,
  /\b(this|that|it) is (very |really |extremely |super |absolutely )?(important|crucial|essential|key|critical)\b/,
  /\b(very|really|extremely) important\b/,
  /\bremember (this|that|these)\b/,
  /\bbe careful\b/,
  /\bcommon (mistake|error)\b/,
  /\bdon'?t forget\b/,
  /\byou (must|need to|have to|should) (know|remember|understand|memorize)\b/,
  /\bpay attention\b/,
  /\bunderline (this|that)\b/,
]
const EN_MONTHS = '(january|february|march|april|may|june|july|august|september|october|november|december)'
const EN_ORGANIZATIONAL: RegExp[] = [
  new RegExp(`\\b${EN_MONTHS}\\s+(\\d{1,2}(st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty|thirtieth|thirty)\\b`),
  new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+of\\s+${EN_MONTHS}\\b`),
  /\bnext (week|monday|tuesday|wednesday|thursday|friday|lecture|class|semester|seminar)\b/,
  /\b(deadline|due (on|by|date|next)|hand (it |them )?in|submit (it|them|your|the))\b/,
  /\bbring (a |your )?(calculator|laptop|notes)\b/,
  /\boffice hours\b/,
  /\b(attendance|requirements? (for|to pass))\b/,
  /\bno (lecture|class) (next|on|this)\b/,
]

export function classifySentence(sentence: string): CueType | null {
  const n = normalize(sentence)
  const negated = EXAM_NEGATION.test(n)
  const enNegated = EN_EXAM_NEGATION.test(n)
  if (EXAM_PHRASES.some((r) => r.test(n))) return 'skuska'
  if (NA_EXAM.test(n) && EXAM_TRIGGER.test(n) && !negated) return 'skuska'
  if (!enNegated && EN_EXAM.some((r) => r.test(n))) return 'skuska'
  if (ORGANIZATIONAL.some((r) => r.test(n)) || EN_ORGANIZATIONAL.some((r) => r.test(n))) return 'organizacne'
  // „toto na skúške nebude“ – užitočná organizačná info
  if ((negated && EXAM_NOUN.test(n)) || enNegated) return 'organizacne'
  if (IMPORTANT.some((r) => r.test(n)) || EN_IMPORTANT.some((r) => r.test(n))) return 'dolezite'
  return null
}

/** Nájde všetky vety so skúškovými/dôležitými/organizačnými frázami v prepise. */
export function findCues(paragraphs: Paragraph[], totalSec?: number): Cue[] {
  const out: Cue[] = []
  paragraphs.forEach((p, pi) => {
    const nextT = paragraphs[pi + 1]?.t ?? (totalSec && totalSec > p.t ? totalSec : p.t + p.text.length / 15)
    const span = Math.max(0, nextT - p.t)
    for (const s of splitSentences(p.text)) {
      const typ = classifySentence(s.text)
      if (!typ) continue
      const rel = p.text.length ? s.start / p.text.length : 0
      out.push({ typ, citat: s.text, t: Math.round(p.t + rel * span), paragraph: pi, start: s.start, end: s.start + s.text.length })
    }
  })
  return out
}

export const CUE_LABELS: Record<CueType, string> = {
  skuska: 'Na skúške',
  dolezite: 'Dôležité',
  organizacne: 'Organizačné',
}
