# RÁNO – čo urobiť (krok za krokom)

**URL appky:** https://radoslavmaliar26-cmd.github.io/skuskovnik/
**Repozitár:** https://github.com/radoslavmaliar26-cmd/skuskovnik

> Repo na tvojom účte neexistovalo, preto som ho vytvoril ako verejné repo `skuskovnik` (viac v [ROZHODNUTIA.md](ROZHODNUTIA.md)). Všetko je vo vetve `main`, zostavená appka v priečinku `docs/`.

## 1. Zapni GitHub Pages (na počítači alebo v mobile, 1 minúta)

1. Otvor https://github.com/radoslavmaliar26-cmd/skuskovnik/settings/pages
2. **Source:** *Deploy from a branch*
3. **Branch:** `main`, priečinok **`/docs`** → **Save**
4. Počkaj 1–2 minúty, kým sa hore zobrazí „Your site is live at …“.

## 2. Nainštaluj appku na iPhone

1. V **Safari** (nie v Chrome) otvor https://radoslavmaliar26-cmd.github.io/skuskovnik/
2. Ťukni na **Zdieľať** (štvorec so šípkou nahor) → **Pridať na plochu** → **Pridať**.
3. Zatvor Safari a spusti **Skúškovník z plochy**.
4. ⚠️ Appka na ploche má **vlastné úložisko** – kľúče a prednášky zadávaj až v nej (nie v Safari).

## 3. Vyskúšaj demo (bez kľúčov)

Na úvodnej obrazovke ťukni **▶︎ Vyskúšať demo** → otvorí sa ukážková prednáška z pružnosti s hotovým materiálom. Prejdi si:
- **Materiál** (hore „🔴 Bude na skúške“, prepínač „Len skúškové“, vzorce),
- **Test** → Spustiť → odpovedz → vyhodnotenie a „Zopakovať chybné“,
- **Prepis** (zvýraznené vety „toto bude na skúške“),
- **Opakovanie** (kartičky).

## 4. Zadaj kľúč na prepis (Groq – zadarmo)

1. Na https://console.groq.com/keys sa prihlás (Google účet stačí) → **Create API Key** → skopíruj.
2. V appke: **Nastavenia → Prepis reči na text** → služba *Groq* → vlož kľúč → **Uložiť** (appka ho hneď otestuje, má sa ukázať ✅).

Voliteľne **Anthropic kľúč** (https://console.anthropic.com/settings/keys) pre automatické vytváranie materiálu – inak použi režim „Cez Claude appku“, ktorý funguje s bežným predplatným Claude.

## 5. Krátky skúšobný záznam (2 minúty)

1. **＋ Nová prednáška** → nový predmet (napr. „Test“) → **Pokračovať k nahrávaniu** → **● Začať nahrávať** → povoľ mikrofón.
2. Hovor ~1 minútu (napr. „Toto bude na skúške: …“), ťukni na 🎯 a ⭐.
3. **⏹ Ukončiť** → prepis sa spustí sám (vidíš „Prepisuje sa 0/1 … 1/1“).
4. **✨ Vytvoriť materiál** → *Cez Claude appku*: **📋 Kopírovať pre Claude** → **Otvoriť Claude** → vlož, odošli → skopíruj odpoveď (tlačidlo kopírovať pod odpoveďou) → vráť sa do Skúškovníka → **📥 Vložiť odpoveď zo schránky** → **✅ Spracovať odpoveď**.
5. Vyskúšaj aj zamknutie obrazovky počas nahrávania: po odomknutí appka ukáže **Pokračovať v nahrávaní** a doterajšia nahrávka zostane uložená.

**Pred skutočnou prednáškou:** Nastavenia iPhonu → Displej a jas → Automatické zamykanie → *Nikdy* (pre istotu), mobil na nabíjačku, appka otvorená.

## Čo funguje (overené testami)

- Nahrávanie po úsekoch (rez v tichu, ukladanie každých 10 s, Wake Lock, obnova po prerušení aj po páde appky), import súborov (do 24 MB priamo, väčšie delené na WAV časti po ~10 min, pri modeloch gpt-4o po ~4 min), vloženie textu.
- Prepis cez Groq/OpenAI/vlastný server s frontou, opakovaním (429 + retry-after, exponenciálne čakanie), filtrovaním halucinácií a obnovou po zatvorení appky.
- Lokálna detekcia skúškových, dôležitých a organizačných viet (sk/cs).
- Materiál v oboch režimoch (Claude appka aj API so streamom), validácia schémy, robustný parser vloženej odpovede (aj rozdelenej do viacerých správ), opravná výzva, overenie citátov.
- Testy so 6 typmi otázok, vyhodnotenie, prehľad chýb, nový test, zopakovanie chybných, test z predmetu, AI hodnotenie otvorených odpovedí (API).
- Kartičky (Leitner), štatistiky, export Markdown/PDF, záloha/obnova, zmazanie audia, prehrávanie od časovej značky, čierna úsporná obrazovka.
- P2: fotky tabule počas nahrávania (📷 – v režime API ich dostane aj Claude), štatistiky a slabé témy (záložka Opakovanie), počítadlo spotreby (Nastavenia), experimentálny živý prepis cez Web Speech API (Nová prednáška → „🧪 Živý prepis“; zvuk sa neukladá).
- Inštalovateľná PWA, offline režim (okrem volaní AI), ponuka „Obnoviť“ pri novej verzii.
- 109 unit testov (Vitest) + headless smoke test v Chrome (390×844, vrátane nahrávania s falošným mikrofónom a pauzy; screenshoty v `screenshots/`).
- Revízia celého kódu (subagent) – 15 nájdených problémov opravených.

## Čo nie je overené / známe obmedzenia

- **Nemal som k dispozícii iPhone** – Safari/iOS správanie (prerušenie nahrávania, Wake Lock, schránka) je naprogramované podľa dokumentácie a otestované v Chrome; prosím vyskúšaj krok 5.
- Volania Groq/OpenAI/Anthropic API som nemohol vyskúšať naživo (prostredie nemalo prístup ani kľúče) – sú overené proti mockom podľa dokumentácie. Ak by niečo zlyhalo, appka ukáže zrozumiteľnú chybu.
- iOS nedovolí nahrávať na pozadí ani pri zamknutej obrazovke; prepis a generovanie bežia len pri otvorenej appke.
- Pri importe veľmi dlhých nahrávok (> ~1,5 h, > 24 MB) môže telefónu dôjsť pamäť pri dekódovaní – appka vtedy poradí orezať nahrávku alebo zvoliť „Komprimovanú“ kvalitu v Hlasových poznámkach.
- Fotky tabule sa posielajú Claudovi len v režime API (v režime Claude appky sa neposielajú).
- Živý prepis (Web Speech API) je experimentálny – na iPhone ho Safari môže po chvíli ticha zastaviť (appka ho reštartuje), presnosť je nižšia ako pri Groq.
- Wake Lock v appke z plochy funguje spoľahlivo až od iOS 18.4 – na starších verziách nastav Automatické zamykanie na „Nikdy“.

## Čo bolo zablokované

- Nič podstatné. Jeden `git push` raz zlyhal na DNS (github.com sa dočasne nedal preložiť), o chvíľu prešiel.
