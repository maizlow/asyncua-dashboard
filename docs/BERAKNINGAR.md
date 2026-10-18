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
| `ProductionCount` | Total produktion detta skift **inklusive kassation**; används när `GoodCount` inte har något värde | Om även den saknas: $G$ saknas |
| `RejectCount` | Kasserade pannor detta skift, $K$ | Kvalitet och Kassation visar `–` |
| `TPM` | Aktuell takt, st/min | Takt visar `–` |
| `ShiftTarget` | **Skiftmål** i st för hela skiftet, från PLC:n, $M$ | Mål hittills och Skiftmål visar `–`, inget PÅ/UNDER MÅL i Produktion |
| `OeeTarget` | **OEE-mål** i %, från PLC:n | 85 % används (även om värdet är ≤ 0 eller > 100) |

`TargetCount` (målet i Dashboard-rutan *Produktion*) är **inte** reserverad och används inte av OEE-skärmen: det är bara en
vanlig tagg som exempelfilen visar som `target:`. Är PLC:ns `target` samma sak som skiftmålet kan `ShiftTarget` få samma nod-id.

Räknarna förutsätts vara **skifträknare** som PLC:n nollställer vid skiftstart (`ShiftStart`). Dashboarden nollställer
ingenting själv.

### Inställningar (`.env`)

| Inställning | Standard | Används till |
|---|---|---|
| `NOMINAL_RATE_TPM` | `140` | Nominell takt $R$ (st/min): Prestanda och "av 140". **Inte** målen – de kommer från PLC:n |
| `OEE_INTERVAL_S` | `5` | Hur ofta OEE-skärmens värden räknas om och skickas (minst 1 s). Räknas också när en skärm ansluter och vid `GET /api/oee` |
| `TIMEZONE` | systemets zon | Tidszon för `ShiftStart`/`ShiftEnd` och skiftmönstrets timmar (t.ex. `Europe/Stockholm`) |
| `SNAPSHOT_INTERVAL_MS` | `10000` | Hur ofta hela ögonblicksbilden + historik (för trend) skickas om |

Skiftmönstret skickas var 30:e sekund (fast i koden).

### Visning: avrundning och "–"

- **Decimalkomma** och fast antal decimaler; på OEE-skärmen heltal med mellanslag som tusentalsavgränsare (`34 440`),
  på grid-skärmar utan avgränsare (`34440`).
- Saknat värde (`null`, ej tal, tomt nod-id) visas alltid som **`–`**.
- Färger, ▲/▼ och PÅ/UNDER MÅL jämförs mot värdet **avrundat som det visas** (`85,0 %` är alltid på ett mål på 85 %).
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
\begin{array}{lll}
\texttt{GoodCount} \text{ har värde:} & G = \texttt{GoodCount}, & N = G + K \ (\text{eller } G \text{ utan } K) \\
\text{annars:} & N = \texttt{ProductionCount}, & G = \max\bigl(0,\ N - K\bigr) \ (\text{eller } N \text{ utan } K)
\end{array}
\qquad K = \texttt{RejectCount}
$$

**Antagande:** `ProductionCount` räknar **alla** pannor, även kasserade. Därför räknas kassationen aldrig två gånger.
Om PLC:ns räknare inte går i takt (kassation > produktion) blir $G$ = 0, aldrig negativt.

## Räkneexempel som används nedan

Dagskift **06:00–14:00** (8 h), klockan är **11:00**, `NOMINAL_RATE_TPM = 140`.
Linjen har kört 267 min och stått 33 min fördelat på 6 stopp; totalt 35 140 pannor varav 700 kasserade; `TPM` = 138,6.
PLC:n ger `ShiftTarget` = 57 120 (8 h × 60 × 140 × 0,85, dvs. 85 % av nominell takt) och `OeeTarget` är tomt (85 %).

| Storhet | Värde |
|---|---|
| $T$ | 480 min |
| $t$ | 300 min |
| $t_\text{kvar}$ | 180 min |
| $t_\text{kör}$ | 267 min |
| $n_\text{stopp}$, $t_\text{stopp}$ | 6 st, 33 min |
| $N$, $K$, $G$ | 35 140, 700, 34 440 |
| $M$ (`ShiftTarget`) | 57 120 |

Nattskift används som andra exempel: **18:00–06:00** (12 h), klockan **02:00**, `ShiftTarget` = 85 680.

## Skärm OEE (`type: oee`)

### OEE

**Visas:** stora siffran i rutan *OEE*, `82,0 %`.

$$
\mathrm{OEE} = A \cdot P \cdot Q
$$

- Enhet %, 1 decimal. `–` om någon av $A$, $P$, $Q$ saknas.
- **OEE-mål** $O$ = `OeeTarget` (%), 85 om taggen saknar giltigt värde.
- **Färg:** grön när visat värde ≥ $O$, gul när ≥ $O - 10$, annars röd.
- **"● PÅ MÅL"** (grön) när visat värde ≥ $O$, annars **"▼ UNDER MÅL"** (gul text, även när siffran är röd). Ingen text när OEE saknas.

$$
\text{PÅ MÅL} \iff \mathrm{round}_1(100 \cdot \mathrm{OEE}) \ge O
$$

**Exempel:** $0{,}890 \cdot 0{,}940 \cdot 0{,}980 = 0{,}820$ → `82,0 %`, gul, "▼ UNDER MÅL". Med `OeeTarget` = 80 blir det
grönt och "● PÅ MÅL". OEE 0,8496 visas `85,0 %` och är "PÅ MÅL".

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

- %, 1 decimal. `–` om $G$ saknas, $N = 0$ eller **`RejectCount` saknas** (då vet vi inte hur mycket som kasserats,
  och därför visar även OEE `–`).
- Kvalitet räknas även utan tillståndslogg, men **inte** utan skiftfönster (då är alla fyra `–`).

**Exempel:** $34\,440 / 35\,140 = 0{,}980$ → `98,0 %`.

### Färg på Tillgänglighet, Prestanda, Kvalitet

Samma för alla tre, på visat värde: grön ≥ 90,0 %, gul ≥ 80,0 %, annars röd med **▼** framför värdet. Stapeln under raden är värdet i %
(0–100 %) i samma färg; saknat värde = tom stapel.

**Exempel:** Tillgänglighet 89,0 % → gul, `▼ 89,0 %`; Prestanda 94,0 % och Kvalitet 98,0 % → gröna.

### Produktion: st godkända

**Visas:** stora siffran i rutan *Produktion*, `34 440 st godkända`.

$$
G \quad \text{(direkt från taggen, se ovan)}
$$

Heltal med tusentalsavgränsare. `–` om varken `GoodCount` eller `ProductionCount` har något värde.
Med `ProductionCount` och `RejectCount`: $G = \texttt{ProductionCount} - \texttt{RejectCount}$.

### Skiftmål

**Visas:** *Skiftmål* i rutan Produktion.

$$
M_\text{skift} = \mathrm{round}(M), \qquad M = \texttt{ShiftTarget}
$$

- Hela skiftets mål i st, **från PLC:n**. Heltal. `–` om `ShiftTarget` saknar värde eller skiftfönster saknas.
- Dashboarden räknar **aldrig** fram ett eget mål från nominell takt.

**Exempel:** `ShiftTarget` = 57 120 → `57 120`. Nattskift: `85 680`.

### Mål hittills

**Visas:** *Mål hittills* i rutan Produktion (och vit markör i stapeln).

$$
M_\text{hittills} = \mathrm{round}\left(M \cdot \frac{t}{T}\right)
$$

- Skiftmålet fördelat jämnt över skiftet (pro rata). Heltal (st). `–` när Skiftmål är `–`.

**Exempel:** $57\,120 \cdot 300 / 480 = 35\,700$. Nattskift kl. 02:00: $85\,680 \cdot 480 / 720 = 57\,120$.

### Prognos

**Visas:** *Prognos* i rutan Produktion.

$$
\text{Prognos} = \mathrm{round}\left(\frac{G}{t} \cdot T\right)
$$

- Godkända vid skiftslut om nuvarande **medeltakt inklusive stopp** håller i sig. Heltal (st).
- `–` de **första 5 minuterna** av skiftet ($t < 300$ s), utan skiftfönster eller utan $G$.
- Mellan skift ($t = T$) blir prognosen lika med $G$.
- Prognosen behöver inget mål och visas även utan `ShiftTarget`; den färgas inte.

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

- "● PÅ MÅL" + grön stapel, annars "▼ UNDER MÅL" + gul stapel (heltal mot heltal, som de visas).
- **Utan `ShiftTarget`:** Mål hittills och Skiftmål `–`, ingen text, tom stapel och ingen markör. Ingen reserv med nominell takt.
- Med ett skiftmål på 85 % av nominell takt betyder "PÅ MÅL" ungefär OEE ≥ 85 %.

**Exempel:** stapel $34\,440 / 57\,120 = 60{,}3\,\%$, markör $35\,700 / 57\,120 = 62{,}5\,\%$; $34\,440 < 35\,700$ →
"▼ UNDER MÅL". Med 36 000 godkända: "● PÅ MÅL".

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
- **Färg på andelen** (visat värde): grön ≤ 2,0 %, gul ≤ 3,0 %, annars röd med **▲** framför. 2,04 % visas `2,0 %` och är grön.
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

**Visas:** staplad yta grön (kör) / röd (stopp) per skifttimme, etikett skiftstart och skiftslut och "– N timmars skift".

Skiftet delas i timmar räknat **från skiftstart**: $[t_\text{start} + i\,\text{h},\ \min(t_\text{start} + (i+1)\,\text{h},\ t_\text{slut}))$.
Ett skift som inte är ett helt antal timmar slutar med en kortare timme. För varje timme $i$:

$$
\text{kör}_i = \frac{1}{60} \sum_{\text{kör-segment}} \bigl|\,\text{segment} \cap \text{timme}_i\,\bigr|_\text{s}, \qquad
\text{stopp}_i = \frac{1}{60} \sum_{\text{stopp-segment}} \bigl|\,\text{segment} \cap \text{timme}_i\,\bigr|_\text{s}
$$

$$
N_\text{timmar} = \frac{1}{60} \sum_i \text{minuter}_i = \frac{T}{60}
$$

- Taggar `ShiftStart`, `ShiftEnd`, `ProductionState`; inställning `TIMEZONE`. Minuter, 1 decimal (inga siffror visas på TV:n).
- Tid efter "nu" räknas inte (framtida timmar är 0). En hel timme ger kör + stopp = 60.
- **N** = skiftets verkliga längd i timmar, heltal eller en decimal (`8`, `8,5`). Vänster etikett = skiftstart, höger = skiftslut (`HH:MM`).
- Sommartid: natten när klockan ställs om blir skiftet 1 h kortare/längre (7 eller 9 timmar).
- Uppdateras var 30:e s och när skärmen visas.

**Exempel:** 06:00–14:00 kl. 11:00: "8 timmars skift", etiketter `06:00` och `14:00`; timmen 06:00 med ett stopp 06:40–06:48
ger kör 52,0 min, stopp 8,0 min; timmarna 11:00–13:00 är 0. Skiftet 06:30–14:30: 8 timmar 06:30, 07:30 … 13:30,
etiketter `06:30` och `14:30`. Skiftet 06:00–14:30: "8,5 timmars skift", sista timmen 14:00–14:30 (30 min).

## Grid-skärmar, t.ex. Dashboard (`type: grid`)

Värdena i rutorna kommer **direkt från PLC-taggarna**; dashboarden räknar inte om dem. I exempelfilen är *Produktion*
(`ProductionCount`), *Delta* (`ProductionDelta`), *OEE* (`OEE`), *Linjehastighet* (`TPM`), *Aktuell körtid* (`CurrentRuntime`)
och *Total stopptid* (`AccumulatedStoptime`) alla PLC-värden. Det som räknas i frontenden är:

### Värde och decimaler

$$
\text{visat} = \mathrm{toFixed}(x,\ d) \ \text{med decimalkomma}
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

Gul och röd visar ▼ (`high`) eller ▲ (`low`) i rubrikraden. $x$ är värdet **avrundat till $d$ decimaler**, som det visas.

**Exempel:** `OEE` = 82,4 med `thresholds: [75, 85]` → gul `82,4 %` och ▼. `OEE` = 84,96 visas `85,0 %` och är grön.

### Trend (`trend: true`)

$$
\Delta = \mathrm{round}_d\bigl(x_\text{senaste} - x_\text{näst senaste}\bigr)
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
| `target.progress_pct` | $G / M_\text{skift} \cdot 100$ (inte kapad vid 100; saknas utan `ShiftTarget`) |
| `target.source` | `ShiftTarget`, eller saknas |
| `oee_target` | $O$ och källa (`OeeTarget` eller `default`) |
| `hourly[].good` | ökning av `GoodCount` (annars `ProductionCount`, då inklusive kassation) under varje klocktimme (minskning = nollställd räknare, då räknas det nya värdet) |
| `counts.good_source` | `GoodCount` eller `ProductionCount` |

## Att känna till

- **Två olika OEE.** OEE på grid-skärmen (`OEE`-taggen) räknas i PLC:n. OEE på OEE-skärmen räknas i backend enligt formlerna
  ovan. De kan visa olika värden.
- **Målen kommer från PLC:n.** `ShiftTarget` och `OeeTarget` är tomma (TODO(PLC)) i exempelfilen: tills de kopplas visar
  Mål hittills/Skiftmål `–`, Produktion har ingen PÅ/UNDER MÅL-text och OEE-målet är 85 %.
- **Utan `RejectCount`** (tomt nod-id i exempelfilen idag) visar Kvalitet, OEE och Kassation `–`.
- **`ProductionCount` antas innehålla kassationen.** Om den i PLC:n bara räknar godkända blir $G$ för lågt med `RejectCount`
  kopplad – koppla då `GoodCount` i stället.
- **Inga planerade raster:** hela den förflutna skifttiden är planerad tid, så raster sänker Tillgänglighet och OEE.
- **Skifttider i Skift kvar** visas i webbläsarens tidszon, skiftfönstret räknas i `TIMEZONE`. Ställ in samma zon på båda.
- **Trend efter nollställning:** när en räknare nollställs vid skiftbyte visar trenden en stor ▼ (röd för `better: high`).
