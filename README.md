# Skúškovník

Webová appka (PWA) pre iPhone aj počítač: **nahráš prednášku → appka ju prepíše → spraví z nej prehľadný učebný materiál → zvýrazní, čo bude na skúške → vyskúša ťa testom.**

**Adresa appky:** https://radoslavmaliar26-cmd.github.io/skuskovnik/
(funguje po zapnutí GitHub Pages – pozri [RANO.md](RANO.md))

## Čo appka robí

- **Nahrávanie** prednášky po 5-minútových úsekoch (rez v tichu), každých 10 s sa ukladá do telefónu – pri páde alebo zamknutí sa nič nestratí. Počas nahrávania ťukaš na ⭐ *Dôležité* a 🎯 *Bude na skúške*.
- **Import** zvukového súboru (m4a, mp3, wav, aac, mp4, webm – napr. z Hlasových poznámok) alebo **vloženie hotového textu** prepisu.
- **Prepis** cez Groq (zadarmo), OpenAI alebo vlastný OpenAI-kompatibilný server. Beží už počas nahrávania, úseky čakajú vo fronte, chyby sa automaticky opakujú.
- **Lokálna detekcia** viet typu „toto bude na skúške“, „zapíšte si“, termínov písomiek (slovensky aj česky, bez AI).
- **Učebný materiál** od Claude v dvoch režimoch:
  - *Cez Claude appku* (bez platenia za API) – appka skopíruje zadanie, vložíš ho do claude.ai, odpoveď vložíš späť;
  - *Automaticky cez Anthropic API* – platené podľa spotreby.
- **Overenie citátov**: každú vetu, o ktorej Claude tvrdí, že ju vyučujúci povedal, appka vyhľadá v prepise. Neoverené položky nikdy nedostanú červenú značku 🔴 NA SKÚŠKE.
- **Testy** (jedna/viac správnych, pravda/nepravda, doplňovačka, otvorená otázka, výpočet), vyhodnotenie s vysvetlením a odkazmi do materiálu, prepisu aj zvuku. Nový test, zopakovanie chybných, test z celého predmetu.
- **Kartičky** s Leitnerovým systémom opakovania, štatistiky a slabé témy.
- **Export** do Markdownu, tlač/PDF, záloha a obnova všetkých dát.
- Všetko je **len v tvojom zariadení** (IndexedDB). Žiadny server, žiadne účty.

## Inštalácia na iPhone

1. V **Safari** otvor https://radoslavmaliar26-cmd.github.io/skuskovnik/
2. Ťukni na **Zdieľať** (štvorec so šípkou) → **Pridať na plochu** → Pridať.
3. Spúšťaj appku z plochy (beží na celú obrazovku a funguje aj offline).
4. **Kľúče zadávaj až v appke na ploche** – má oddelené úložisko od Safari.

## Kľúče

| Na čo | Služba | Kde získať | Cena |
|---|---|---|---|
| Prepis reči | **Groq** (predvolené) | https://console.groq.com/keys | bezplatný limit |
| Prepis reči | OpenAI | https://platform.openai.com/api-keys | platené |
| Materiál automaticky | Anthropic | https://console.anthropic.com/settings/keys | platené podľa spotreby |

Kľúče sa zadávajú v **Nastaveniach**, ukladajú sa len v zariadení a posielajú sa iba priamo danej službe. Tlačidlo „Otestovať kľúč“ overí, či funguje. Bez Anthropic kľúča stačí režim „Cez Claude appku“ (bežné predplatné Claude).

## Používanie

1. **＋ Nová prednáška** → predmet, názov → Nahrávať / Importovať / Vložiť text.
2. Pri nahrávaní nechaj appku otvorenú na popredí (ideálne na nabíjačke, blízko vyučujúceho). Ak iOS nahrávanie preruší, appka uloží doterajšiu časť a ponúkne **Pokračovať v nahrávaní**.
3. Po prepise ťukni na **✨ Vytvoriť materiál**.
4. Materiál začína sekciou **🔴 Bude na skúške**; prepínač **Len skúškové** skryje zvyšok.
5. Záložka **Test** → Spustiť. Po teste uvidíš chyby s vysvetlením a odkazmi „Ukázať v materiáli“ / „Prehrať od mm:ss“.
6. **Vyskúšať demo** (na úvodnej obrazovke) ukáže celý postup bez kľúčov.

Značky: 🔴 NA SKÚŠKE · 🟠 DÔLEŽITÉ · ⭐ Označil si · 🔵 Definícia/Vzorec · 📅 Organizačné · ⚪ Neoverené.

## Obmedzenia

- iOS nedovolí webovej appke nahrávať na pozadí ani pri zamknutej obrazovke → appka drží obrazovku zapnutú (Wake Lock); nastav si *Automatické zamykanie → Nikdy*, ak to telefón nepodporuje.
- Prepis aj generovanie bežia len pri otvorenej appke; po opätovnom otvorení pokračujú.
- Veľké súbory (> 24 MB) appka dekóduje v telefóne – pri veľmi dlhých nahrávkach môže dôjsť pamäť (appka poradí, čo robiť).
- Kvalita materiálu závisí od kvality nahrávky a prepisu; miesta, kde prepis nedáva zmysel, sú v zozname „Na overenie“.
- Nahrávaj v súlade s pravidlami školy a so súhlasom vyučujúceho.

## Pre vývojára

```bash
npm install
npm run dev        # vývojový server
npm test           # unit testy (Vitest)
npm run typecheck  # tsc
npm run lint       # oxlint
npm run build      # build do docs/ (GitHub Pages)
npm run smoke      # headless smoke test buildu v lokálnom Chrome (screenshoty do screenshots/)
npm run icons      # vygeneruje PNG ikony zo scripts/icon.svg
npm run e2e:prepis -- <súbor.wav> [model] [--record=80] [--fail429]   # end-to-end test prepisu v Chrome proti lokálnemu mock API
# reálny test s Groq: GROQ_KEY_FILE=<súbor s kľúčom> npm run e2e:prepis -- <súbor> whisper-large-v3 --lang=sk
```

Štruktúra: `src/audio` (nahrávanie, import, WAV), `src/transcription` (prepis, fronta), `src/ai` (prompty, Claude, parser, overenie citátov), `src/exam` (detekcia skúškových fráz, skórovanie, kartičky), `src/db` (Dexie), `src/ui`, `src/pages`, `src/demo`.
