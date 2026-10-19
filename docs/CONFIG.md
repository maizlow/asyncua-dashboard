# Konfiguration: `dashboard.yaml`

Allt som visas på TV:n – vilka PLC-taggar som läses, vilka skärmar som finns och vilka objekt (rutor) varje skärm har –
står i **`dashboard.yaml`** i projektets rotmapp. Du behöver inte ändra någon kod för att lägga till, ta bort eller koppla
om ett objekt.

Lösenord och certifikat står **aldrig** i YAML-filen utan i `.env` (se `.env.example`).

Hur de beräknade värdena räknas fram (OEE, mål, prognos, kassation, stopp, trend, färger) står i [BERAKNINGAR.md](BERAKNINGAR.md).

- [Var layouten sparas: databasen](#var-layouten-sparas-databasen)
- [Layoutdokumentet (schema_version 2)](#layoutdokumentet-schema_version-2)
- [Filens delar](#filens-delar)
- [Taggar](#taggar-tags)
- [Skärmar](#skärmar-screens)
- [Objekt](#objekt-items)
- [Lägga till ett nytt dashboard-objekt](#lägga-till-ett-nytt-dashboard-objekt)
- [Felmeddelanden](#felmeddelanden)
- [Gränser och varför](#gränser-och-varför)

## Var layouten sparas: databasen

**Databasen** (`data.db`, tabellen `layout_versions`) är den enda källan för vad TV:n visar. `dashboard.yaml` är
startpunkten, och fram till att editorn används är filen också det enkla sättet att ändra layouten:

1. **Första starten:** backend läser `dashboard.yaml`, kontrollerar den och sparar den som **version 1** (publicerad).
2. **Senare starter, före editorn:** filen importeras igen **bara om den har ändrats** sedan den senaste importen. Backend
   jämför filens sha256 med den som sparades vid importen. Den ändrade filen blir en ny version och publiceras.
3. **Efter första publiceringen i editorn:** en ändrad fil importeras **inte** längre. Loggen säger att filen har ändrats.
   Layouten ändras då i editorn (som också kan importera en fil). Det skyddar editorns arbete mot en gammal fil vid en
   omstart.
4. **Ogiltig ändrad fil:** backend startar inte och loggen visar felen. Rätta filen eller ta tillbaka den gamla.
5. **Inget raderas:** varje import eller publicering är en ny version. Versionerna gallras inte med mätdatan
   (`RETENTION_DAYS`).

| `.env` | Betyder |
|---|---|
| `LAYOUT_YAML_IMPORT=auto` (standard) | Importera en ändrad `dashboard.yaml` tills editorn har publicerat första gången, enligt ovan. |
| `LAYOUT_YAML_IMPORT=always` | Importera en ändrad fil även efter att editorn har publicerat. Filen vinner över editorn vid omstart, så använd det bara tillfälligt. |
| `LAYOUT_YAML_IMPORT=off` | Läs aldrig filen igen efter första importen. |

Versionerna hanteras från projektets rotmapp, på Fitlet3:

```bash
python -m backend.layout_store list        # versioner, * = publicerad (tid i datorns tidszon)
python -m backend.layout_store show 3      # version 3 som YAML (schema_version 2)
python -m backend.layout_store restore 3   # publicera version 3 igen som en ny version, starta sedan om backend
```

Backend läser layouten vid start. En publicering från editorn laddar om TV:n direkt (`layout_changed`), men nya eller
ändrade taggar kräver omstart av backend tills prenumerationerna laddas om live (etapp 4).

## Editorn: konton och inloggning

Editorn finns på **`/editor/`**, bredvid TV-vyn (`/`), t.ex. `http://fitlet3:5173/editor/`. Vite proxar `/api` till
backend. Den gör bara ändringar i layouten: den skriver aldrig till PLC:n, och värdena i förhandsvisningen är simulerade.

**Konton (två, inga roller, ingen registreringssida):** de skapas på servern, från projektets rotmapp:

```bash
python -m backend.users add johan       # frågar efter lösenordet två gånger (minst 10 tecken)
python -m backend.users passwd johan    # byt lösenord (loggar ut alla sessioner)
python -m backend.users list
python -m backend.users remove johan
```

- **Lösenord:** lagras som argon2id-hash i `data.db`, tabellen `editor_users`. Inget lagras i klartext.
- **Session:** gäller i 12 timmar. Kakan `aud_editor` är `HttpOnly`, har `SameSite=Strict` och gäller bara för
  `/api/editor`. Databasen sparar bara sessionens sha256.
- **Skydd:** varje ändrande anrop kräver huvudet `X-Editor: 1`, så en annan webbplats kan inte skicka formulär i ditt
  namn. Efter 5 felaktiga inloggningar från samma adress spärras inloggningen i 5 minuter.
- **Nätverket:** editorn är tänkt för fabriksnätet. Exponera den inte mot internet.

**Demo-editorn** på GitHub Pages
([maizlow.github.io/asyncua-dashboard/editor/](https://maizlow.github.io/asyncua-dashboard/editor/)):

- **Ingen inloggning och ingen backend:** den gör inga anrop alls och kan aldrig nå en PLC.
- **Exempeldata:** den bygger på exempeldokumenten med påhittade nod-id och adresser. Välj dokument med `?layout=multi`
  eller `?layout=stress`.
- **Lagring:** ändringar sparas bara i webbläsaren (`localStorage`).

### Använda editorn

- **Duken:** samma 3840×2160 som TV:n, med header och rutnätet 24 × 12. Elementen visas som på TV:n, med simulerade värden.
- **Element:**
  - **Lägga till:** dra in från paletten (Tal, Procent, Räknare, Tid, Status), eller klicka för att lägga det på första
    lediga plats. Ett nytt element är 12 × 4 rutor, det minsta som är läsbart på 8–10 m.
  - **Flytta och ändra storlek:** dra elementet för att flytta det, och hörnet nere till höger för att ändra storleken.
  - **Krockar:** element kan aldrig överlappa. Om du drar mot ett annat element stannar ditt på sista lediga plats.
- **Skärmar:**
  - **Ny skärm:** ett rutnät eller en inbyggd skärm (Larm, Skiftmönster, OEE, 7 dagar, Highscore). En inbyggd skärm fyller
    hela ytan och visar en vald PLC (linje).
  - **Numret är det `ActiveScreenNr` som PLC:n skickar.** Det kan bytas, men dubbletter spärras. Flytta upp/ned byter
    nummer med grannen.
  - Skärmar kan också dupliceras och tas bort.
- **Egenskaper:** välj ett element för att ändra etikett, tagg, enhet, decimaler, mål, trend, gränser, bättre-riktning,
  färg och tillstånd (status). Panelen visar bara de egenskaper elementtypen har. Fel visas direkt vid fältet.
- **Taggväljaren:**
  - Taggarna är grupperade per PLC. Displayens standard-PLC skrivs kort (`OEE`) och andra PLC:er med anslutningen
    (`plc2.GlazeLevel`).
  - **Ny tagg från nod-id** lägger till ett namn och ett nod-id på en PLC. Backend läser nya taggar efter omstart, tills
    etapp 4.
- **Läsbarhet:** varje element mäts med värsta fallets värden, och resultatet visas på elementet och i panelen. Mätningen
  sker vid 1080p:
  - **Fel (✖), som spärrar publicering:** text under 37 px versalhöjd, eller ett värde som inte får plats.
  - **Varning (⚠):** värdet under 90 px.
  - Värsta fallet är 999 999 för räknare och mål, 100,0 % och femsiffriga negativa tal (eller taggens `demo`-intervall),
    den längsta statustexten och en vanlig trendändring.
  - Alla fel och varningar listas under duken, och ett klick väljer elementet.
- **Display:** logotyp till vänster och höger (kundens, ABECE eller ingen) och standard-PLC för korta taggnamn. Klockan
  sitter alltid i mitten.
- **Kortkommandon:**

  | Tangenter | Gör |
  |---|---|
  | Ctrl+Z / Ctrl+Y | ångra / gör om |
  | Ctrl+C / Ctrl+V / Ctrl+D | kopiera / klistra in / duplicera, även till en annan skärm eller display |
  | Delete | ta bort elementet |
  | pilar / Shift+pilar | flytta en ruta / ändra storlek en ruta |
  | Esc | avmarkera |

- **Kopior mellan displayer:** en kopia behåller sin PLC även om displayerna har olika standard-PLC. `OEE` från tv1 blir
  `plc1.OEE` på tv2.

### Spara och publicera

- **Utkastet sparas automatiskt** på servern en sekund efter varje ändring ("utkast sparat 14:02" i toppraden). Det
  finns ett utkast, som båda kontona delar. TV:n visar aldrig utkastet.
- **Publicera …** kontrollerar först hela dokumentet: reglerna, läsbarheten på alla rutnätsskärmar på alla displayer och
  det dagens backend inte kan köra (flera PLC:er eller displayer, till etapp 4). Fel måste rättas, ett klick på felet
  visar elementet. Varningar går att publicera. Skriv en kort kommentar om vad som ändrats.
- **Efter publicering** laddar TV:n om layouten inom några sekunder. **Nya eller ändrade taggar** (nod-id) läses först
  efter omstart av backend, och editorn säger till när det behövs.
- **Om någon annan har publicerat** sedan du började visar dialogen det, och du kan välja "Publicera ändå".
- **Versioner:** listan visar varje version med tid, vem och kommentar. **Öppna som utkast** läser in en äldre version,
  och när du publicerar den blir den en ny version (inget skrivs över). **YAML** laddar ner versionen.
- **Exportera YAML** laddar ner utkastet som `dashboard.yaml` (schema_version 2), som backup eller för att läsa in i en
  annan installation med `LAYOUT_YAML_IMPORT=always`.
- **Demo-editorn** (<https://maizlow.github.io/asyncua-dashboard/editor/>) sparar versioner och utkast bara i
  webbläsaren. TV-demon i samma webbläsare visar den publicerade demoversionen. **Återställ demo** tömmer lagringen.

## Layoutdokumentet (schema_version 2)

I databasen sparas layouten som ett **layoutdokument**:

- **`connections`** är en gemensam pool av PLC:er. Varje PLC har sin URL, sina larm och sina taggar (alias → nod-id).
- **`displays`** är TV:arna. En display kan läsa från **flera PLC:er**, och flera displayer kan läsa samma PLC. Exempel:
  TV1 läser PLC 1, 2 och 3, och TV2 läser PLC 2 och 3.
- **En anslutning per PLC:** backend öppnar en enda OPC UA-anslutning till varje PLC och prenumererar en gång per nod, hur
  många displayer som än visar den. Värdena skickas sedan ut till alla displayer som behöver dem.

`dashboard.yaml` i formatet längre ned (version 1) översätts automatiskt:

| `dashboard.yaml` (version 1) | Layoutdokument |
|---|---|
| `opc` + `tags` | anslutningen `plc1` (`url`, `alarms`, `tags`) |
| `opc.screen` | `displays → tv1 → screen` med `connection: plc1` |
| `screens` | displayen `tv1` med `default_connection: plc1`, så korta taggnamn fungerar som förut |
| grid-skärm med 1 objekt | ett element på hela rutnätet: `x: 0, y: 0, w: 24, h: 12` |
| grid-skärm med 2–6 objekt | 2 kolumner (`w: 12`) och 1–3 rader (`h: 12`, `6` eller `4`), i filens ordning |
| `type: alarms` / `shift` / `oee` / `week` / `highscore` | ett inbyggt element på hela rutnätet med `connection: plc1` |
| (saknas) | header: kundens logotyp till vänster, klockan i mitten, ABECE till höger (som tidigare) |

Varje skärm är ett fast **rutnät på 24 × 12 rutor** under header-ytan. Rutnätet ger exakt samma storlekar som tidigare,
så TV:n ser likadan ut. Ett element har:

- `id`;
- `kind`: `number`, `percent`, `counter`, `time`, `status` eller en inbyggd skärm;
- läge och storlek i rutor: `x`, `y`, `w`, `h`;
- samma egenskaper som ett objekt: `label`, `tag`, `unit` och så vidare.

```yaml
schema_version: 2
connections:                                   # gemensam pool, en per PLC
  plc1: { url: opc.tcp://192.168.0.1:4840, alarms: ns=3;i=1815, tags: { OEE: ns=3;s="DB"."oee" } }
  plc2: { url: opc.tcp://192.168.0.2:4840, tags: { Level: ns=3;s="DB"."level" } }
displays:
  tv1:
    default_connection: plc1                   # korta taggnamn: OEE betyder plc1.OEE
    screen: { connection: plc1, active: …, requested: … }   # skärmväxlingen styrs av en PLC
    header: { left: customer, right: vendor }  # customer | vendor | none; klockan är alltid i mitten
    screens:
      2:
        title: Dashboard
        items:
          - { id: oee, kind: percent, x: 0, y: 0, w: 12, h: 12, label: OEE, tag: OEE, thresholds: [75, 85] }
          - { id: niva, kind: number, x: 12, y: 0, w: 12, h: 12, label: Nivå, tag: plc2.Level }
      4:
        items:
          - { id: oee-skarm, kind: oee, connection: plc1, x: 0, y: 0, w: 24, h: 12 }   # inbyggd: vilken linje
```

| Nyckel | Betyder |
|---|---|
| `tag`, `target` | `plc2.Level` = taggen `Level` i anslutningen `plc2`. Ett kort namn (`OEE`) gäller displayens `default_connection`. |
| `default_connection` | Valfri. Standard är den enda anslutningen om det bara finns en. Med flera PLC:er och ingen standard måste varje tagg skrivas med anslutning. |
| `screen.connection` | PLC:n som styr displayens skärmväxling (`ActiveScreenNr`). |
| `connection` (inbyggda skärmar) | Krävs. Linjen (PLC:n) vars skiftlogg, OEE, 7 dagar, highscore eller larm visas. Historiken sparas per anslutning. |
| `header.left`, `header.right` | `customer` (kundens logotyp), `vendor` (ABECE) eller `none` (tomt). Klockan sitter alltid i mitten. |

**Ett fullständigt exempel** med tre PLC:er som delas av två displayer finns i
[`docs/examples/flera-displayer.yaml`](examples/flera-displayer.yaml). JSON-schema för VS Code finns i
[`docs/layout.schema.json`](layout.schema.json).

```bash
python -m backend.layout_doc                       # kontrollera dashboard.yaml (eller en v2-fil: ange sökvägen)
python -m backend.layout_doc --migrate             # dashboard.yaml översatt till ett layoutdokument (YAML)
python -m backend.layout_doc --view                # det GET /api/layout skickar till TV:n
```

Regler utöver dem för objekten:

- **Minsta storlek:** ett värdeelement är minst 12 × 4 rutor (en halv bredd, en tredjedel av höjden). Det är den minsta
  storlek där 290 px-siffrorna har plats, även `00:00:00` och sexsiffriga tal.
- **Inbyggda skärmar:** de täcker hela rutnätet och står ensamma tills mindre varianter kommer i etapp 6. Larm är alltid
  helskärm.
- **Placering:** element får inte överlappa eller gå utanför rutnätet, och `id` måste vara unikt.
- **Anslutningar och taggar:** varje anslutning (i `tag`, `default_connection`, `screen` och på inbyggda skärmar) måste
  finnas under `connections`. Taggen måste finnas i den anslutningen. Felen anger rad och nyckel, t.ex.
  `items → 2 → tag: okänd tagg 'Levle' i plc2 (menade du 'Level'?)`.
- **Driften stöder än så länge en anslutning och en display.** Ett dokument med fler godkänns av
  `python -m backend.layout_doc` (med "Obs"), men backend vägrar att publicera det tills etapp 4. Etapp 4 kör en
  OPC-klient per anslutning, filtrerar WebSocket-meddelandena per display och sparar historiken per anslutning.

**Displayer och PLC-status:**
- **Välja display:** TV:n väljer display med `?display=tv2` i adressen (standard: den första). `GET /api/displays` listar
  dem.
- **Värdenas nycklar:** värdena skickas med anslutningens id (`data_update` med `connection`), och TV:n håller isär
  PLC:erna (`plc1.OEE`).
- **En PLC tappar kontakten** (`connection_status`): bara de element som är kopplade till den visar `–` och ⚠. Övriga
  fortsätter att uppdateras. I demon visar `?layout=multi&display=tv1&screen=2&down=plc2` hur det ser ut.

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
| `grid` (standard) | 1–6 egna objekt (`items`). 1 objekt = hel bredd, annars 2 kolumner och upp till 3 rader (i layoutdokumentet: rutor i rutnätet 24 × 12, se ovan). |
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

**5. Driftsätt på Fitlet3.**

1. Kopiera `dashboard.yaml` till projektmappen på Fitlet3, eller kör `git pull` om du har checkat in den.
2. Kontrollera filen där med `python -m backend.dashboard_config`.
3. Starta om backend-tjänsten. Den ändrade filen importeras då som en ny version i databasen
   (se [Var layouten sparas](#var-layouten-sparas-databasen)).

Frontenden behöver inte byggas om. Den hämtar layouten (`GET /api/layout`) varje gång den ansluter. Är filen ogiltig
startar inte backend, och loggen visar felen. Vill du tillbaka till föregående layout: `python -m backend.layout_store list`
och sedan `restore N`.

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
