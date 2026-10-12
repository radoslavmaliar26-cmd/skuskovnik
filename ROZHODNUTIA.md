# ROZHODNUTIA

Rozhodnutia urobené počas autonómnej práce (bez možnosti sa opýtať).

1. **Repozitár neexistoval.** Účet `radoslavmaliar26-cmd` nemal žiadne repo, preto som vytvoril verejné repo `skuskovnik` (`gh repo create`). Nastavenia repa ani GitHubu som nemenil. Base URL appky je `/skuskovnik/`.
2. **Forced tool use pri Claude Sonnet 5.5 nefunguje.** Podľa aktuálnej dokumentácie API vracia `tool_choice` typu `tool`/`any` pri `claude-sonnet-5-5` (aj Opus 5.5, Fable 5.1) chybu 400. Preto posielam `tool_choice: {type: "auto"}` + jednoznačnú inštrukciu „odpovedz výhradne volaním nástroja“. Pre staršie modely (napr. Haiku 4.5, Sonnet 4.x) sa použije vynútený nástroj podľa zadania. Ak model nástroj nezavolá, výstup sa skúsi spracovať ako JSON z textu tým istým robustným parserom ako v režime A.
3. **Volanie Anthropic API cez `fetch`, nie SDK** – zadanie výslovne definuje REST hlavičky (vrátane `anthropic-dangerous-direct-browser-access`), appka je čisto v prehliadači a SDK by zbytočne zväčšilo bundle.
4. **Audio v IndexedDB ako `ArrayBuffer`, nie `Blob`** – Safari malo v minulosti chyby pri ukladaní Blobov do IndexedDB; ArrayBuffer je spoľahlivejší.
5. **Časy v schéme materiálu sú reťazce `mm:ss`** (minúty môžu byť > 59, napr. `75:20`) – rovnaký formát ako v prepise, ktorý AI dostáva.
