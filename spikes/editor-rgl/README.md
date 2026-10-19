# Spik etapp 0: dra och släpp i den skalade canvasen

Underlag för [docs/EDITOR-PLAN.md](../../docs/EDITOR-PLAN.md#dra-och-släpp-val-av-bibliotek). Koden byggs inte av CI och
används inte av appen. Den finns kvar så att resultaten kan köras om.

```bash
cd spikes/editor-rgl
npm ci && npm run build && npm run preview &   # http://localhost:4180/
CHROME=/usr/bin/google-chrome npm test          # dra/storlek med riktig mus i puppeteer
npm run fonts                                   # typsnittsmått
```

## Uppställning

- Samma canvas som TV:n: 3840×2160, skalad med `translate(-50%, -50%) scale(s)` och centrerad som `ScaledCanvas`.
- En header-yta på 300 px ovanför rutnätet, så att rutnätet **inte** börjar i canvasens hörn.
- `react-grid-layout` 2.3.0 (React 19.3) med 24 × 12 rutor, mellanrum 48 px, `maxRows: 12`, `bounded: true`, ingen
  kompaktering och `preventCollision: true`.
- Testet drar och ändrar storlek med riktig mus vid sex fönsterstorlekar: 1280×720, 1366×768, 1920×1080, 2560×1080
  (21:9, svarta kanter i sidled), 3840×2160 och 1600×1200 (4:3, svarta kanter upptill och nedtill).

Fem kontroller per storlek:

1. Dra 3 kolumner åt höger.
2. Ändra storlek 2 kolumner och 1 rad.
3. Dra in i ett annat element (ska spärras).
4. Dra förbi högerkanten (ska stanna).
5. Dra förbi nederkanten (ska stanna på rad 12).

## Resultat (19 okt 2026)

| Positionsstrategi | Godkända |
|---|---|
| Utan strategi (biblioteket tror att skalan är 1) | 10/30, fungerar bara vid 3840×2160 |
| Bibliotekets `createScaledStrategy(scale)` | 9/30, x blir rätt men y hamnar 2 rader fel |
| **Egen `createCanvasStrategy(scale, grid)`** (i `src/main.tsx`) | **30/30** |

- **Därför fungerar bibliotekets strategi inte:** `createScaledStrategy` räknar elementets position som skärmposition
  delad med skalan. Den förutsätter att rutnätet börjar i fönstrets övre vänstra hörn. Hos oss ligger rutnätet under
  header-ytan och canvasen är centrerad, så felet blir header-höjden (300 px, cirka 2 rader).
- **Lösning:** en egen strategi på 10 rader som drar av rutnätets egen position (`getBoundingClientRect`) innan den delar
  med skalan. Kollision, gränser och storleksändring fungerar då vid alla skalor, och react-grid-layout behålls.
  Gridstack behövs inte som reserv.
- **Puck** (0.23): `DropZone` har bara `zone`, `allow`, `disallow` och `collisionAxis`. Det är listor i en riktning, utan
  `x, y, w, h` och utan storleksändring. Det bekräftar att Puck inte passar vårt fasta rutnät.
- **Ej testat än (görs i etapp 2):** dra in från paletten (`dropConfig`), touch och tangentbord.

## Typsnittsmått

Uppmätta i Chrome på utvecklingsboxen (`npm run fonts`, kräver `npm ci` i `frontend/`):

| Stack | Typsnitt | Versalhöjd | Höjd för siffran 0 | Siffrans bredd 400 / 700 | Radhöjd `normal` |
|---|---|---|---|---|---|
| `font-sans` | Geist Variable (paketerad, `@fontsource-variable/geist`) | 0,719 em | 0,734 em | 0,663 / 0,693 em | 1,30 em |
| `font-mono` | systemets (DejaVu Sans Mono här) | 0,672 em | 0,672 em | 0,600 em | 1,133 em |

- **`font-sans` ser likadan ut överallt:** typsnittet ingår redan i appen, så måtten är desamma på alla datorer.
  Editorns spärrar kan räkna med versalhöjden 0,719 em.
- **`font-mono` beror på datorn:** stacken använder systemets typsnitt (klockan och stora tal). Fitlet3 och TV:n kan ha
  ett annat typsnitt än utvecklingsboxen. Etapp 5 bör paketera även ett mono-typsnitt, t.ex. Geist Mono, som woff2.
- **Siffrorna i Geist har olika bredd i olika vikter:** 0,663 em i normal vikt och 0,693 em i fet. Breddspärrarna måste
  räkna med den fetaste vikten som används.
- **Radhöjden spelar roll:** innehållshöjden 1,30 em är större än versalhöjden. Det förklarar att highscore-raderna
  flödade över med `leading-none` (PR #16). Editorns minsta storlekar måste räkna med radhöjden, inte bara med
  versalhöjden.
