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
- [x] Demo-parameter `?count=999999` och motsvarande fall i `check:fit` (alla 5 upplösningar)

## Nästa

### Docker för drift på Fitlet3 (Linux, x86-64)
- [ ] Multi-stage Docker-build där FastAPI serverar den byggda frontenden
- [ ] `docker-compose.yml` där `.env`, certifikat och databas monteras in
- [ ] Image publiceras till GHCR vid merge till `main`
- [ ] Uppdatering via `docker compose pull && docker compose up -d`
- [ ] Ev. kioskläge i webbläsaren vid uppstart

## Planerat
- [ ] Koppla nya OEE-taggar till riktiga nod-id i PLC:n (`GoodCount`, `RejectCount` i `backend/config.py`)
- [ ] Planerade raster/stopp i tillgänglighetsberäkningen (idag = hela förflutna skifttiden)
- [ ] Konfiguration i YAML (taggar/nod-id, namn, enhet, mål, korttyp) – skärmarna genereras från filen
- [ ] Flytta hårdkodade värden till konfig:
  - [ ] Siemens namespace `ns=3` / alarmnod `ns=3;i=1815`
  - [ ] `ProductionState == 2` = kör
  - [ ] CORS-lista
- [ ] Statusindikator för PLC- och WebSocket-anslutning
- [ ] Frontendtester (t.ex. Vitest) i CI
- [ ] Stöd för flera OPC UA-servrar/linjer

Skärmnummer (`ActiveScreenNr`): 1 = Larm, 2 = Dashboard, 3 = Skiftmönster, 4 = OEE.

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
- [ ] Skärm med körtids-highscores – varje rad visar Körd tid, Skiftlag och Datumstämpel
