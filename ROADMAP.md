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

## Nästa

### Docker för drift på Fitlet3 (Linux, x86-64)
- [ ] Multi-stage Docker-build där FastAPI serverar den byggda frontenden
- [ ] `docker-compose.yml` där `.env`, certifikat och databas monteras in
- [ ] Image publiceras till GHCR vid merge till `main`
- [ ] Uppdatering via `docker compose pull && docker compose up -d`
- [ ] Ev. kioskläge i webbläsaren vid uppstart

## Planerat
- [ ] Konfiguration i YAML (taggar/nod-id, namn, enhet, mål, korttyp) – skärmarna genereras från filen
- [ ] Flytta hårdkodade värden till konfig:
  - [ ] Siemens namespace `ns=3` / alarmnod `ns=3;i=1815`
  - [ ] `ProductionState == 2` = kör
  - [ ] Fasta delta-värden i `DashboardScreen`
  - [ ] CORS-lista
- [ ] Statusindikator för PLC- och WebSocket-anslutning
- [ ] Frontendtester (t.ex. Vitest) i CI
- [ ] Stöd för flera OPC UA-servrar/linjer

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
