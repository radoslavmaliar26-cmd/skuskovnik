# ROZHODNUTIA

Rozhodnutia urobené počas autonómnej práce (bez možnosti sa opýtať).

1. **Repozitár neexistoval.** Účet `radoslavmaliar26-cmd` nemal žiadne repo, preto som vytvoril verejné repo `skuskovnik` (`gh repo create`). Nastavenia repa ani GitHubu som nemenil. Base URL appky je `/skuskovnik/`.
2. **Forced tool use pri Claude Sonnet 5.5 nefunguje.** Podľa aktuálnej dokumentácie API vracia `tool_choice` typu `tool`/`any` pri `claude-sonnet-5-5` (aj Opus 5.5, Fable 5.1) chybu 400. Preto posielam `tool_choice: {type: "auto"}` + jednoznačnú inštrukciu „odpovedz výhradne volaním nástroja“. Pre staršie modely (napr. Haiku 4.5, Sonnet 4.x) sa použije vynútený nástroj podľa zadania. Ak model nástroj nezavolá, výstup sa skúsi spracovať ako JSON z textu tým istým robustným parserom ako v režime A.
3. **Volanie Anthropic API cez `fetch`, nie SDK** – zadanie výslovne definuje REST hlavičky (vrátane `anthropic-dangerous-direct-browser-access`), appka je čisto v prehliadači a SDK by zbytočne zväčšilo bundle.
4. **Audio v IndexedDB ako `ArrayBuffer`, nie `Blob`** – Safari malo v minulosti chyby pri ukladaní Blobov do IndexedDB; ArrayBuffer je spoľahlivejší.
5. **Časy v schéme materiálu sú reťazce `mm:ss`** (minúty môžu byť > 59, napr. `75:20`) – rovnaký formát ako v prepise, ktorý AI dostáva.
6. **Server-side fallback pri odmietnutí (refusal).** Pre `claude-sonnet-5-5` (a Opus 5/5.5, Fable 5.1) appka posiela `fallbacks: "default"` s hlavičkou `anthropic-beta: server-side-fallback-2026-07-01`, ako odporúča aktuálna dokumentácia. Ak by to API odmietlo (400), požiadavka sa automaticky zopakuje bez tohto parametra.
7. **Kratšie úseky pre modely bez časových značiek.** `gpt-4o-transcribe`/`gpt-4o-mini-transcribe` majú obmedzený výstup (~2 000 tokenov), preto pre ne appka reže nahrávku a importované súbory na max. ~4 min (inak 5–10 min podľa nastavenia).
8. **Tichý úsek = radšej prepísať.** Úsek sa vynechá z prepisu, len ak v ňom bolo menej ako ~1 s hlasitejšieho zvuku; ak analyzátor hlasitosti nefunguje, úsek sa prepíše vždy. Vynechané úseky sa dajú dodatočne poslať na prepis (Audio → „Prepísať aj tiché úseky“).
9. **Halucinácie Whisperu** sa odstraňujú len ako krátke samostatné vety (napr. „Titulky vytvoril…“); dlhší text sa kvôli nim nikdy nezahodí. „Ďakujem za pozornosť“ sa odstráni len vtedy, keď metadáta ukazujú ticho.
10. **Živý prepis cez Web Speech API** je samostatný experimentálny zdroj (bez ukladania zvuku), dostupný len v prehliadačoch, ktoré API podporujú.
11. **Revízia kódu** prebehla cez subagenta s čerstvým kontextom; všetkých 15 nájdených problémov (najmä strata dát pri nahrávaní, zaseknutý stav prepisu, filter halucinácií, schránka na iOS) je opravených – pozri históriu commitov.
