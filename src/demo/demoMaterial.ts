import type { Material } from '../ai/schema'

/** Hotový materiál k ukážkovej prednáške (ako by ho vytvoril Claude). */
export const DEMO_MATERIAL: Material = {
  nazov: 'Úvod do pružnosti: napätie, pretvorenie, Hookov zákon',
  zhrnutie:
    'Prednáška zaviedla základné pojmy pružnosti a pevnosti: vonkajšie a vnútorné sily a metódu rezu. ' +
    'Definovala normálové a šmykové napätie a pomerné pretvorenie. ' +
    'Ťažiskom bol Hookov zákon σ = E·ε a z neho odvodený vzťah pre predĺženie tyče, vrátane riešeného príkladu. ' +
    'Na záver sa preberal ťahový diagram s charakteristickými medzami, Poissonovo číslo a dovolené napätie so súčiniteľom bezpečnosti.',
  naSkuske: [
    {
      id: 'n1',
      tema: 'Definícia normálového napätia a jeho jednotky',
      vysvetlenie: 'σ = N/A; jednotka Pa = N/m², v praxi MPa = N/mm². Ťah kladné, tlak záporné napätie.',
      citat: 'Definícia napätia aj s jednotkami, toto bude na skúške, takže si to dobre naučte.',
      cas: '07:40',
      typ: 'vyslovne',
    },
    {
      id: 'n2',
      tema: 'Hookov zákon a výpočet predĺženia tyče',
      vysvetlenie: 'σ = E·ε, E – modul pružnosti (oceľ ≈ 210 GPa, hliník ≈ 70 GPa); predĺženie Δl = N·l/(E·A). Očakáva sa príklad na výpočet.',
      citat: 'Hookov zákon určite príde na písomke, aj s príkladom na výpočet predĺženia, takže si ho poriadne precvičte.',
      cas: '22:50',
      typ: 'vyslovne',
    },
    {
      id: 'n3',
      tema: 'Voľba súčiniteľa bezpečnosti (ústna skúška)',
      vysvetlenie: 'σ_dov = Re/k; k sa volí cca 1,5 – 3 podľa toho, ako presne poznáme zaťaženie. Vedieť aj prečo.',
      citat: 'Toto sa vás budem pýtať na ústnej, ako sa volí súčiniteľ bezpečnosti a prečo.',
      cas: '38:40',
      typ: 'vyslovne',
    },
    {
      id: 'n4',
      tema: 'Poradie medzí v ťahovom diagrame',
      vysvetlenie: 'Medza úmernosti → medza klzu Re → medza pevnosti Rm.',
      citat: 'Zapamätajte si poradie: medza úmernosti, medza klzu, medza pevnosti.',
      cas: '32:10',
      typ: 'zdoraznene',
    },
  ],
  organizacne: [
    {
      text: 'Prvá písomka: 12. 11. 2026 o 10:00 v posluchárni A.',
      datum: '12. 11. 2026',
      citat: 'Zapíšte si: prvá písomka bude 12. 11. 2026 o desiatej v posluchárni A.',
      cas: '00:15',
    },
    {
      text: 'Zápočet: dve písomky, z každej aspoň 50 %, a odovzdané protokoly zo cvičení.',
      citat: 'Podmienky zápočtu sú dve písomky, z každej treba aspoň päťdesiat percent, a odovzdané protokoly zo cvičení.',
      cas: '00:30',
    },
    {
      text: 'Protokoly odovzdať najneskôr do 18. 12.',
      datum: '18. 12. 2026',
      citat: 'Protokoly treba odovzdať do konca semestra, najneskôr do 18. 12.',
      cas: '00:45',
    },
    {
      text: 'Na písomku priniesť kalkulačku (mobil nie je povolený).',
      citat: 'Na písomku si prineste kalkulačku, mobil používať nebudete.',
      cas: '00:55',
    },
    {
      text: 'Budúci týždeň prednáška nebude (dekanské voľno); ďalšia téma: šmyk a krútenie.',
      citat: 'Budúci týždeň prednáška nebude, lebo je dekanské voľno, takže sa uvidíme o dva týždne a budeme preberať šmyk a krútenie.',
      cas: '40:40',
    },
  ],
  sekcie: [
    {
      id: 's1',
      nadpis: 'Vonkajšie a vnútorné sily, metóda rezu',
      casOd: '02:10',
      casDo: '05:30',
      obsah:
        '**Pružnosť a pevnosť** skúma, ako sa telesá deformujú a kedy sa porušia pôsobením vonkajších síl.\n\n' +
        '- **Vonkajšie sily** – zaťaženia pôsobiace zvonka (tiaž, vietor, sila od susednej súčiastky).\n' +
        '- **Vnútorné sily** – držia teleso pohromade; priamo ich nevidíme.\n\n' +
        '**Metóda rezu:** teleso myslene prerežeme rovinou, jednu časť odstránime a jej účinok nahradíme vnútornými silami v reze. Tie vypočítame z podmienok rovnováhy zvyšnej časti.\n\n' +
        'Pri priamom prúte nás zaujíma:\n\n' +
        '- **normálová sila $N$** – kolmo na rez,\n' +
        '- **posúvajúca sila $T$** – v rovine rezu.',
      zvyraznenia: [
        {
          typ: 'definicia',
          text: 'Metóda rezu – teleso myslene prerežeme a účinok odstránenej časti nahradíme vnútornými silami.',
          citat: 'Teleso v mysli prerežeme rovinou, jednu časť odstránime a jej účinok nahradíme vnútornými silami v reze.',
          cas: '03:20',
        },
      ],
    },
    {
      id: 's2',
      nadpis: 'Napätie – normálové a šmykové',
      casOd: '05:30',
      casDo: '12:20',
      obsah:
        'Samotná sila nehovorí, či materiál vydrží – rovnaká sila je pre hrubú tyč v poriadku, tenký drôt pretrhne. Preto zavádzame **napätie**.\n\n' +
        '**Normálové napätie** (kolmo na rez):\n\n$$\\sigma = \\frac{N}{A}$$\n\n' +
        'kde $N$ je normálová sila [N] a $A$ plocha prierezu [m²].\n\n' +
        '- Jednotka: **pascal** $1\\,\\text{Pa} = 1\\,\\text{N/m}^2$; v praxi **MPa**, pričom $1\\,\\text{MPa} = 1\\,\\text{N/mm}^2$.\n' +
        '- Ťah → $\\sigma > 0$, tlak → $\\sigma < 0$.\n\n' +
        '**Šmykové napätie** (v rovine rezu) vzniká od posúvajúcej sily; pri jednoduchom šmyku:\n\n$$\\tau = \\frac{T}{A}$$\n\n' +
        'Príklad: nit alebo čap spájajúci dva plechy – pri ťahaní plechov sa čap snaží prestrihnúť.\n\n' +
        '> **Doplnenie (mimo prednášky):** Napätie je v skutočnosti rozložené po priereze; $N/A$ je jeho priemerná hodnota, ktorá pri prostom ťahu zodpovedá skutočnosti.',
      zvyraznenia: [
        {
          typ: 'skuska',
          text: 'Definícia napätia aj s jednotkami bude na skúške.',
          citat: 'Definícia napätia aj s jednotkami, toto bude na skúške, takže si to dobre naučte.',
          cas: '07:40',
        },
        {
          typ: 'dolezite',
          text: 'Normálové napätie je kolmé na rez, šmykové leží v rovine rezu.',
          citat: 'Takže si zapamätajte rozdiel: normálové napätie je kolmé na rez, šmykové napätie leží v rovine rezu.',
          cas: '10:40',
        },
      ],
    },
    {
      id: 's3',
      nadpis: 'Riešený príklad: napätie v ťahanej tyči',
      casOd: '12:20',
      casDo: '16:00',
      obsah:
        '**Zadanie:** oceľová tyč kruhového prierezu, $d = 20\\,\\text{mm}$, ťahová sila $N = 31{,}4\\,\\text{kN}$.\n\n' +
        '1. Plocha prierezu: $A = \\dfrac{\\pi d^2}{4} = \\dfrac{\\pi \\cdot 400}{4} \\approx 314\\,\\text{mm}^2$\n' +
        '2. Napätie: $\\sigma = \\dfrac{31\\,400\\,\\text{N}}{314\\,\\text{mm}^2} = 100\\,\\text{MPa}$\n\n' +
        '**Tip vyučujúceho:** sila v N a plocha v mm² dajú napätie priamo v MPa.',
      zvyraznenia: [
        {
          typ: 'priklad',
          text: 'd = 20 mm, N = 31,4 kN → A ≈ 314 mm², σ = 100 MPa.',
          citat: 'Napätie je potom tridsaťjedentisícštyristo newtonov lomeno tristoštrnásť milimetrov štvorcových, a to je sto megapascalov.',
          cas: '14:30',
        },
      ],
    },
    {
      id: 's4',
      nadpis: 'Pomerné pretvorenie',
      casOd: '16:00',
      casDo: '19:30',
      obsah:
        'Tyč s pôvodnou dĺžkou $l_0$ sa natiahne o $\\Delta l$. **Pomerné pretvorenie:**\n\n$$\\varepsilon = \\frac{\\Delta l}{l_0}$$\n\n' +
        '- bezrozmerná veličina, často v % alebo ‰.\n' +
        '- $\\Delta l$ aj $l_0$ musia byť v **rovnakých jednotkách**!',
      zvyraznenia: [
        {
          typ: 'pozor',
          text: 'Častá chyba: Δl v mm a l₀ v m – výsledok vyjde 1000× väčší.',
          citat: 'Pozor, tu sa často robí chyba: delta l a l nula musia byť v rovnakých jednotkách.',
          cas: '17:00',
        },
      ],
    },
    {
      id: 's5',
      nadpis: 'Hookov zákon a predĺženie tyče',
      casOd: '19:30',
      casDo: '28:00',
      obsah:
        'Pri dostatočne malom napätí je napätie **priamo úmerné** pomernému pretvoreniu:\n\n$$\\sigma = E\\,\\varepsilon$$\n\n' +
        '- $E$ – **modul pružnosti v ťahu (Youngov modul)**, jednotka ako napätie.\n' +
        '- Oceľ: $E \\approx 210\\,\\text{GPa}$, hliník: $E \\approx 70\\,\\text{GPa}$.\n\n' +
        'Spojením $\\sigma = N/A$, $\\varepsilon = \\Delta l / l$ a Hookovho zákona dostaneme **predĺženie tyče**:\n\n$$\\Delta l = \\frac{N\\,l}{E\\,A}$$\n\n' +
        'Súčin $E A$ je **ťahová tuhosť** prúta.\n\n' +
        '**Pokračovanie príkladu:** $l = 2\\,\\text{m}$, $\\sigma = 100\\,\\text{MPa}$:\n\n' +
        '$\\varepsilon = \\dfrac{100}{210\\,000} \\approx 4{,}76 \\cdot 10^{-4}$, $\\Delta l = \\varepsilon \\cdot 2000\\,\\text{mm} \\approx 0{,}95\\,\\text{mm}$.',
      zvyraznenia: [
        {
          typ: 'skuska',
          text: 'Hookov zákon určite príde na písomke – aj s príkladom na predĺženie.',
          citat: 'Hookov zákon určite príde na písomke, aj s príkladom na výpočet predĺženia, takže si ho poriadne precvičte.',
          cas: '22:50',
        },
        {
          typ: 'vzorec',
          text: 'σ = E·ε a Δl = N·l / (E·A)',
          citat: 'Delta l sa rovná N krát l lomeno E krát A.',
          cas: '24:00',
        },
        {
          typ: 'priklad',
          text: 'Oceľová tyč 2 m, σ = 100 MPa → ε ≈ 4,76·10⁻⁴, Δl ≈ 0,95 mm.',
          citat: 'Predĺženie je potom epsilon krát dvetisíc milimetrov, čo je asi nula celá deväťdesiatpäť milimetra.',
          cas: '26:50',
        },
      ],
    },
    {
      id: 's6',
      nadpis: 'Ťahový diagram',
      casOd: '28:00',
      casDo: '32:30',
      obsah:
        'Ťahový diagram (z ťahovej skúšky): vodorovne $\\varepsilon$, zvislo $\\sigma$.\n\n' +
        '1. **Medza úmernosti** – koniec priamkovej časti, kde platí Hookov zákon.\n' +
        '2. **Medza klzu $R_e$** – materiál sa začne trvalo deformovať, napätie takmer nerastie.\n' +
        '3. **Medza pevnosti $R_m$** – maximálne napätie; potom sa vzorka zaškrtí a pretrhne.',
      zvyraznenia: [
        {
          typ: 'dolezite',
          text: 'Poradie: medza úmernosti → medza klzu → medza pevnosti.',
          citat: 'Zapamätajte si poradie: medza úmernosti, medza klzu, medza pevnosti.',
          cas: '32:10',
        },
      ],
    },
    {
      id: 's7',
      nadpis: 'Poissonovo číslo',
      casOd: '32:30',
      casDo: '35:30',
      obsah:
        'Pri ťahu sa tyč predlžuje a zároveň **zužuje**. Pomer pretvorení popisuje **Poissonovo číslo**:\n\n$$\\nu = -\\frac{\\varepsilon_{\\text{priečne}}}{\\varepsilon_{\\text{pozdĺžne}}}$$\n\n' +
        '- Mínus zabezpečí kladné $\\nu$ (pri ťahu je priečne pretvorenie záporné).\n' +
        '- Oceľ $\\nu \\approx 0{,}3$, guma $\\nu \\to 0{,}5$.',
      zvyraznenia: [
        {
          typ: 'definicia',
          text: 'Poissonovo číslo ν = −ε_priečne / ε_pozdĺžne.',
          citat: 'Platí, že ný sa rovná mínus epsilon priečne lomeno epsilon pozdĺžne.',
          cas: '33:30',
        },
      ],
    },
    {
      id: 's8',
      nadpis: 'Dovolené napätie a súčiniteľ bezpečnosti',
      casOd: '35:30',
      casDo: '39:00',
      obsah:
        'Napätie nesmie dosiahnuť medzu klzu. **Dovolené napätie:**\n\n$$\\sigma_{\\text{dov}} = \\frac{R_e}{k}$$\n\n' +
        '**Pevnostná podmienka:** $\\sigma \\le \\sigma_{\\text{dov}}$.\n\n' +
        'Súčiniteľ bezpečnosti $k$ sa bežne volí **1,5 až 3** – podľa toho, ako presne poznáme zaťaženie.',
      zvyraznenia: [
        {
          typ: 'skuska',
          text: 'Ústna otázka: ako sa volí súčiniteľ bezpečnosti a prečo.',
          citat: 'Toto sa vás budem pýtať na ústnej, ako sa volí súčiniteľ bezpečnosti a prečo.',
          cas: '38:40',
        },
      ],
    },
  ],
  pojmy: [
    { pojem: 'Metóda rezu', definicia: 'Myslené prerezanie telesa a nahradenie účinku odstránenej časti vnútornými silami v reze.', cas: '03:20' },
    { pojem: 'Normálové napätie σ', definicia: 'Normálová sila delená plochou prierezu, σ = N/A.', cas: '06:30' },
    { pojem: 'Šmykové napätie τ', definicia: 'Napätie v rovine rezu od posúvajúcej sily, pri jednoduchom šmyku τ = T/A.', cas: '09:10' },
    { pojem: 'Pomerné pretvorenie ε', definicia: 'Pomer predĺženia k pôvodnej dĺžke, ε = Δl/l₀ (bezrozmerné).', cas: '16:20' },
    { pojem: 'Modul pružnosti E', definicia: 'Konštanta úmernosti v Hookovom zákone (Youngov modul), jednotka ako napätie.', cas: '21:30' },
    { pojem: 'Medza klzu Re', definicia: 'Napätie, pri ktorom sa materiál začne trvalo deformovať.', cas: '30:00' },
    { pojem: 'Medza pevnosti Rm', definicia: 'Maximálne napätie, ktoré materiál znesie.', cas: '31:10' },
    { pojem: 'Poissonovo číslo ν', definicia: 'Záporný pomer priečneho a pozdĺžneho pretvorenia.', cas: '33:30' },
  ],
  vzorce: [
    { latex: '\\sigma = \\frac{N}{A}', popis: 'Normálové napätie', veliciny: 'σ – napätie [Pa, MPa]; N – normálová sila [N]; A – plocha prierezu [m², mm²]', cas: '06:30' },
    { latex: '\\tau = \\frac{T}{A}', popis: 'Šmykové napätie (jednoduchý šmyk)', veliciny: 'τ – šmykové napätie [Pa]; T – posúvajúca sila [N]; A – plocha [m²]', cas: '09:10' },
    { latex: '\\varepsilon = \\frac{\\Delta l}{l_0}', popis: 'Pomerné pretvorenie', veliciny: 'ε – pomerné pretvorenie [-]; Δl – predĺženie; l₀ – pôvodná dĺžka (rovnaké jednotky)', cas: '16:20' },
    { latex: '\\sigma = E\\,\\varepsilon', popis: 'Hookov zákon', veliciny: 'E – modul pružnosti [Pa] (oceľ ≈ 210 GPa, hliník ≈ 70 GPa)', cas: '20:30' },
    { latex: '\\Delta l = \\frac{N\\,l}{E\\,A}', popis: 'Predĺženie tyče', veliciny: 'N – sila [N]; l – dĺžka [mm]; E – modul pružnosti [MPa]; A – plocha [mm²]; EA – ťahová tuhosť', cas: '24:00' },
    { latex: '\\nu = -\\frac{\\varepsilon_{\\text{priečne}}}{\\varepsilon_{\\text{pozdĺžne}}}', popis: 'Poissonovo číslo', veliciny: 'ν – Poissonovo číslo [-] (oceľ ≈ 0,3)', cas: '33:30' },
    { latex: '\\sigma_{\\text{dov}} = \\frac{R_e}{k}', popis: 'Dovolené napätie', veliciny: 'Re – medza klzu [MPa]; k – súčiniteľ bezpečnosti (1,5 – 3)', cas: '36:00' },
  ],
  karticky: [
    { otazka: 'Ako je definované normálové napätie a aká je jeho jednotka?', odpoved: 'σ = N/A; jednotka Pa = N/m², v praxi MPa = N/mm².', sekciaId: 's2', skuskova: true },
    { otazka: 'Čo hovorí Hookov zákon?', odpoved: 'Pri malých napätiach je napätie priamo úmerné pomernému pretvoreniu: σ = E·ε.', sekciaId: 's5', skuskova: true },
    { otazka: 'Vzťah pre predĺženie tyče?', odpoved: 'Δl = N·l / (E·A); EA je ťahová tuhosť.', sekciaId: 's5', skuskova: true },
    { otazka: 'Ako sa určí dovolené napätie?', odpoved: 'σ_dov = Re / k, kde k je súčiniteľ bezpečnosti (1,5 – 3).', sekciaId: 's8', skuskova: true },
    { otazka: 'Poradie charakteristických medzí v ťahovom diagrame?', odpoved: 'Medza úmernosti → medza klzu Re → medza pevnosti Rm.', sekciaId: 's6', skuskova: false },
    { otazka: 'Čo je metóda rezu?', odpoved: 'Teleso myslene prerežeme, jednu časť odstránime a jej účinok nahradíme vnútornými silami v reze.', sekciaId: 's1', skuskova: false },
    { otazka: 'Modul pružnosti ocele a hliníka?', odpoved: 'Oceľ ≈ 210 GPa, hliník ≈ 70 GPa.', sekciaId: 's5', skuskova: true },
    { otazka: 'Definícia Poissonovho čísla?', odpoved: 'ν = −ε_priečne / ε_pozdĺžne; oceľ ≈ 0,3, guma → 0,5.', sekciaId: 's7', skuskova: false },
  ],
  naOverenie: [
    {
      text: 'Nejasná poznámka o „kappa, ktorý sa kráti s plochou pri druhom type zaťaženia“ – prepis nedáva zmysel, overte v poznámkach alebo u vyučujúceho.',
      cas: '39:00',
    },
  ],
  test: [
    {
      id: 'q1',
      typ: 'jedna',
      otazka: 'Ako je definované normálové napätie?',
      moznosti: ['σ = N · A', 'σ = N / A', 'σ = A / N', 'σ = E / ε'],
      spravne: 1,
      vysvetlenie: 'Normálové napätie je normálová sila delená plochou prierezu.',
      zdroj: { sekciaId: 's2', cas: '06:30', citat: 'Normálové napätie sigma je normálová sila delená plochou prierezu, teda sigma sa rovná N lomeno A.' },
      skuskova: true,
      obtiaznost: 1,
    },
    {
      id: 'q2',
      typ: 'pravdaNepravda',
      otazka: 'Jeden megapascal je rovný jednému newtonu na milimeter štvorcový.',
      spravne: true,
      vysvetlenie: '1 MPa = 10⁶ N/m² = 1 N/mm².',
      zdroj: { sekciaId: 's2', cas: '07:00', citat: 'a jeden megapascal je presne jeden newton na milimeter štvorcový' },
      skuskova: true,
      obtiaznost: 1,
    },
    {
      id: 'q3',
      typ: 'vypocet',
      otazka: 'Oceľová tyč kruhového prierezu s priemerom 20 mm je namáhaná ťahovou silou 31,4 kN. Aké je normálové napätie v tyči?',
      spravne: 100,
      tolerancia: 1,
      jednotka: 'MPa',
      vzorovaOdpoved: 'A = π·20²/4 ≈ 314 mm²; σ = 31 400 N / 314 mm² = 100 MPa.',
      vysvetlenie: 'Sila v N a plocha v mm² dajú napätie priamo v MPa.',
      zdroj: { sekciaId: 's3', cas: '14:30', citat: 'Napätie je potom tridsaťjedentisícštyristo newtonov lomeno tristoštrnásť milimetrov štvorcových, a to je sto megapascalov.' },
      skuskova: true,
      obtiaznost: 2,
    },
    {
      id: 'q4',
      typ: 'doplnenie',
      otazka: 'Konštanta E v Hookovom zákone sa nazýva modul ___ (Youngov modul).',
      spravne: ['pružnosti', 'pružnosti v ťahu'],
      vysvetlenie: 'E je modul pružnosti v ťahu, nazývaný aj Youngov modul.',
      zdroj: { sekciaId: 's5', cas: '21:30', citat: 'Konštanta E sa volá modul pružnosti v ťahu alebo Youngov modul a má rovnakú jednotku ako napätie.' },
      skuskova: true,
      obtiaznost: 1,
    },
    {
      id: 'q5',
      typ: 'viac',
      otazka: 'Ktoré tvrdenia o pomernom pretvorení sú správne?',
      moznosti: [
        'Je to bezrozmerná veličina.',
        'Udáva sa v megapascaloch.',
        'Δl a l₀ musia byť v rovnakých jednotkách.',
        'Je to pomer predĺženia k pôvodnej dĺžke.',
      ],
      spravne: [0, 2, 3],
      vysvetlenie: 'ε = Δl/l₀ je bezrozmerné; obe dĺžky musia mať rovnakú jednotku.',
      zdroj: { sekciaId: 's4', cas: '16:20', citat: 'Pomerné pretvorenie je epsilon sa rovná delta l lomeno l nula.' },
      skuskova: false,
      obtiaznost: 2,
    },
    {
      id: 'q6',
      typ: 'vypocet',
      otazka: 'Oceľová tyč (E = 210 GPa) dlhá 2 m je namáhaná napätím 100 MPa. O koľko sa predĺži?',
      spravne: 0.95,
      tolerancia: 0.02,
      jednotka: 'mm',
      vzorovaOdpoved: 'ε = 100 / 210 000 ≈ 4,76·10⁻⁴; Δl = ε · 2000 mm ≈ 0,95 mm.',
      vysvetlenie: 'Δl = ε·l = (σ/E)·l.',
      zdroj: { sekciaId: 's5', cas: '26:50', citat: 'Predĺženie je potom epsilon krát dvetisíc milimetrov, čo je asi nula celá deväťdesiatpäť milimetra.' },
      skuskova: true,
      obtiaznost: 3,
    },
    {
      id: 'q7',
      typ: 'jedna',
      otazka: 'Aký je približný modul pružnosti hliníka podľa prednášky?',
      moznosti: ['21 GPa', '70 GPa', '210 GPa', '700 GPa'],
      spravne: 1,
      vysvetlenie: 'Oceľ ≈ 210 GPa, hliník ≈ 70 GPa.',
      zdroj: { sekciaId: 's5', cas: '22:00', citat: 'Pre oceľ je E približne dvestodesať gigapascalov, pre hliník asi sedemdesiat gigapascalov.' },
      skuskova: true,
      obtiaznost: 1,
    },
    {
      id: 'q8',
      typ: 'jedna',
      otazka: 'Ktorá charakteristika ťahového diagramu nasleduje hneď po medzi úmernosti?',
      moznosti: ['Medza pevnosti Rm', 'Medza klzu Re', 'Zaškrtenie vzorky', 'Modul pružnosti'],
      spravne: 1,
      vysvetlenie: 'Poradie: medza úmernosti → medza klzu → medza pevnosti.',
      zdroj: { sekciaId: 's6', cas: '32:10', citat: 'Zapamätajte si poradie: medza úmernosti, medza klzu, medza pevnosti.' },
      skuskova: false,
      obtiaznost: 2,
    },
    {
      id: 'q9',
      typ: 'pravdaNepravda',
      otazka: 'Poissonovo číslo ocele je približne 0,5.',
      spravne: false,
      vysvetlenie: 'Pre oceľ je ν ≈ 0,3; k 0,5 sa blíži guma.',
      zdroj: { sekciaId: 's7', cas: '34:50', citat: 'Pre oceľ je Poissonovo číslo približne nula celá tri, pre gumu sa blíži k nula celá päť.' },
      skuskova: false,
      obtiaznost: 1,
    },
    {
      id: 'q10',
      typ: 'otvorena',
      otazka: 'Vysvetlite, čo je dovolené napätie a ako sa volí súčiniteľ bezpečnosti.',
      vzorovaOdpoved:
        'Dovolené napätie je medza klzu vydelená súčiniteľom bezpečnosti, σ_dov = Re/k. Skutočné napätie musí byť menšie alebo rovné dovolenému. Súčiniteľ k sa volí bežne 1,5 až 3 podľa toho, ako presne poznáme zaťaženie.',
      kluceveBody: ['σ_dov = Re / k', 'pevnostná podmienka σ ≤ σ_dov', 'k ≈ 1,5 – 3', 'voľba podľa presnosti poznania zaťaženia'],
      vysvetlenie: 'Napätie nesmie dosiahnuť medzu klzu, preto pracujeme s bezpečnostnou rezervou.',
      zdroj: { sekciaId: 's8', cas: '38:40', citat: 'Toto sa vás budem pýtať na ústnej, ako sa volí súčiniteľ bezpečnosti a prečo.' },
      skuskova: true,
      obtiaznost: 2,
    },
    {
      id: 'q11',
      typ: 'jedna',
      otazka: 'V ktorej rovine leží šmykové napätie?',
      moznosti: ['Kolmo na rez', 'V rovine rezu', 'Rovnobežne s osou prúta', 'Nezáleží na rovine'],
      spravne: 1,
      vysvetlenie: 'Normálové napätie je kolmé na rez, šmykové leží v rovine rezu.',
      zdroj: { sekciaId: 's2', cas: '10:40', citat: 'normálové napätie je kolmé na rez, šmykové napätie leží v rovine rezu' },
      skuskova: false,
      obtiaznost: 1,
    },
    {
      id: 'q12',
      typ: 'doplnenie',
      otazka: 'Súčin E·A sa nazýva ťahová ___ prúta.',
      spravne: ['tuhosť', 'tuhost'],
      vysvetlenie: 'EA je ťahová tuhosť prúta.',
      zdroj: { sekciaId: 's5', cas: '24:10', citat: 'Súčin E krát A sa nazýva ťahová tuhosť prúta.' },
      skuskova: true,
      obtiaznost: 2,
    },
  ],
}
