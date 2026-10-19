# Roadmap

Dashboarden är **endast för visning** – ingen användare interagerar med den. Den enda skrivningen till PLC:n är aktiv skärm (`ActiveScreenNr`), som styrs av PLC-logiken.

Lägg till nya punkter som checklistor under rätt rubrik och flytta dem till **Klart** när de är mergade (med PR-nummer).

## Klart

### Bygg & säkerhet ([PR #1](https://github.com/maizlow/asyncua-dashboard/pull/1))
- [x] Byggfel i frontend (TypeScript/ESLint) fixade
- [x] Live-alarm uppdateras korrekt
- [x] Read-only API (ingen `POST /api/general`, ingen skrivväg för användare)
- [x] Hemligheter borttagna från repot och git-historiken rensad
- [x] CI (lint, build, ruff, import-test)
- [x] Demoläge med simulerad data på [GitHub Pages](https://maizlow.github.io/asyncua-dashboard/)

### Historik, tider & trådning ([PR #2](https://github.com/maizlow/asyncua-dashboard/pull/2))
- [x] Sparklines visar de senaste N punkterna
- [x] Tidsstämplar i UTC, skifttider i lokal tidszon (sommartidssäkert)
- [x] Nattskift över midnatt (t.ex. 22:00–06:00)
- [x] Gallring av gammal historik (`RETENTION_DAYS`)
- [x] Trådsäkra WebSocket-uppdateringar
- [x] OPC UA-återanslutning när en delprocess faller
- [x] 42 pytest-tester i CI

### OEE-detaljer för takpannelinjen ([PR #4](https://github.com/maizlow/asyncua-dashboard/pull/4))
- [x] Ny skärm 4 (OEE): Tillgänglighet, Prestanda, Kvalitet och total OEE
- [x] Produktion vs mål (mål hittills = planerad tid × 140 st/min, skiftmål, prognos)
- [x] Kassation, takt mot nominell takt, stopp (antal, total, längsta, MTBF/MTTR), skiftinfo, godkända per timme
- [x] Värdena beräknas i backend (`backend/opc/oee.py`, `GET /api/oee`, WebSocket `oee_details`); nominell takt via `NOMINAL_RATE_TPM`
- [x] Saknade/ej konfigurerade OPC-noder hoppas över utan att övriga taggar påverkas
- [x] Påhittade delta-värden borttagna från `DashboardScreen`
- [x] Alla skärmar skalar till TV-storlekar (720p, 1080p, 4K, 21:9) via en fast 3840×2160-yta
- [x] 54 pytest-tester i CI

### TV-läsbarhet på 8–10 m och ingen overflow ([PR #5](https://github.com/maizlow/asyncua-dashboard/pull/5))
- [x] Hjältesiffror ≥ 90 px versalhöjd vid 1080p (Dashboard, godkända, OEE %), larmtext ≈ 79 px, inget viktigt under ≈ 37 px
- [x] Dashboard i 2×3 rutor med stora ▲/▼-förändringar och mål + framdrift; små sparklines borttagna
- [x] OEE-skärmen förenklad till 6 stora rutor; MTBF/MTTR, längsta stopp, "% av nominell", "av total", gått/kvar-rad och timstaplar borttagna (skift kvar visas stort)
- [x] Larm: klass med färg + ikon + ord (LARM/VARNING), ID/Klass-raden borttagen, max 3 larm + "fler aktiva larm", lång text klipps med ellipsis
- [x] Klocka i 24-timmarsformat (sv-SE), datumraden borttagen
- [x] Ljusare färger för text (grå #d4d4d8, röd #f87171, grön #22c55e) och status aldrig bara med färg (▲/▼/●, "UNDER MÅL", "STÅR")
- [x] Ingen skärm får scrolla eller flöda över: `overflow: hidden` på html/body/#root, fasta rader, ellipsis; `npm run check:fit` i CI (5 upplösningar × alla skärmar, även många långa larm via `?alarms=many`)

### 6-siffriga antal ([PR #6](https://github.com/maizlow/asyncua-dashboard/pull/6))
- [x] Produktion/godkända, mål, skiftmål och prognos får plats upp till 999 999 utan overflow; hjältesiffror kvar på ≈ 97 px versalhöjd vid 1080p
- [x] Demo-parametrar `?count=999999` och `?stopped=1` och motsvarande fall i `check:fit` (alla 5 upplösningar); klippt text utanför larmskärmen räknas som fel
- [x] Stopp-rutan: "STÅR" flyttad till rubrikraden så att 2–3-siffrigt antal stopp inte flödar över

### Konfiguration i YAML ([PR #7](https://github.com/maizlow/asyncua-dashboard/pull/7))
- [x] `dashboard.yaml`: OPC UA-noder, taggar (alias en gång, refereras med namn), skärmar och objekt – inga kodändringar för att lägga till/ta bort/koppla om objekt
- [x] Objekttyper `number`, `percent`, `counter`, `time`, `status` med `unit`, `label`, `target`, `decimals`, `thresholds`, `trend`, `color`; skärmtyper `grid`, `alarms`, `shift`, `oee`
- [x] Validering med pydantic och svenska felmeddelanden med rad och nyckel (`python -m backend.dashboard_config`), JSON-schema i `docs/dashboard.schema.json`
- [x] `GET /api/layout`; frontenden ritar skärmarna från layouten; demoläget byggs från samma fil
- [x] Alarmnod (`ns=3;i=1815`) och skärmnoder flyttade från `backend/config.py` till YAML; hemligheter kvar i `.env`
- [x] Gränser som garanterar läsbarhet/ingen overflow (1–6 objekt, rubrik ≤ 20, enhet ≤ 6 tecken); `check:fit` kör även värsta-fallet `docs/examples/stress.yaml`
- [x] Dokumentation på svenska: [docs/CONFIG.md](docs/CONFIG.md)

### Fasta decimaler ([PR #8](https://github.com/maizlow/asyncua-dashboard/pull/8))
- [x] Decimaltal visas alltid med decimalkomma och fast antal decimaler, även när decimalen är 0 (82,0 %, 3,0 %, 140,0); räknare är heltal
- [x] YAML `decimals:` är fast; standard `percent` 1, `counter` 0, `number` 1 när taggen är ett decimaltal; trender med samma decimaler
- [x] Takt på OEE-skärmen med en decimal (nominell takt på raden under); formatteringstester (`npm test`) i CI

### Dokumentation av beräkningar ([PR #10](https://github.com/maizlow/asyncua-dashboard/pull/10))
- [x] [docs/BERAKNINGAR.md](docs/BERAKNINGAR.md): formel (LaTeX), taggar, inställningar, avrundning, specialfall och räkneexempel för alla beräknade värden (OEE, A/P/Q, mål hittills, skiftmål, prognos, kassation, stopp, skift kvar, skiftmönster, trend, gränsvärdesfärger, PÅ MÅL/UNDER MÅL)
- [x] Länkad från README och CONFIG.md

### Mål från PLC:n och rättade beräkningar ([PR #11](https://github.com/maizlow/asyncua-dashboard/pull/11))
- [x] Skiftmål från PLC-taggen `ShiftTarget` (Mål hittills = pro rata); utan taggen visas `–` och inget PÅ/UNDER MÅL (ingen reserv med nominell takt)
- [x] OEE-mål från PLC-taggen `OeeTarget` (%, 85 om tom) i stället för hårdkodade 85 %
- [x] Kvalitet (och OEE) visar `–` utan `RejectCount`; ingen dubbelräkning av kassation när `ProductionCount` används (godkända = `ProductionCount` − `RejectCount`)
- [x] Färger och PÅ/UNDER MÅL följer det avrundade, visade värdet
- [x] Skiftmönstret räknar timmar från skiftstart: rätt längd och etiketter för t.ex. 06:30–14:30 och 8,5 h-skift
- [x] Rättade CONFIG.md/schema/kommentarer (krävda/reserverade taggar, `decimals` för `counter`, `thresholds`); demo med skiftmål 140 × 0,85 st/min

### Skärm 7 dagar ([PR #14](https://github.com/maizlow/asyncua-dashboard/pull/14))
- [x] Ny skärmtyp `week` (skärm 5 i exempelfilen): idag + 6 dagar bakåt med OEE %, godkända per dag och dagsmål (`ShiftTarget`) som stapeldiagram
- [x] Dygn i `TIMEZONE` (sommartidssäkert, 23/25 h), allt delas vid midnatt; dagar utan data visar `–`
- [x] Aggregering i SQLite (fönsterfunktioner), tidigare dagar cachas, idag räknas om var `HISTORY_INTERVAL_S`; `GET /api/history/days?n=7` och WebSocket `daily_history`
- [x] Demo med simulerad vecka (OEE 80–86 %, kort lördag, söndag utan produktion), `check:fit` med 7-dagarsskärmen (även 6-siffriga antal och 100,0 %)

### Skiftlogg och summering över skift ([PR #15](https://github.com/maizlow/asyncua-dashboard/pull/15))
- [x] Tabellen `shifts`: en rad per skift (start/slut, lag, mål, OEE-mål, planerad tid, godkända/kassation/totalt, körtid, stopp, öppen/stängd); gallras inte
- [x] Skiftbyte från `ShiftStart` (eller klockan vid samma starttid varje dag) med väntetid `SHIFT_SETTLE_S` för taggar som kommer i olika OPC-ramar; stängt skift behåller parametrarna från före bytet; räknare delas med ökningar vid nollställningen
- [x] Omstart mitt i skiftet, fladdrande/bakåtgående `ShiftStart` och saknade taggar hanteras; tester med taggar i fel ordning
- [x] Nya taggar `PlannedTime` (planerad tid exkl. raster, minuter) och `ShiftTeam`; OEE-skärmens tillgänglighet använder `PlannedTime`
- [x] 7-dagarsskärmen summerar skiftloggen (nattskift delas vid midnatt efter tidsandel, OEE räknas om från summorna, OEE-mål viktat med planerad tid); äldre dagar som förut; `GET /api/shifts`
- [x] Demo med 2–3 skift per dag och skiftlag A/B/C

### Skärm Körtids-highscore ([PR #16](https://github.com/maizlow/asyncua-dashboard/pull/16))
- [x] Ny skärmtyp `highscore` (skärm 6 i exempelfilen): de fem längsta körningarna utan stopp med Körd tid, Skiftlag och Datumstämpel; rekordet störst, körningar i pågående skift markerade
- [x] Pågående körning räknas upp och visas mot rekordet ("rekord om", "▲ NYTT REKORD"), och i listan när den är lång nog
- [x] Körningar sparas i `run_records` (gallras inte), avslutas vid senast bekräftad tid vid omstart/OPC-avbrott; `HIGHSCORE_MIN_STOP_S` för korta stopp; `GET /api/highscores`
- [x] Demo och `check:fit` (även 3-siffriga timmar och lag "A→B")

### Editor etapp 0: spik ([PR #18](https://github.com/maizlow/asyncua-dashboard/pull/18))
- [x] react-grid-layout v2 i den skalade canvasen: egen positionsstrategi klarar dra, storlek, kollision och gränser i alla testade fönsterstorlekar ([spikes/editor-rgl](spikes/editor-rgl/README.md))
- [x] Typsnittsmått uppmätta, Puck förkastat för rutnätet

### Editor etapp 1: layoutdokument och renderare ([PR #19](https://github.com/maizlow/asyncua-dashboard/pull/19))
- [x] Layoutdokument (`schema_version: 2`): anslutningar (PLC:er), displayer med egen header-yta och skärmar med element på ett fast rutnät 24 × 12; exempel med två PLC:er och två displayer
- [x] Databasen är källan: versioner i `layout_versions`, `dashboard.yaml` importeras första gången och sedan bara när filen ändrats (`LAYOUT_YAML_IMPORT`); `python -m backend.layout_store list|show|restore`
- [x] `GET /api/layout?display=`, `GET /api/displays`, `layout_changed` laddar om TV:n; migrering v1 → v2 i backend och frontend mot gemensamma fixturer
- [x] TV:n ser likadan ut (samma mått på alla element före och efter); header från dokumentet (logotyp, klocka, text, skärmtitel)

### Editor etapp 2a: flera PLC:er per display i modellen ([PR #20](https://github.com/maizlow/asyncua-dashboard/pull/20))
- [x] `connections` är en gemensam pool, displayer läser flera PLC:er och delar dem (taggar `plc2.OEE` eller korta med `default_connection`), skärmväxlingen och inbyggda skärmar anger sin anslutning; validering med rad och nyckel; äldre versioner läses
- [x] Prenumerationsplan med en klient per PLC och en prenumeration per nod (`subscription_plan`), värden per display (`display_keys`); WebSocket-meddelanden bär `connection`, TV:n håller isär PLC:erna och visar `–` och ⚠ när en PLC tappar kontakten (`connection_status`)
- [x] Headern har bara logotyp, klocka och logotyp (`left`/`right`: `customer`, `vendor` eller `none`)
- [x] `LAYOUT_YAML_IMPORT=auto` importerar en ändrad `dashboard.yaml` bara tills editorn publicerat; `always` och `off`

### Editor etapp 2b: inloggning och editorns skal ([PR #23](https://github.com/maizlow/asyncua-dashboard/pull/23))
- [x] Två lokala konton i SQLite (argon2id), `python -m backend.users add|passwd|list|remove`, ingen registreringssida
- [x] `/api/editor/login|logout|session|document`: sessionskaka (`HttpOnly`, `SameSite=Strict`), `X-Editor`-huvud mot CSRF, spärr efter 5 fel
- [x] Editorn på `/editor/` (egen sida i Vite-bygget): inloggning, val av display, skärmlista med nummer, typ och PLC, förhandsvisning i TV-skala med simulerade värden
- [x] Demo-editorn på Pages utan inloggning och backend, med påhittade nod-id

### Editor etapp 2c: duken ([PR #24](https://github.com/maizlow/asyncua-dashboard/pull/24))
- [x] Duken i TV-skala med react-grid-layout och spikens positionsstrategi: dra, ändra storlek, inga överlapp, stopp vid kanterna, samma pixlar som TV:n
- [x] Palett med dagens fem elementtyper (dra in eller klicka), nya skärmar: rutnät eller inbyggd skärm (helskärm, med PLC)
- [x] Skärmar: lägg till, duplicera, numrera om (ActiveScreenNr, dubbletter spärras), flytta upp/ned, ta bort; logotyper och standard-PLC per display
- [x] Ångra/gör om, kopiera/klistra in/duplicera (även mellan skärmar och displayer), pilar flyttar och Shift+pilar ändrar storlek
- [x] Playwright-test i CI (dra, storlek, krockar, ångra vid tre fönsterstorlekar, kopiera, tangentbord, skärmnummer)

### Editor etapp 2d: egenskaper, taggar och läsbarhet ([PR #25](https://github.com/maizlow/asyncua-dashboard/pull/25))
- [x] Egenskapspanel genererad från elementschemat (`elements.ts`), fel vid fältet; textfält ångras som ett steg
- [x] Taggväljare grupperad per PLC (kort namn för standard-PLC:n), ny tagg från nod-id
- [x] Validering i webbläsaren som speglar backend (okänd PLC/tagg med förslag, storlek, överlapp, tillstånd, inbyggda skärmars taggar); lista med fel och varningar
- [x] Läsbarhet live: skärmen mäts utanför bild med värsta fallets värden och uppmätt versalhöjd; under 37 px eller värde som inte får plats = fel, hjälte under 90 px = varning

### Editor etapp 2e: publicera och versioner ([PR #26](https://github.com/maizlow/asyncua-dashboard/pull/26))
- [x] Utkastet sparas automatiskt (servern, eller `localStorage` i demon) och minns vilken version det bygger på
- [x] Publicera: kontroll av hela dokumentet (regler, läsbarhet på alla skärmar med värsta fallets värden, vad driften klarar); fel spärrar, kommentar per version, 409 vid krock
- [x] Versioner: lista, öppna en äldre som utkast och publicera den som ny version, YAML-export av utkast och versioner
- [x] Demo-editorn på Pages med versioner i `localStorage`; TV-demon i samma webbläsare visar den publicerade demoversionen
- [x] Playwright-test för publicera, återställa, utkast efter omladdning, spärr vid fel och export

### Editor etapp 3a: bläddra i PLC:n, API ([PR #27](https://github.com/maizlow/asyncua-dashboard/pull/27))
- [x] `GET /api/editor/opcua/{anslutning}/browse|read|search` bakom editorns inloggning, bara läsning (Browse/Read, aldrig skrivning eller prenumeration)
- [x] Egen kortlivad session per PLC (stängs efter 60 s), ett anrop i taget, tidsgränser, tak för barn och sökning, gräns per användare
- [x] Datatyp, åtkomst, array och om noden har barn; tydliga fel på svenska när PLC:n inte nås
- [x] Test mot en asyncua-testserver byggd som en S7-1500 (bläddra, läsa, sök, tak, ej nåbar PLC, bara läsning)

### Editor etapp 3b: träd i taggväljaren ([PR #28](https://github.com/maizlow/asyncua-dashboard/pull/28))
- [x] "Bläddra i PLC:n" i taggväljaren: träd som läses nivå för nivå, filter av det inlästa och sök i hela PLC:n
- [x] Vald variabel: datatyp, åtkomst och värdet just nu; varning när datatypen inte passar elementet (text som procent, bool som räknare)
- [x] Tagg från nod med namnförslag från browse name, unikt per PLC; befintlig tagg återanvänds; manuellt nod-id kvar
- [x] Demon på Pages: påhittad S7-1500 per PLC i webbläsaren, inga nätverksanrop
- [x] Enhetstest (typkontroll, namnförslag, demons adressrymd) och Playwright (bläddra, sök, välj, varna, tangenter)

## Nästa

### Docker för drift på Fitlet3 (Linux, x86-64)
- [ ] Multi-stage Docker-build där FastAPI serverar den byggda frontenden
- [ ] `docker-compose.yml` där `.env`, certifikat och databas monteras in
- [ ] Image publiceras till GHCR vid merge till `main`
- [ ] Uppdatering via `docker compose pull && docker compose up -d`
- [ ] Ev. kioskläge i webbläsaren vid uppstart

## Planerat
- [ ] Verktyg för att designa dashboards (editor med dra och släpp, OPC UA-bläddring, tema och logotyper per kund): plan i [docs/EDITOR-PLAN.md](docs/EDITOR-PLAN.md) (beslutad; etapp 0–1 klara)
- [ ] Koppla nya OEE-taggar till riktiga nod-id i PLC:n (`GoodCount`, `RejectCount`, `ShiftTarget`, `OeeTarget`, `PlannedTime`, `ShiftTeam` i `dashboard.yaml`)
- [ ] Raster på kända klockslag i tillgänglighetsberäkningen (idag `PlannedTime` pro rata, eller hela förflutna skifttiden)
- [ ] Flytta hårdkodade värden till konfig:
  - [ ] `ProductionState == 2` = kör
  - [ ] CORS-lista
- [ ] Statusindikator för PLC- och WebSocket-anslutning
- [ ] Frontendtester (t.ex. Vitest) i CI
- [ ] Stöd för flera OPC UA-servrar/linjer

Skärmnummer (`ActiveScreenNr`) styrs av `screens:` i `dashboard.yaml`; exempelfilen: 1 = Larm, 2 = Dashboard, 3 = Skiftmönster, 4 = OEE, 5 = 7 dagar, 6 = Highscore.

## Drift / att göra utanför koden
- [ ] Byt lösenord för OPC-användaren `iot_user`
- [ ] Nytt klientcertifikat och sluta lita på det gamla i S7-1500
- [ ] Ev. be GitHub Support rensa gamla cachade commits

## Strukna
Passar inte en ren visningsdashboard:
- ~~Alarmkvittering~~
- ~~Trendskärm / CSV-export~~

## Idéer
<!-- Lägg nya förslag här som "- [ ] ..." -->
