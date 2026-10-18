# Beräkningar: formler för alla värden på TV:n

Här står hur **varje beräknat värde** på dashboarden räknas fram: vilken skärm det syns på, formeln, vilka taggar
(från [`dashboard.yaml`](../dashboard.yaml)) och inställningar (`.env`) som används, enhet och avrundning, specialfall
och ett räkneexempel från takpannelinjen. Dokumentet beskriver **koden som den är**:

- **Backend** [`backend/opc/oee.py`](../backend/opc/oee.py) räknar OEE, mål, prognos, kassation, stopp och skifttid
  (`GET /api/oee` och WebSocket-meddelandet `oee_details`).
- **Backend** [`backend/opc/shift_logger.py`](../backend/opc/shift_logger.py) räknar skiftfönstret, kör-/stopptid och
  skiftmönstret per timme.
- **Frontend** räknar bara visningen: avrundning, trend (▲/▼), framdriftsstaplar, färger och ▲/▼/"UNDER MÅL"
  ([`ItemCard.tsx`](../frontend/src/components/ItemCard.tsx), [`OeeScreen.tsx`](../frontend/src/screens/OeeScreen.tsx),
  [`format.ts`](../frontend/src/lib/format.ts)).

Hur du konfigurerar taggar och objekt står i [CONFIG.md](CONFIG.md).

- [Indata](#indata)
- [Gemensamma begrepp](#gemensamma-begrepp)
- [Räkneexempel som används nedan](#räkneexempel-som-används-nedan)
- [Skärm OEE (`type: oee`)](#skärm-oee-type-oee)
- [Skärm Skiftmönster (`type: shift`)](#skärm-skiftmönster-type-shift)
- [Grid-skärmar, t.ex. Dashboard (`type: grid`)](#grid-skärmar-tex-dashboard-type-grid)
- [Skärm Larm (`type: alarms`)](#skärm-larm-type-alarms)
- [Beräknas men visas inte](#beräknas-men-visas-inte)
- [Att känna till](#att-känna-till)

## Indata

### Reserverade taggar

| Tagg | Betydelse i beräkningarna | Saknas (tomt nod-id / inget värde) |
|---|---|---|
| `ShiftStart`, `ShiftEnd` | Skiftets start- och sluttid (`type: time`, `hh:mm:ss`, lokal tid) | Inget skiftfönster: allt som beror på skiftet visar `–` |
| `ProductionState` | `2` = kör, **alla andra värden** = stopp. Varje ändring loggas med tidsstämpel (UTC) i `shift_log` | Ingen kör-/stopptid: Tillgänglighet, Prestanda, OEE visar `–` |
| `GoodCount` | Godkända pannor detta skift, $G$ | `ProductionCount` används i stället |
| `ProductionCount` | Används som $G$ när `GoodCount` inte har något värde | Om även den saknas: $G$ saknas |
| `RejectCount` | Kasserade pannor detta skift, $K$ | Totalt $N = G$ (se [Kvalitet](#kvalitet)) |
| `TPM` | Aktuell takt, st/min | Takt visar `–` |

Räknarna förutsätts vara **skifträknare** som PLC:n nollställer vid skiftstart (`ShiftStart`). Dashboarden nollställer
ingenting själv.

### Inställningar (`.env`)

| Inställning | Standard | Används till |
|---|---|---|
| `NOMINAL_RATE_TPM` | `140` | Nominell takt $R$ (st/min): mål, prognosens skala, prestanda, "av 140" |
| `OEE_INTERVAL_S` | `5` | Hur ofta OEE-skärmens värden räknas om och skickas (minst 1 s). Räknas också när en skärm ansluter och vid `GET /api/oee` |
| `TIMEZONE` | systemets zon | Tidszon för `ShiftStart`/`ShiftEnd` och skiftmönstrets timmar (t.ex. `Europe/Stockholm`) |
| `SNAPSHOT_INTERVAL_MS` | `10000` | Hur ofta hela ögonblicksbilden + historik (för trend) skickas om |

Skiftmönstret skickas var 30:e sekund (fast i koden).

### Visning: avrundning och "–"

- **Decimalkomma** och fast antal decimaler; på OEE-skärmen heltal med mellanslag som tusentalsavgränsare (`34 440`),
  på grid-skärmar utan avgränsare (`34440`).
- Saknat värde (`null`, ej tal, tomt nod-id) visas alltid som **`–`**.
- Färger och ▲/▼ jämförs mot det **oavrundade** värdet (se [Att känna till](#att-känna-till)).
- Decimaltal (Real) från PLC:n avrundas till 2 decimaler redan när de läses in i backend.

## Gemensamma begrepp

### Skiftfönster

`ShiftStart` och `ShiftEnd` är klockslag i `TIMEZONE`. Det **aktuella skiftet** är det senaste som har startat:

- Är sluttiden ≤ starttiden går skiftet över midnatt (t.ex. 18:00–06:00 eller 22:00–06:00).
  Kl. 02:00 är skiftet *i går 18:00 – i dag 06:00*.
- **Mellan två skift** (t.ex. kl. 07:00 med skiftet 22:00–06:00) visas det senast avslutade skiftet: förfluten tid = hela
  skiftet, kvar = 0.
- Skiftets längd är verklig tid, så ett skift över sommartidsomställningen är 1 h kortare/längre.

$$
T = t_\text{slut} - t_\text{start}, \qquad
t = \min\bigl(\max(0,\ t_\text{nu} - t_\text{start}),\ T\bigr), \qquad
t_\text{kvar} = T - t
$$

$T$ = skiftlängd, $t$ = förfluten skifttid (sekunder i koden). Planerade raster dras **inte** av: hela den förflutna tiden
räknas som planerad produktionstid.

### Körtid och stopp

Från `shift_log` byggs sammanhängande segment *kör* / *stopp* inom $[t_\text{start},\ \min(t_\text{slut}, t_\text{nu})]$.
Det tillstånd som gällde före skiftstart gäller från skiftstart.

$$
t_\text{kör} = \sum_{\text{segment med kör}} \Delta t, \qquad
n_\text{stopp} = \text{antal sammanhängande perioder utan kör}, \qquad
t_\text{stopp} = \sum_{\text{stopp}} \Delta t
$$

- Ett stopp som pågår just nu räknas (med tiden hittills).
- Ett stopp som pågick redan vid skiftstart räknas som ett stopp i detta skift, med tiden från skiftstart.
- Samma tillstånd flera gånger i rad (t.ex. efter återanslutning) slås ihop och ger inte fler stopp.

### Godkända, kassation och totalt

$$
G = \begin{cases} \texttt{GoodCount} & \text{om värde finns} \\ \texttt{ProductionCount} & \text{annars} \end{cases}
\qquad
K = \texttt{RejectCount}
\qquad
N = \begin{cases} G + K & \text{om } K \text{ finns} \\ G & \text{annars} \end{cases}
$$

## Räkneexempel som används nedan

Dagskift **06:00–14:00** (8 h), klockan är **11:00**, `NOMINAL_RATE_TPM = 140`.
Linjen har kört 267 min och stått 33 min fördelat på 6 stopp; totalt 35 140 pannor varav 700 kasserade; `TPM` = 138,6.

| Storhet | Värde |
|---|---|
| $T$ | 480 min |
| $t$ | 300 min |
| $t_\text{kvar}$ | 180 min |
| $t_\text{kör}$ | 267 min |
| $n_\text{stopp}$, $t_\text{stopp}$ | 6 st, 33 min |
| $N$, $K$, $G$ | 35 140, 700, 34 440 |

Nattskift används som andra exempel: **18:00–06:00** (12 h), klockan **02:00**.

## Skärm OEE (`type: oee`)

### OEE

**Visas:** stora siffran i rutan *OEE*, `82,0 %`.

$$
\mathrm{OEE} = A \cdot P \cdot Q
$$

- Enhet %, 1 decimal. `–` om någon av $A$, $P$, $Q$ saknas.
- När prestandan inte är kapad gäller $\mathrm{OEE} = \dfrac{G}{t_\text{min} \cdot R}$ = godkända / *Mål hittills*.
- **Färg:** grön ≥ 85 %, gul ≥ 75 %, annars röd (gränserna är fasta i `OeeScreen.tsx`).
- **"● PÅ MÅL"** (grön) vid OEE ≥ 85 %, annars **"▼ UNDER MÅL"** (gul text, även när siffran är röd). Ingen text när OEE saknas.

**Exempel:** $0{,}890 \cdot 0{,}940 \cdot 0{,}980 = 0{,}820$ → `82,0 %`, gul, "▼ UNDER MÅL" (85 % krävs för "PÅ MÅL").
Kontroll: $34\,440 / 42\,000 = 0{,}820$.

### Tillgänglighet

**Visas:** raden *Tillgänglighet* i rutan OEE.

$$
A = \min\left(1,\ \frac{t_\text{kör}}{t}\right)
$$

- Taggar: `ShiftStart`, `ShiftEnd`, `ProductionState`. %, 1 decimal, max 100 %.
- `–` om skiftfönster saknas, $t = 0$ (precis vid skiftstart) eller om det inte finns någon loggad tillståndsändring alls.
- Tid i skiftet innan första loggade tillståndet (om backend startade mitt i skiftet utan tidigare logg) räknas varken som
  kör eller stopp men ingår i $t$, vilket sänker $A$.

**Exempel:** $267 / 300 = 0{,}890$ → `89,0 %`.

### Prestanda

**Visas:** raden *Prestanda* i rutan OEE.

$$
P = \min\left(1,\ \frac{N}{\dfrac{t_\text{kör}}{60} \cdot R}\right)
$$

($t_\text{kör}$ i sekunder, $R$ = `NOMINAL_RATE_TPM` st/min.)

- Taggar: `GoodCount`/`ProductionCount`, `RejectCount`, `ProductionState`; inställning `NOMINAL_RATE_TPM`. %, 1 decimal, **max 100 %**.
- `–` om $N$ saknas, $t_\text{kör} = 0$ eller $R = 0$.
- Använder **totalt** antal (godkända + kassation), inte `TPM`.

**Exempel:** $35\,140 / (267 \cdot 140) = 35\,140 / 37\,380 = 0{,}940$ → `94,0 %`.

### Kvalitet

**Visas:** raden *Kvalitet* i rutan OEE.

$$
Q = \frac{G}{N}
$$

- %, 1 decimal. `–` om $G$ saknas eller $N = 0$.
- **Utan `RejectCount`** är $N = G$ och Kvalitet visar **100,0 %** (inte `–`).
- Kvalitet räknas även utan tillståndslogg, men **inte** utan skiftfönster (då är alla fyra `–`).

**Exempel:** $34\,440 / 35\,140 = 0{,}980$ → `98,0 %`.

### Färg på Tillgänglighet, Prestanda, Kvalitet

Samma för alla tre: grön ≥ 90 %, gul ≥ 80 %, annars röd med **▼** framför värdet. Stapeln under raden är värdet i %
(0–100 %) i samma färg; saknat värde = tom stapel.

**Exempel:** Tillgänglighet 89,0 % → gul, `▼ 89,0 %`; Prestanda 94,0 % och Kvalitet 98,0 % → gröna.

### Produktion: st godkända

**Visas:** stora siffran i rutan *Produktion*, `34 440 st godkända`.

$$
G \quad \text{(direkt från taggen, se ovan)}
$$

Heltal med tusentalsavgränsare. `–` om varken `GoodCount` eller `ProductionCount` har något värde.

### Mål hittills

**Visas:** *Mål hittills* i rutan Produktion (och vit markör i stapeln).

$$
M_\text{hittills} = \operatorname{round}\left(\frac{t}{60} \cdot R\right)
$$

- Inställning `NOMINAL_RATE_TPM`, taggar `ShiftStart`/`ShiftEnd`. Heltal (st). `–` utan skiftfönster.
- Målet är **nominell takt hela tiden** (100 % OEE): stopp, kassation och raster ingår inte.

**Exempel:** $300 \cdot 140 = 42\,000$. Nattskift kl. 02:00: $480 \cdot 140 = 67\,200$.

### Skiftmål

**Visas:** *Skiftmål* i rutan Produktion.

$$
M_\text{skift} = \operatorname{round}\left(\frac{T}{60} \cdot R\right)
$$

Heltal (st). `–` utan skiftfönster.

**Exempel:** 8 h: $480 \cdot 140 = 67\,200$. 12 h nattskift: $720 \cdot 140 = 100\,800$.

### Prognos

**Visas:** *Prognos* i rutan Produktion.

$$
\text{Prognos} = \operatorname{round}\left(\frac{G}{t} \cdot T\right)
$$

- Godkända vid skiftslut om nuvarande **medeltakt inklusive stopp** håller i sig. Heltal (st).
- `–` de **första 5 minuterna** av skiftet ($t < 300$ s), utan skiftfönster eller utan $G$.
- Mellan skift ($t = T$) blir prognosen lika med $G$.

**Exempel:** $34\,440 / 300 \cdot 480 = 55\,104$.

### Framdriftsstapel och "PÅ MÅL"/"UNDER MÅL" i Produktion

**Visas:** den tjocka stapeln och texten uppe till höger i rutan Produktion.

$$
\text{stapel} = \min\left(100\,\%,\ \frac{G}{M_\text{skift}}\right), \qquad
\text{markör} = \min\left(100\,\%,\ \frac{M_\text{hittills}}{M_\text{skift}}\right)
$$

$$
\text{PÅ MÅL} \iff G \ge M_\text{hittills}
$$

- "● PÅ MÅL" + grön stapel, annars "▼ UNDER MÅL" + gul stapel. Ingen text om $G$ eller målet saknas (stapeln är då tom).
- Eftersom $G / M_\text{hittills} \approx \mathrm{OEE}$ visas **"PÅ MÅL" i praktiken bara vid OEE ≥ 100 %** (se [Att känna till](#att-känna-till)).

**Exempel:** stapel $34\,440 / 67\,200 = 51{,}3\,\%$, markör $42\,000 / 67\,200 = 62{,}5\,\%$; $34\,440 < 42\,000$ → "▼ UNDER MÅL".

### Takt · TPM

**Visas:** rutan *Takt · TPM*, stort värde och "av 140" under.

$$
v = \texttt{TPM}, \qquad \text{"av "}\ R
$$

- Värdet direkt från `TPM`, alltid 1 decimal (`138,6`). Ingen färg eller jämförelse.
- "av …" = `NOMINAL_RATE_TPM` som heltal.

**Exempel:** `138,6` / `av 140`.

### Kassation

**Visas:** rutan *Kassation*: antal (`st`) och andel (`%`).

$$
K = \texttt{RejectCount}, \qquad
\text{Kassation} = \frac{K}{N} \cdot 100 = \frac{K}{G + K} \cdot 100
$$

- Antal: heltal (st). Andel: procent, 1 decimal.
- **Färg på andelen:** grön ≤ 2 %, gul ≤ 3 %, annars röd med **▲** framför.
- `–` (och neutral färg) utan `RejectCount` eller om $N = 0$. Räknas även utan skiftfönster.

**Exempel:** $700 / 35\,140 \cdot 100 = 1{,}99\,\%$ → `700 st`, `2,0 %` grön.

### Stopp

**Visas:** rutan *Stopp*: antal stopp, total stopptid och "STÅR".

$$
n_\text{stopp}, \qquad t_\text{stopp} \ \text{(se Körtid och stopp)}
$$

- Antal: heltal `st`. Total: hela minuter, `33 min` eller `1 h 05 min` (avrundat till närmaste minut).
- **"STÅR"** (röd, i rubrikraden) och rött antal när senaste segmentet är *stopp*, dvs. `ProductionState` ≠ 2 just nu.
- Utan skiftfönster: `–`. Med skiftfönster men utan tillståndslogg: `0 st`, `0 min totalt`, ingen "STÅR".
- Räknas från dashboardens egen tillståndslogg, **inte** från PLC-taggen `AccumulatedStoptime`.

**Exempel:** `6 st`, `33 min totalt`. Nattskift som stod 18:00–18:50 och sedan kört: `1 st`, `50 min totalt`.

### Skift kvar

**Visas:** rutan *Skift kvar*: kvarvarande tid och skiftets tider.

$$
t_\text{kvar} = T - t
$$

- Format `h:mm` + `h`, avrundat till närmaste minut. `0:00` mellan skift. `–` utan skiftfönster.
- Raden under: start–slut som `HH:MM–HH:MM` i **webbläsarens** tidszon.

**Exempel:** `3:00 h`, `06:00–14:00`. Nattskift kl. 02:00: `4:00 h`, `18:00–06:00`.

## Skärm Skiftmönster (`type: shift`)

**Visas:** staplad yta grön (kör) / röd (stopp) per klocktimme, etikett första och sista timme och "– N timmars skift".

För varje lokal klocktimme $h$ från timmen där skiftet startar till skiftslut:

$$
\text{kör}_h = \frac{1}{60} \sum_{\text{kör-segment}} \bigl|\,\text{segment} \cap [h,\ h + 1\,\text{h})\,\bigr|_\text{s}, \qquad
\text{stopp}_h = \frac{1}{60} \sum_{\text{stopp-segment}} \bigl|\,\text{segment} \cap [h,\ h + 1\,\text{h})\,\bigr|_\text{s}
$$

- Taggar `ShiftStart`, `ShiftEnd`, `ProductionState`; inställning `TIMEZONE`. Minuter, 1 decimal (inga siffror visas på TV:n).
- Tid efter "nu" räknas inte (framtida timmar är 0). En hel timme ger kör + stopp = 60.
- Sommartid: natten när klockan ställs tillbaka får två timmar "02:00".
- **N** i "N timmars skift" = antal klocktimmar i diagrammet, vänster etikett = första timmen (`HH:00`), höger = sista timmen + 1.
- Uppdateras var 30:e s och när skärmen visas.

**Exempel:** 06:00–14:00 kl. 11:00: 8 timmar, etiketter `06:00` och `14:00`; timmen 06:00 med ett stopp 06:40–06:48 ger
kör 52,0 min, stopp 8,0 min; timmarna 11:00–13:00 är 0.

## Grid-skärmar, t.ex. Dashboard (`type: grid`)

Värdena i rutorna kommer **direkt från PLC-taggarna**; dashboarden räknar inte om dem. I exempelfilen är *Produktion*
(`ProductionCount`), *Delta* (`ProductionDelta`), *OEE* (`OEE`), *Linjehastighet* (`TPM`), *Aktuell körtid* (`CurrentRuntime`)
och *Total stopptid* (`AccumulatedStoptime`) alla PLC-värden. Det som räknas i frontenden är:

### Värde och decimaler

$$
\text{visat} = \operatorname{toFixed}(x,\ d) \ \text{med decimalkomma}
$$

$d$ = `decimals` från YAML (0–3); annars `percent` 1, `number` 1 när taggen någon gång levererat ett decimaltal annars 0,
`counter` **alltid 0** (även om `decimals` är satt). `time` och `status` visas som text. `–` utan värde.

**Exempel:** OEE-taggen 82 med `type: percent` → `82,0 %`; `TPM` 138,62 med `decimals: 1` → `138,6 TPM`.

### Gränsvärdesfärg (`thresholds: [lägre, övre]`)

$$
\texttt{better: high}:\ \begin{cases} \text{grön} & x \ge \text{övre} \\ \text{gul} & x \ge \text{lägre} \\ \text{röd} & \text{annars} \end{cases}
\qquad
\texttt{better: low}:\ \begin{cases} \text{grön} & x \le \text{lägre} \\ \text{gul} & x \le \text{övre} \\ \text{röd} & \text{annars} \end{cases}
$$

Gul och röd visar ▼ (`high`) eller ▲ (`low`) i rubrikraden. Jämförelsen görs på PLC-värdet $x$, inte på det avrundade.

**Exempel:** `OEE` = 82,4 med `thresholds: [75, 85]` → gul `82,4 %` och ▼.

### Trend (`trend: true`)

$$
\Delta = \operatorname{round}_d\bigl(x_\text{senaste} - x_\text{näst senaste}\bigr)
$$

- De två senaste värdena i taggens historik (varje värdeändring från PLC:n loggas; historiken laddas om var 10:e s).
- ▲ om $\Delta > 0$, ▼ om $\Delta < 0$, ● om $\Delta = 0$ efter avrundning till $d$ decimaler; visat som $|\Delta|$ med $d$ decimaler.
- **Färg:** grön när förändringen går åt det bättre hållet (`better: high` och ▲, eller `better: low` och ▼), röd åt det sämre, grå vid ●.
- Kräver minst två numeriska värden, annars visas ingen trend.

**Exempel:** OEE 81,8 → 82,4: `▲ 0,6` grön. TPM 140,0 → 138,6: `▼ 1,4` röd.

### Mål och framdriftsstapel (`target`)

$$
\text{stapel} = \min\left(100\,\%,\ \max\left(0,\ \frac{x}{\text{mål}}\right)\right)
$$

- `target` = taggnamn (t.ex. `TargetCount`) eller fast tal. "Mål" visas med samma decimaler som värdet (`counter`: 0).
- Ingen stapel om målet eller värdet saknas eller om målet är ≤ 0; saknat mål visas som `–`. Ingen "PÅ MÅL"-text på grid-skärmar.

**Exempel:** Produktion 34 440 med `TargetCount` = 40 000 → `34440 st`, Mål `40000`, stapel 86,1 %.

## Skärm Larm (`type: alarms`)

$$
\text{fler} = \max(0,\ n_\text{larm} - 3)
$$

De 3 första larmen visas (stoppande larm, klass 1, först); resten som "+ N fler aktiva larm".

## Beräknas men visas inte

Följande finns i `GET /api/oee` men visas inte längre på TV:n (borttagna i PR #5):

| Fält | Formel |
|---|---|
| `stops.longest_s` | längsta stoppet, s |
| `stops.run_s` | $t_\text{kör}$, s |
| `stops.mtbf_s` | $t_\text{kör} / n_\text{stopp}$ (saknas om 0 stopp) |
| `stops.mttr_s` | $t_\text{stopp} / n_\text{stopp}$ (saknas om 0 stopp) |
| `speed.pct` | $\texttt{TPM} / R \cdot 100$ |
| `target.progress_pct` | $G / M_\text{skift} \cdot 100$ (inte kapad vid 100) |
| `hourly[].good` | ökning av $G$-taggen under varje klocktimme (minskning = nollställd räknare, då räknas det nya värdet) |
| `counts.good_source` | `GoodCount` eller `ProductionCount` |

## Att känna till

- **Två olika OEE.** OEE på grid-skärmen (`OEE`-taggen) räknas i PLC:n. OEE på OEE-skärmen räknas i backend enligt formlerna
  ovan. De kan visa olika värden.
- **"PÅ MÅL" i Produktion kräver i praktiken 100 % OEE**, eftersom *Mål hittills* är nominell takt × förfluten tid. Vid
  realistiska 80–85 % visar rutan alltid "▼ UNDER MÅL" och *Prognos* ligger alltid under *Skiftmål*.
- **OEE-rutans "PÅ MÅL" kräver 85 %**: 80–84,9 % är gult och "▼ UNDER MÅL".
- **Färg mot oavrundat värde:** OEE 84,96 % visas som `85,0 %` men är gult/"UNDER MÅL"; kassation 2,04 % visas som `2,0 %`
  men är gul. Samma på grid-skärmar med `thresholds`.
- **Utan `RejectCount`** (tomt nod-id i exempelfilen idag) visar Kvalitet 100,0 % och Kassation `–`.
- **`ProductionCount` som reserv för `GoodCount`:** om `RejectCount` kopplas in men inte `GoodCount` blir $N$ =
  `ProductionCount` + `RejectCount`. Räknar `ProductionCount` redan med kasserade pannor räknas de två gånger.
- **Inga planerade raster:** hela den förflutna skifttiden är planerad tid, så raster sänker Tillgänglighet och OEE.
- **Skiftmönster för skift som inte börjar på hel timme:** 06:30–14:30 visar "9 timmars skift" och etiketterna 06:00–15:00.
- **Skifttider i Skift kvar** visas i webbläsarens tidszon, skiftfönstret räknas i `TIMEZONE`. Ställ in samma zon på båda.
- **Trend efter nollställning:** när en räknare nollställs vid skiftbyte visar trenden en stor ▼ (röd för `better: high`).
