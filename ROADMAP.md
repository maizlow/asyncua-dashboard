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

## Nästa

### Docker för drift på Fitlet3 (Linux, x86-64)
- [ ] Multi-stage Docker-build där FastAPI serverar den byggda frontenden
- [ ] `docker-compose.yml` där `.env`, certifikat och databas monteras in
- [ ] Image publiceras till GHCR vid merge till `main`
- [ ] Uppdatering via `docker compose pull && docker compose up -d`
- [ ] Ev. kioskläge i webbläsaren vid uppstart

## Planerat
- [ ] Verktyg för att designa dashboards (editor med dra och släpp, OPC UA-bläddring, tema och logotyper per kund): förslag i [docs/EDITOR-PLAN.md](docs/EDITOR-PLAN.md), väntar på granskning
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
