# Konfiguration: `dashboard.yaml`

Allt som visas på TV:n – vilka PLC-taggar som läses, vilka skärmar som finns och vilka objekt (rutor) varje skärm har –
står i **`dashboard.yaml`** i projektets rotmapp. Du behöver inte ändra någon kod för att lägga till, ta bort eller koppla
om ett objekt.

Lösenord och certifikat står **aldrig** i YAML-filen utan i `.env` (se `.env.example`).

Hur de beräknade värdena räknas fram (OEE, mål, prognos, kassation, stopp, trend, färger) står i [BERAKNINGAR.md](BERAKNINGAR.md).

- [Filens delar](#filens-delar)
- [Taggar](#taggar-tags)
- [Skärmar](#skärmar-screens)
- [Objekt](#objekt-items)
- [Lägga till ett nytt dashboard-objekt](#lägga-till-ett-nytt-dashboard-objekt)
- [Felmeddelanden](#felmeddelanden)
- [Gränser och varför](#gränser-och-varför)

## Filens delar

```yaml
opc:            # anslutning och fasta noder
tags:           # PLC-taggar: namn -> nod-id (definieras en gång)
screens:        # skärmar: nummer -> typ och objekt
```

### `opc`

| Nyckel | Krävs | Beskrivning |
|---|---|---|
| `url` | nej | `opc.tcp://…`. `OPC_ENDPOINT_URL` i `.env` vinner om den är satt. |
| `alarms` | nej | Program_Alarm-objektet, t.ex. `ns=3;i=1815`. Tomt = inga larm. |
| `screen.active` | ja | Nod för `ActiveScreenNr` (backend skriver tillbaka den skärm som visas). |
| `screen.requested` | ja | Nod för `RequestedScreenNr` (PLC:n väljer skärm). |

PLC:n styr alltid vilken skärm som visas. Dashboarden är bara för visning; den enda skrivningen är kvittensen av aktiv skärm.

## Taggar (`tags`)

En tagg är ett namn för en PLC-variabel. Namnet skriver du en gång här och använder sedan i objekten.

```yaml
tags:
  OEE: ns=3;s="DB Production TV"."dashboardData"."oee"                         # kort form
  CurrentRuntime: { node: ns=3;s="DB Production TV"."dashboardData"."runtime", type: time }
  GoodCount: ""                                                                # inte kopplad än
```

| Nyckel | Standard | Beskrivning |
|---|---|---|
| `node` | `""` | OPC UA nod-id. Kopiera det från TIA Portal/UaExpert. **Tomt = inte kopplad än:** taggen hoppas över, resten fungerar och objektet visar `–`. |
| `type` | `auto` | `time` = S7 `Time_Of_Day` (ms), visas som `hh:mm:ss`. Allt annat (Int, DInt, Real, Bool…) är `auto`. |
| `demo` | – | Bara demoläget: fast värde (`demo: 42`) eller intervall (`demo: [60, 99]`). |

**Citattecken:** nod-id med `"DB namn"."variabel"` fungerar utan extra citattecken. Innehåller nod-id:t `: ` (kolon + mellanslag)
eller ` #`, skriv det inom enkla citattecken: `'ns=3;s="DB: Linje 1"."oee"'`.

**Taggnamn:** bokstäver/siffror utan mellanslag, t.ex. `Temp_Zon4`. Namnen nedan är **reserverade** – de inbyggda skärmarna och
OEE-beräkningen läser dem, så byt inte namn på dem:

| Namn | Används av | Krävs |
|---|---|---|
| `ProductionState` | Skift/OEE (2 = kör) | ja, för `shift` och `oee` |
| `ShiftStart`, `ShiftEnd` | Skift/OEE (skiftets tider, `type: time`) | ja, för `shift` och `oee` |
| `TPM` | OEE (takt, st/min) | ja, för `oee` |
| `GoodCount` | OEE (godkända) | nej |
| `ProductionCount` | OEE: total produktion **inklusive kassation**, används om `GoodCount` saknas (godkända = `ProductionCount` − `RejectCount`) | nej |
| `RejectCount` | OEE (kassation, kvalitet) | nej – utan den visar Kvalitet, OEE och Kassation `–` |
| `ShiftTarget` | OEE: skiftmål i st för hela skiftet (Mål hittills räknas pro rata) | nej – utan den visar målen `–` och inget PÅ/UNDER MÅL |
| `OeeTarget` | OEE: OEE-mål i % | nej – utan den gäller 85 % |
| `PlannedTime` | OEE och skiftloggen: planerad tid i **minuter** för hela skiftet, exklusive raster | nej – utan den är hela skifttiden planerad |
| `ShiftTeam` | Skiftloggen: skiftlag (text eller nummer) | nej – utan den visas `–` |

`ShiftStart`, `ShiftEnd`, `ShiftTarget`, `OeeTarget`, `PlannedTime` och `ShiftTeam` beskriver **pågående** skift. Backend sparar en
rad per skift (tabellen `shifts`, gallras inte) och hanterar att taggarna kommer i olika OPC-ramar: efter ett skiftbyte väntar den
`SHIFT_SETTLE_S` sekunder (`.env`, standard 10) innan det nya skiftets värden sparas. Se
[BERAKNINGAR.md → Skiftlogg](BERAKNINGAR.md#skiftlogg-tabellen-shifts).

Övriga namn i exempelfilen (`TargetCount`, `ProductionDelta`, `OEE`, `CurrentRuntime`, `AccumulatedStoptime`) är vanliga taggar
som bara används av objekten på Dashboard-skärmen; dem kan du byta namn på.

Vad varje reserverad tagg används till i formlerna: [BERAKNINGAR.md → Indata](BERAKNINGAR.md#indata).

## Skärmar (`screens`)

Numret är det värde PLC:n sätter i `ActiveScreenNr` (1–99).

```yaml
screens:
  1: { type: alarms, title: Larm }
  2:
    title: Dashboard
    items:
      - { label: Produktion, tag: ProductionCount, type: counter, unit: st, target: TargetCount }
  3: { type: shift, title: Skiftmönster }
  4: { type: oee, title: OEE }
```

| `type` | Innehåll |
|---|---|
| `grid` (standard) | 1–6 egna objekt (`items`). 1 objekt = hel bredd, annars 2 kolumner och upp till 3 rader. |
| `alarms` | Aktiva larm från Program_Alarm (inga `items`). |
| `shift` | Skiftmönstret (kräver taggarna `ShiftStart`, `ShiftEnd`, `ProductionState`). |
| `oee` | OEE-skärmen (kräver dessutom `TPM` och en av taggarna `GoodCount`/`ProductionCount` under `tags`; saknar taggarna värde, liksom `RejectCount` och `ShiftTarget`, visar respektive värde `–`). |
| `highscore` | Körtids-highscore: de fem längsta körningarna utan stopp (Körd tid, Skiftlag, Datumstämpel) och pågående körning mot rekordet (kräver `ProductionState`; `ShiftTeam` valfri). `HIGHSCORE_MIN_STOP_S` i `.env` (standard 0): kortare stopp avslutar inte en körning. Se [BERAKNINGAR.md](BERAKNINGAR.md#skärm-highscore-type-highscore). |
| `week` | Idag + 6 dagar bakåt från skiftloggen (dagar före skiftloggen: från historiken) i databasen: OEE %, godkända per dag och dagsmål (kräver `ShiftStart`, `ShiftEnd`, `ProductionState` och `GoodCount` eller `ProductionCount`). Formler: [BERAKNINGAR.md](BERAKNINGAR.md#skärm-7-dagar-type-week). |

`title` är valfri (max 40 tecken) och är till för dig; grid-skärmar visar ingen rubrik.
Okänt skärmnummer från PLC:n visar första grid-skärmen.

## Objekt (`items`)

Varje objekt är en ruta på en grid-skärm. Bara `label` och `tag` krävs.

| Nyckel | Standard | Beskrivning |
|---|---|---|
| `label` | – | Rubrik på svenska, max 20 tecken. Visas med versaler. |
| `tag` | – | Taggnamn från `tags`. |
| `type` | `number` | `number` – tal · `percent` – procent (enhet `%`) · `counter` – heltal (räknare) · `time` – `hh:mm:ss` · `status` – text och färg från `states` |
| `unit` | – | Enhet efter värdet, max 6 tecken, t.ex. `st`, `TPM`, `°C`. Med `trend`/`target`: håll den ≤ 4 tecken, annars kan siffran krympa ([se nedan](#storlek-på-siffrorna-automatisk-krympning)). |
| `decimals` | `percent` 1, `number` 1 om taggen är ett decimaltal annars 0 | Ignoreras för `counter` (alltid 0). Fast antal decimaler, 0–3, med decimalkomma – även när decimalerna är 0 (`82,0 %`, `140,0`). Sätt `decimals` för decimaltal (Real), så visas kommat redan från första värdet. |
| `target` | – | Mål: ett taggnamn (`TargetCount`) eller ett tal (`5000`). Visar "Mål" + framdriftsstapel. |
| `trend` | `false` | Visar senaste förändringen stort med samma decimaler som värdet (▲ 0,6 / ● 0,0; räknare ▼ 1). |
| `color` | vit | Fast färg: `white`, `green`, `amber`, `red`, `grey`. |
| `thresholds` | – | `[lägre, övre]`. Färgar värdet och visar ▼/▲ när det inte är bra (se nedan). |
| `better` | `high` | `high` = högre är bättre (OEE), `low` = lägre är bättre (kassation, temperatur). |
| `states` | – | Bara `type: status`: PLC-värde → `{ text, color }`, text max 10 tecken. |

**Gränsvärden:** jämförs med värdet avrundat som det visas (84,96 med 1 decimal = `85,0` = övre gränsen 85).
Med `better: high` blir värdet grönt vid ≥ övre, gult vid ≥ lägre och annars rött (+ ▼ i rubriken).
Med `better: low` blir det grönt vid ≤ lägre, gult vid ≤ övre och annars rött (+ ▲). `thresholds` går före `color`.
`time` och `status` har inte `target`, `trend` eller `thresholds`.

Exempel:

```yaml
- { label: OEE, tag: OEE, type: percent, trend: true, thresholds: [75, 85] }
- { label: Kassation, tag: Scrap, type: percent, decimals: 1, thresholds: [2, 3], better: low }
- { label: Total stopptid, tag: AccumulatedStoptime, type: time, color: red }
- label: Linjeläge
  tag: ProductionState
  type: status
  states:
    1: { text: STOPP, color: red }
    2: { text: KÖR, color: green }
```

## Lägga till ett nytt dashboard-objekt

Exempel: visa ugnstemperaturen `"DB Production TV"."dashboardData"."ovenTemp"` (Real, °C) på Dashboard-skärmen.

**1. Definiera taggen.** Hitta nod-id:t i TIA Portal (DB:n måste vara åtkomlig från OPC UA) eller i UaExpert och lägg till en rad under `tags:`

```yaml
tags:
  # …
  OvenTemp: ns=3;s="DB Production TV"."dashboardData"."ovenTemp"
```

**2. Lägg till objektet på skärmen.** Under rätt skärm i `screens:` (max 6 objekt per skärm – ta bort eller flytta ett annat om det är fullt):

```yaml
screens:
  2:
    items:
      # …
      - { label: Ugnstemperatur, tag: OvenTemp, unit: °C, decimals: 1, thresholds: [200, 230], better: low }   # 215,0 °C
```

Ta bort ett objekt: radera dess rad. Koppla om: ändra `tag:` eller taggens nod-id.

**3. Kontrollera filen.** Från projektets rotmapp:

```bash
python -m backend.dashboard_config
# OK: 4 skärmar, 7 objekt, 13 taggar
```

Är något fel skrivs fil, rad och nyckel ut, t.ex. `dashboard.yaml:41 screens → 2 → items → 6 → tag: okänd tagg 'OvnTemp' (menade du 'OvenTemp'?)`.
Rätta och kör igen tills det står `OK`. (VS Code med YAML-tillägget visar dessutom fel och förslag direkt via `docs/dashboard.schema.json`.)

**4. Förhandsgranska i demoläget** (ingen PLC behövs; värdet simuleras, eller sätt `demo: 215` på taggen):

```bash
cd frontend
VITE_DEMO=true npm run dev
# öppna http://localhost:5173/?screen=2
```

Kontrollera att rubriken får plats utan "…". Inför en pull request: `npm run check:fit` (se README) provar alla skärmar i fem upplösningar.

**5. Driftsätt på Fitlet3.** Kopiera `dashboard.yaml` till projektmappen på Fitlet3 (eller `git pull` om du har checkat in den),
kontrollera den där med `python -m backend.dashboard_config` och starta om backend-tjänsten. Frontenden behöver inte byggas om –
den hämtar layouten (`GET /api/layout`) varje gång den ansluter. Är filen ogiltig startar inte backend och loggen visar felen.

## Felmeddelanden

| Meddelande | Betyder |
|---|---|
| `saknas (obligatorisk)` | En nyckel som krävs fattas, t.ex. `label`. |
| `okänd nyckel 'lable' (menade du 'label'?)` | Felstavad eller ej tillåten nyckel. |
| `okänd tagg 'Cuont'` | `tag`/`target` pekar på ett namn som inte finns under `tags`. |
| `nyckeln 'OEE' finns redan (rad 12)` | Samma tagg eller skärm står två gånger. |
| `för lång text (28 tecken, max 20 …)` | Rubrik/enhet/status-text får inte plats på TV:n. |
| `en grid-skärm ska ha 1–6 objekt` | För många (eller inga) objekt. |
| `YAML-syntaxfel …` | Indrag, kolon eller citattecken fel på raden. |

Fel på enskilda nycklar visas först; regler mellan nycklar (okända taggar, antal objekt) kontrolleras när de är rättade.

## Gränser och varför

TV:n läses på 8–10 m. Gränserna garanterar att allt får plats utan att något flödar över eller scrollar, i alla upplösningar
(720p–4K och 21:9):

- **1–6 objekt per grid-skärm** i fast rutnät.
- **Rubrik ≤ 20 tecken, enhet ≤ 6, status-text ≤ 10.**

### Storlek på siffrorna (automatisk krympning)

- **Normalt** är värdet i varje ruta **290 px** på 4K-ytan, **≈ 97 px versalhöjd vid 1080p** – över målet 90 px.
- **Långa värden + långa enheter (upp till 6 tecken) + `trend`/`target`** får inte alltid plats i rutan. Då **krymper värdet
  automatiskt** så mycket som behövs – rubrik, enhet, trend och mål behåller sin storlek och ingenting flödar över.
- Krympningen går **ned till minst 120 px (≈ 40 px versalhöjd vid 1080p)**. Det är **under målet 90 px** och syns sämre på
  8–10 m, men aldrig under minimigränsen 37 px. Exempel ur `docs/examples/stress.yaml`: `-99999,9 mmmmmm` med trend ≈ 130 px.
- **Rekommendation:** håll enheten **≤ 4 tecken** (t.ex. `st`, `TPM`, `°C`, `m/s`) i objekt som har `trend` eller `target`.
  Med vanliga värden (≤ 6 siffror) och kort enhet behålls full storlek (290 px).
- Värsta fallet finns i `docs/examples/stress.yaml` och provas automatiskt i CI (`?layout=stress` i demoläget).
