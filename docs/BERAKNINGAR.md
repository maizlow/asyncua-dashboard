# Beräkningar: formler för alla värden på TV:n

Här står hur **varje beräknat värde** på dashboarden räknas fram: vilken skärm det syns på, formeln, vilka taggar
(från [`dashboard.yaml`](../dashboard.yaml)) och inställningar (`.env`) som används, enhet och avrundning, specialfall
och ett räkneexempel från takpannelinjen. Dokumentet beskriver **koden som den är**:

- **Backend** [`backend/opc/oee.py`](../backend/opc/oee.py) räknar OEE, mål, prognos, kassation, stopp och skifttid
  (`GET /api/oee` och WebSocket-meddelandet `oee_details`).
- **Backend** [`backend/opc/shift_logger.py`](../backend/opc/shift_logger.py) räknar skiftfönstret, kör-/stopptid och
  skiftmönstret per timme.
- **Backend** [`backend/opc/shifts.py`](../backend/opc/shifts.py) för skiftloggen (tabellen `shifts`): en rad per skift med
  parametrar, räknare och kör-/stopptid, och summering över skift (`GET /api/shifts`).
- **Frontend** räknar bara visningen: avrundning, trend (▲/▼), framdriftsstaplar, färger och ▲/▼/"UNDER MÅL"
  ([`ItemCard.tsx`](../frontend/src/components/ItemCard.tsx), [`OeeScreen.tsx`](../frontend/src/screens/OeeScreen.tsx),
  [`format.ts`](../frontend/src/lib/format.ts)).

Hur du konfigurerar taggar och objekt står i [CONFIG.md](CONFIG.md).

- [Indata](#indata)
- [Gemensamma begrepp](#gemensamma-begrepp)
- [Räkneexempel som används nedan](#räkneexempel-som-används-nedan)
- [Skärm OEE (`type: oee`)](#skärm-oee-type-oee)
- [Skärm Skiftmönster (`type: shift`)](#skärm-skiftmönster-type-shift)
- [Skiftlogg (tabellen `shifts`)](#skiftlogg-tabellen-shifts)
- [Skärm 7 dagar (`type: week`)](#skärm-7-dagar-type-week)
- [Skärm Highscore (`type: highscore`)](#skärm-highscore-type-highscore)
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
| `PlannedTime` | **Planerad tid** i minuter för hela skiftet, **exklusive raster**, från PLC:n, $T_\text{plan}$ | $T_\text{plan} = T$ (skiftlängden); gäller också om värdet är < 0 eller > 1440 |
| `ShiftTeam` | **Skiftlag** (text eller nummer), sparas per skift i skiftloggen | `–` |

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
| `HISTORY_INTERVAL_S` | `60` | Hur ofta 7-dagarsskärmen räknas om och skickas (minst 10 s). Bara idag räknas om; tidigare dagar sparas |
| `SHIFT_SETTLE_S` | `10` | Skiftloggen: väntetid efter ett skiftbyte innan det nya skiftets parametrar sparas, och fönstret där en nollställning av räknarna kopplas till skiftbytet ([Skiftbyte](#skiftbyte-och-taggar-som-kommer-i-olika-ordning)) |
| `HIGHSCORE_MIN_STOP_S` | `0` | Highscore: stopp kortare än detta avslutar inte en körning (0 = varje stopp avslutar) |
| `RETENTION_DAYS` | `30` | Hur länge historiken sparas. **Under 7** visar 7-dagarsskärmen `–` för de äldsta dagarna (varning i loggen) |

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

$T$ = skiftlängd, $t$ = förfluten skifttid (sekunder i koden).

**Planerad tid hittills** $t_\text{plan}$. Med `PlannedTime` ($T_\text{plan}$ minuter för hela skiftet, exklusive raster) fördelas
den jämnt över skiftet, annars är hela den förflutna tiden planerad:

$$
t_\text{plan} = \begin{cases} T_\text{plan} \cdot \frac{t}{T} & \text{om } \texttt{PlannedTime} \text{ har ett värde mellan 0 och 1440 min} \cr t & \text{annars} \end{cases}
$$

Rasternas klockslag är inte kända, därför pro rata: under en rast ökar $t_\text{plan}$ ändå, men vid skiftets slut är
$t_\text{plan} = T_\text{plan}$. Utan `PlannedTime` dras raster **inte** av.

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
\texttt{GoodCount} \text{ har värde:} & G = \texttt{GoodCount}, & N = G + K \ (\text{eller } G \text{ utan } K) \cr
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
A = \min\left(1,\ \frac{t_\text{kör}}{t_\text{plan}}\right)
$$

- Taggar: `ShiftStart`, `ShiftEnd`, `ProductionState`, `PlannedTime` (valfri). %, 1 decimal, max 100 %.
- `–` om skiftfönster saknas, $t_\text{plan} = 0$ (precis vid skiftstart, eller `PlannedTime` = 0) eller om det inte finns
  någon loggad tillståndsändring alls.
- Tid i skiftet innan första loggade tillståndet (om backend startade mitt i skiftet utan tidigare logg) räknas varken som
  kör eller stopp men ingår i $t_\text{plan}$, vilket sänker $A$.

**Exempel:** utan `PlannedTime`: $267 / 300 = 0{,}890$ → `89,0 %`. Med `PlannedTime` = 450 min:
$t_\text{plan} = 450 \cdot 300 / 480 = 281{,}25$ min och $A = 267 / 281{,}25 = 0{,}949$ → `94,9 %`.

### Prestanda

**Visas:** raden *Prestanda* i rutan OEE.

$$
P = \min\left(1,\ \frac{N}{\dfrac{t_\text{kör}}{60} \cdot R}\right)
$$

($t_\text{kör}$ i sekunder, $R$ = `NOMINAL_RATE_TPM` st/min.)

- Taggar: `GoodCount`/`ProductionCount`, `RejectCount`, `ProductionState`; inställning `NOMINAL_RATE_TPM`. %, 1 decimal, **max 100 %**.
- `–` om $N$ saknas, $t_\text{kör} = 0$ eller $R = 0$.
- Använder **totalt** antal (godkända + kassation), inte `TPM`.

**Exempel:** $35\thinspace 140 / (267 \cdot 140) = 35\thinspace 140 / 37\thinspace 380 = 0{,}940$ → `94,0 %`.

### Kvalitet

**Visas:** raden *Kvalitet* i rutan OEE.

$$
Q = \frac{G}{N}
$$

- %, 1 decimal. `–` om $G$ saknas, $N = 0$ eller **`RejectCount` saknas** (då vet vi inte hur mycket som kasserats,
  och därför visar även OEE `–`).
- Kvalitet räknas även utan tillståndslogg, men **inte** utan skiftfönster (då är alla fyra `–`).

**Exempel:** $34\thinspace 440 / 35\thinspace 140 = 0{,}980$ → `98,0 %`.

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

**Exempel:** $57\thinspace 120 \cdot 300 / 480 = 35\thinspace 700$. Nattskift kl. 02:00: $85\thinspace 680 \cdot 480 / 720 = 57\thinspace 120$.

### Prognos

**Visas:** *Prognos* i rutan Produktion.

$$
\text{Prognos} = \mathrm{round}\left(\frac{G}{t} \cdot T\right)
$$

- Godkända vid skiftslut om nuvarande **medeltakt inklusive stopp** håller i sig. Heltal (st).
- `–` de **första 5 minuterna** av skiftet ($t \lt  300$ s), utan skiftfönster eller utan $G$.
- Mellan skift ($t = T$) blir prognosen lika med $G$.
- Prognosen behöver inget mål och visas även utan `ShiftTarget`; den färgas inte.

**Exempel:** $34\thinspace 440 / 300 \cdot 480 = 55\thinspace 104$.

### Framdriftsstapel och "PÅ MÅL"/"UNDER MÅL" i Produktion

**Visas:** den tjocka stapeln och texten uppe till höger i rutan Produktion.

$$
\text{stapel} = \min\left(1,\ \frac{G}{M_\text{skift}}\right), \qquad
\text{markör} = \min\left(1,\ \frac{M_\text{hittills}}{M_\text{skift}}\right)
$$

$$
\text{PÅ MÅL} \iff G \ge M_\text{hittills}
$$

- "● PÅ MÅL" + grön stapel, annars "▼ UNDER MÅL" + gul stapel (heltal mot heltal, som de visas).
- **Utan `ShiftTarget`:** Mål hittills och Skiftmål `–`, ingen text, tom stapel och ingen markör. Ingen reserv med nominell takt.
- Med ett skiftmål på 85 % av nominell takt betyder "PÅ MÅL" ungefär OEE ≥ 85 %.

**Exempel:** stapel $34\thinspace 440 / 57\thinspace 120 = 60{,}3$ %, markör $35\thinspace 700 / 57\thinspace 120 = 62{,}5$ %; $34\thinspace 440 \lt  35\thinspace 700$ →
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

**Exempel:** $700 / 35\thinspace 140 \cdot 100 = 1{,}99$ % → `700 st`, `2,0 %` grön.

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

Skiftet delas i timmar räknat **från skiftstart**: $[t_\text{start} + i\thinspace \text{h},\ \min(t_\text{start} + (i+1)\thinspace \text{h},\ t_\text{slut}))$.
Ett skift som inte är ett helt antal timmar slutar med en kortare timme. För varje timme $i$:

$$
\text{kör}_i = \frac{1}{60} \sum_{\text{kör-segment}} \bigl|\thinspace \text{segment} \cap \text{timme}_i\thinspace \bigr|_\text{s}, \qquad
\text{stopp}_i = \frac{1}{60} \sum_{\text{stopp-segment}} \bigl|\thinspace \text{segment} \cap \text{timme}_i\thinspace \bigr|_\text{s}
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

## Skiftlogg (tabellen `shifts`)

PLC:n visar bara **pågående** skift (`ShiftStart`, `ShiftEnd`, `ShiftTarget`, `OeeTarget`, `PlannedTime`, `ShiftTeam`).
Backend ([`backend/opc/shifts.py`](../backend/opc/shifts.py)) sparar därför **en rad per skift** i SQLite och stänger
föregående skift när ett nytt börjar. Tabellen gallras **inte** av `RETENTION_DAYS`. Visas inte direkt på TV:n men är
underlaget för [7 dagar](#skärm-7-dagar-type-week); finns i `GET /api/shifts?limit=20` (nyast först).

| Fält | Innehåll |
|---|---|
| `start`, `end` | Schemalagd start $s_S$ och slut $e_S$ från `ShiftStart`/`ShiftEnd` (UTC i databasen) |
| `opened`, `closed` | Skiftbytestiden $T_S$ då mätningen började, och nästa skifts $T_{S+1}$ (tom medan skiftet pågår) |
| `status` | `open` (pågående, uppdateras var 30:e sekund) eller `closed` |
| `team`, `target`, `oee_target` | `ShiftTeam`, `ShiftTarget` $M_S$, `OeeTarget` $O_S$ (tomt om taggen saknar värde) |
| `planned_s`, `planned_source` | $t_{\text{plan},S}$ och `PlannedTime` eller `schedule` |
| `good`, `reject`, `total` | $G_S$, $K_S$, $N_S$ |
| `run_s`, `stop_count`, `stop_s` | Körtid, antal stopp och stopptid |

### Skiftbyte och taggar som kommer i olika ordning

Taggarna kommer inte i samma OPC-ram: ett nytt `ShiftTarget` kan komma tre ramar efter `ShiftStart`, eller före. Därför:

1. **Skiftbyte upptäcks** när skiftets start flyttas framåt: `ShiftStart` ändras till ett nytt klockslag (en färsk ändring
   får komma upp till 30 min före den schemalagda starten), **eller** klockan passerar nästa förekomst av ett oförändrat
   `ShiftStart` (ett skift per dag med 06:00 varje dag). En nollställd räknare ensam är **inte** ett skiftbyte (räknare
   nollställs ibland mitt i skiftet).
2. **Skiftbytestid** $T = \min(s_\text{ny},\ \text{tiden då ändringen kom})$. Det gamla skiftet mäts till $T$, det nya från $T$.
3. **Väntan** $w$ = `SHIFT_SETTLE_S` (10 s) efter senaste `ShiftStart`-ändringen innan något skrivs. Då:
   - det **stängda** skiftet får de parametrar det hade vid $T - w$, så värden för nästa skift som kom strax före eller efter
     `ShiftStart` hamnar aldrig på det gamla skiftet;
   - det **nya** skiftet får de senaste värdena (även de som kom före `ShiftStart`);
   - går `ShiftStart` tillbaka till det öppna skiftets start under väntan (fladder) avbryts skiftbytet; ändras det igen
     ersätts kandidaten och väntan börjar om ($T$ behålls).
4. **Parametrar medan skiftet pågår:** varje ändring skrivs direkt till skiftets rad, **senaste värdet gäller** (en rättelse av
   `ShiftTarget` mitt i skiftet gäller hela skiftet).
5. **`ShiftStart` bakåt** (tidigare än det öppna skiftets start) ignoreras och loggas som varning. Samma värde igen
   (återanslutning) ignoreras.
6. **Omstart av backend:** det öppna skiftet läses från databasen och fortsätter. Har skiftet bytts medan backend var nere
   stängs det gamla vid det nya skiftets schemalagda start.
7. **Saknade taggar:** utan `ShiftStart` skapas inga rader. Utan `ShiftTeam`, `ShiftTarget` eller `OeeTarget` blir fältet tomt;
   utan `PlannedTime` är $t_{\text{plan},S} = e_S - s_S$.

**Räknarna** delas med **ökningar** (inte absoluta värden). För varje räknartagg är delningstiden $u$ den första
nollställningen (minskning) som loggats mellan $T - w$ och tiden då väntan tog slut, annars $T$:

$$
u = \begin{cases} \text{första minskningen av räknaren i } [T - w,\ T_\text{väntan klar}] & \text{om den finns} \cr T & \text{annars} \end{cases}
$$

Pannor som loggas mellan skiftbytet och en sen nollställning hör alltså till det gamla skiftet, och pannor efter en tidig
nollställning till det nya. En räknare som aldrig nollställs fungerar också (ökningarna delas vid $T$).

**Exempel** med $w$ = 10 s:

| Tid | Från PLC:n | Effekt |
|---|---|---|
| 13:59:56 | `ShiftTarget` = 48 000, `ShiftTeam` = B (avsett för nästa skift) | Skift A:s rad uppdateras tillfälligt |
| 14:00:00 | `ShiftStart` = 14:00, `ShiftEnd` = 22:00 | Skiftbyte upptäckt, $T$ = 14:00:00, väntan till 14:00:10 |
| 14:00:03 | `ProductionCount` = 50 012 | Hör till skift A |
| 14:00:04 | `ProductionCount` = 0 | Nollställning: $u$ = 14:00:04 |
| 14:00:05 | `PlannedTime` = 420 | |
| 14:00:10 | – | A stängs med 50 000 st och lag A (värdena 13:59:50), $N_A$ = 50 012. B öppnas med 48 000 st, lag B, 420 min |

### Värden per skift

$$
N_S = \Delta \texttt{ProductionCount} \text{ i } [u_S,\ u_{S+1}), \qquad
t_{\text{kör},S} = \text{körtid i } [T_S,\ T_{S+1}), \qquad
t_{\text{plan},S} = \begin{cases} 60 \cdot \texttt{PlannedTime} & \text{om värde} \cr e_S - s_S & \text{annars} \end{cases}
$$

$\Delta$ = summan av ökningar som i [Godkända per dag](#godkända-per-dag) (minskning = nollställd, nya värdet räknas). $G_S$ och
$K_S$ på samma sätt med samma regler för `GoodCount`/`ProductionCount`/`RejectCount` som live. För ett pågående skift är
$u_{S+1}$ och $T_{S+1}$ = nu. Stopp räknas bara inom $[T_S,\ \min(e_S,\ T_{S+1})]$ (stopp efter schemalagt slut är inte
stilleståndstid). Körtid efter schemalagt slut (övertid) räknas.

### Summering över skift (dag, vecka)

Råa summor delas efter **tidsandel** och A, P, Q och OEE räknas om från summorna (inte medelvärde av skiftens OEE). Ett skift
täcker $[s_S,\ e_S^\ast]$ med $e_S^\ast = \min(e_S,\ \text{stängt eller nu})$. För ett intervall $D$ (t.ex. ett dygn):

$$
a_{S,D} = \frac{|[s_S,\ e_S^\ast] \cap D|}{e_S^\ast - s_S}, \qquad
p_{S,D} = \frac{|[s_S,\ e_S^\ast] \cap D|}{e_S - s_S}
$$

$a$ delar det som mätts hittills (antal, körtid), $p$ delar planerad tid och mål (för ett pågående skift blir det "hittills").
Ett nattskift 22:00–06:00 ger 2/8 till dagen före och 6/8 till dagen efter.

$$
G_D = \sum_S a_{S,D} \cdot G_S, \quad
N_D = \sum_S a_{S,D} \cdot N_S, \quad
t_{\text{kör},D} = \sum_S a_{S,D} \cdot t_{\text{kör},S}, \quad
t_{\text{plan},D} = \sum_{S \text{ planerat}} p_{S,D} \cdot t_{\text{plan},S}
$$

$$
\mathrm{OEE}_D = \min\left(1,\ \frac{G_D}{t_{\text{plan},D}^{\text{min}} \cdot R}\right), \quad
A_D = \min\left(1,\ \frac{t_{\text{kör},D}}{t_{\text{plan},D}}\right), \quad
P_D = \min\left(1,\ \frac{N_D}{t_{\text{kör},D}^{\text{min}} \cdot R}\right), \quad
Q_D = \frac{G_D}{N_D}
$$

$$
M_D = \sum_S p_{S,D} \cdot M_S, \qquad
O_D = \frac{\sum_{S \text{ planerat}} p_{S,D} \cdot t_{\text{plan},S} \cdot O_S}{t_{\text{plan},D}}
$$

- Utan kapning vid 1 är $\mathrm{OEE}_D = A_D \cdot P_D \cdot Q_D$ exakt.
- **Planerat skift:** ett skift utan någon körtid räknas inte som planerat (helg, ledigt), **utom** när PLC:n gav `PlannedTime`:
  då räknas ett totalt haveri som planerad tid (och `PlannedTime` = 0 betyder ledigt).
- $O_S$ = 85 för skift utan `OeeTarget`. $M_D$ saknas om inget skift har `ShiftTarget`. OEE och Q saknas utan `RejectCount`
  (som live).

**Exempel**, ett dygn med tre skift och $R$ = 140:

| Skift | $G_S$ | $N_S$ | $t_{\text{kör},S}$ | $t_{\text{plan},S}$ | $M_S$ | Andel av dygnet |
|---|---|---|---|---|---|---|
| A 06–14 | 50 000 | 51 000 | 7 h | 8 h | 54 000 | 1 |
| B 14–22 | 48 000 | 49 000 | 7 h | 8 h | 54 000 | 1 |
| C 22–06 | 40 000 | 41 000 | 6 h | 8 h | 54 000 | 2/8 |

$$
G_D = 50\thinspace 000 + 48\thinspace 000 + \tfrac{2}{8} \cdot 40\thinspace 000 = 108\thinspace 000, \qquad
t_{\text{plan},D} = 18 \text{ h}, \qquad
\mathrm{OEE}_D = \frac{108\thinspace 000}{1080 \cdot 140} = 0{,}714
$$

och $M_D = 54\thinspace 000 + 54\thinspace 000 + 13\thinspace 500 = 121\thinspace 500$.

## Skärm 7 dagar (`type: week`)

**Visas:** sju kolumner, idag längst till höger (ljusare ruta, "Idag"). Per dag: **OEE %** överst, en **stapel** med godkända
pannor, en vit linje för **dagsmålet**, **antal godkända** under stapeln och veckodag + datum (`Mån` / `12/10`).
Beräknas i backend ([`backend/opc/daily.py`](../backend/opc/daily.py)), `GET /api/history/days?n=7` och WebSocket-meddelandet
`daily_history`.

**Två källor** (fältet `source` per dag):

- **`shifts`**: dagar som började efter att skiftloggen startade räknas från [skiftloggen](#skiftlogg-tabellen-shifts) med
  [summering över skift](#summering-över-skift-dag-vecka): $G_D$, $\mathrm{OEE}_D$, $A_D$, $P_D$, $Q_D$, dagsmål $M_D$ och
  dagens OEE-mål $O_D$ (`oee_target`) samt skiftlagen (`teams`). Ingen överlappande skiftrad = `–`.
- **`raw`**: dagar före skiftloggen (de första dagarna efter uppgradering) räknas som tidigare direkt ur historiken
  (`data_points` och `shift_log`), enligt avsnitten nedan.

Skiftloggens starttid sparas i databasen (tabellen `meta`, `shift_log_since`) första gången backend startar med skiftloggen.

### Dag

En dag är ett **kalenderdygn i `TIMEZONE`**, från lokal midnatt till nästa lokala midnatt:

$$
D = [\thinspace 00{:}00_d,\ 00{:}00_{d+1}) \quad \text{(lokal tid)}, \qquad |D| \in \lbrace 23,\ 24,\ 25 \rbrace \ \text{h}
$$

- Sommartid: dygnet när klockan ställs fram är 23 h, när den ställs tillbaka 25 h.
- Allt **delas vid midnatt**: räknarökningar hör till den dag de loggades, kör-/stopptid klipps vid midnatt och ett nattskift
  (t.ex. 22:00–06:00) räknas till båda dagarna i proportion till tiden i varje dag.
- Idag räknas fram till nu.
- **Ingen data** (ingen rad i `data_points` eller `shift_log` under dygnet, t.ex. linjen stod och inget ändrades, backend var
  avstängd eller historiken är gallrad): alla värden för dagen är `–` och ingen stapel visas.

### Godkända per dag

För varje räknartagg $c$ (`GoodCount`, `ProductionCount`, `RejectCount`) summeras ökningarna mellan på varandra följande loggade
värden $v_0, v_1, \ldots, v_m$ under dagen, där $v_0$ är sista värdet före midnatt:

$$
\Delta c_D = \sum_{j=1}^{m} \begin{cases} v_j - v_{j-1} & \text{om } v_j \ge v_{j-1} \cr v_j & \text{om } v_j \lt v_{j-1} \ \text{(räknaren nollställd)} \end{cases}
$$

Saknas $v_0$ (ingen tidigare historik) räknas första värdet som ökning. Sedan samma regler som live:

$$
G_D = \Delta \texttt{GoodCount}_D, \quad N_D = G_D + K_D \qquad \text{eller} \qquad N_D = \Delta \texttt{ProductionCount}_D, \quad G_D = \max(0,\ N_D - K_D)
$$

med $K_D = \Delta \texttt{RejectCount}_D$. `GoodCount` används om taggen har historik, annars `ProductionCount`.
Heltal, med tusentalsavgränsare (`70 600`).

### Planerad tid, körtid och stopptid

Skiftfönstren tas från nuvarande `ShiftStart`/`ShiftEnd` (live, annars senast loggade värden) och **antas vara samma alla
dagar**. För dag $D$ betraktas skiften som börjar dagen före och samma dag. För varje skiftdel $S \cap D$ (fram till nu):

$$
t_{\text{kör},S \cap D} = \text{körtid i } S \cap D, \qquad
S \cap D \ \text{är planerad} \iff t_{\text{kör},S \cap D} \gt 0
$$

$$
t_{\text{plan},D} = \sum_{\text{planerade } S} |S \cap D|, \qquad
t_{\text{kör},D} = \sum_{\text{planerade } S} t_{\text{kör},S \cap D}, \qquad
t_{\text{stopp},D} = t_{\text{plan},D} - t_{\text{kör},D}
$$

En skiftdel helt utan körtid (helg, helgdag) räknas alltså **inte** som planerad. Körtid och stopptid visas inte på TV:n men
finns i API:t (`planned_s`, `run_s`, `stop_s`).

### OEE per dag

Samma formler som live med dagens värden:

$$
A_D = \min\left(1,\ \frac{t_{\text{kör},D}}{t_{\text{plan},D}}\right), \quad
P_D = \min\left(1,\ \frac{N_D}{t_{\text{kör},D}^{\text{min}} \cdot R}\right), \quad
Q_D = \frac{G_D}{N_D}, \quad
\mathrm{OEE}_D = A_D \cdot P_D \cdot Q_D
$$

- %, 1 decimal, vit (ingen färg). `–` utan planerad tid, utan skifttider, utan `RejectCount` (som live) eller utan data.
- Om siffran inte får plats ("100,0 %") krymper den, aldrig under 37 px versalhöjd vid 1080p.

### Dagsmål och stapel

$$
M_D = \sum_{\text{planerade } S} M_S \cdot \frac{|S \cap D|}{|S|}
$$

$M_S$ = sista loggade `ShiftTarget` för skiftet. Idag gäller målet fram till nu (som *Mål hittills*). Utan `ShiftTarget`: ingen
vit linje, ingen förklaring "dagsmål" och grå staplar.

$$
\text{stapel}_D = \frac{G_D}{H}, \qquad \text{linje}_D = \frac{M_D}{H}, \qquad H = \max_{D}\bigl(\max(G_D,\ M_D)\bigr)
$$

Alla staplar har samma skala $H$. **Färg:** grön när $G_D \ge M_D$, gul när $G_D \lt M_D$ (stapeln slutar då under den vita
linjen, så status syns även utan färg), grå utan mål.

**Exempel:** dagskift 06:00–16:00, 600 min planerat, 540 min kört, 72 000 pannor varav 1 400 kasserade, `ShiftTarget` = 71 400:

$$
A = \frac{540}{600} = 0{,}900, \quad P = \frac{72\thinspace 000}{540 \cdot 140} = 0{,}952, \quad Q = \frac{70\thinspace 600}{72\thinspace 000} = 0{,}981, \quad \mathrm{OEE} = 0{,}840
$$

→ `84,0 %`, `70 600`, gul stapel strax under linjen 71 400. Nattskift 22:00–06:00 med `ShiftTarget` = 57 120 som kört hela
natten i 119 st/min: dagen före får 2 h (14 280 pannor, mål 14 280), dagen efter 6 h (42 840 pannor, mål 42 840).

## Skärm Highscore (`type: highscore`)

**Visas:** de **fem längsta körningarna utan stopp**, längst först, med kolumnerna **Körd tid** (`hh:mm:ss`), **Skiftlag** och
**Datumstämpel** (körningens start, `14/10 06:12`; annat år `31/12/25 22:00`). Rekordet (rad 1) är störst. Raden längst ned
visar **pågående körning** och hur långt det är kvar till rekordet. Beräknas i backend
([`backend/opc/highscore.py`](../backend/opc/highscore.py)), `GET /api/highscores?n=5` och WebSocket-meddelandet `highscores`.

### Körning

En **körning** är en sammanhängande period där `ProductionState` = 2 (kör). Den börjar när linjen börjar köra och slutar när
ett stopp börjar. Stopp kortare än $m$ = `HIGHSCORE_MIN_STOP_S` hoppas över (körningen fortsätter och det korta stoppet räknas
in i tiden); standard $m = 0$ betyder att **varje** stopp avslutar körningen, även ett stopp under en sekund.

$$
d = b - a, \qquad [a,\ b) \text{ innehåller inget stopp som varar } m \text{ sekunder eller längre}
$$

$a$ = tiden då `ProductionState` blev 2, $b$ = tiden då stoppet som avslutade körningen började (exakta tidsstämplar från
PLC-ändringarna, inte sekundsampling).

- **Topplistan:** de fem största $d$ bland avslutade körningar. Lika långa: den som kom först står högre.
- **Pågående körning:** $d_\text{nu} = t_\text{nu} - a$, grön, räknas upp varje sekund. Kommer den in bland de fem visas den
  i listan (grön, "PÅGÅR").
- **Rekord om** $= d_1 - d_\text{nu}$ där $d_1$ är rekordet; när $d_\text{nu} \gt d_1$ visas **"▲ NYTT REKORD"**. Utan pågående
  körning visas `–` och, om `ProductionState` är känt och inte 2, **"LINJEN STÅR"**.
- **Skiftlag** = `ShiftTeam` när körningen började. Går körningen över ett skiftbyte till ett annat lag visas båda, `A→B`.
  Utan `ShiftTeam`: `–`.
- **Markerad rad** (ljus ram, som "Idag" på 7-dagarsskärmen): körningen började i **pågående skift** (skiftloggens öppna
  skift, annars skiftfönstret från `ShiftStart`/`ShiftEnd`).

**Sparas** i tabellen `run_records`, som **inte** gallras av `RETENTION_DAYS`. Pågående körning skrivs var 5:e sekund med sin
senast bekräftade körtid. Startas backend om, eller tappas OPC-anslutningen, avslutas körningen vid den tiden: den förlängs aldrig
över tid som backend inte kunde se. Därför delas en körning av en omstart. Körningar från före uppgraderingen räknas inte
(`shift_log` kan inte skilja ett avbrott i backend från att linjen körde).

**Exempel:** linjen kör 06:00–07:00, står 5 min, kör 07:05–09:05:30. Med $m = 0$: två körningar, `01:00:00` och `02:00:30`
(rekord). Med $m$ = 600 s räknas stoppet på 5 min inte och det blir en körning `03:05:30` (06:00–09:05:30).

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
\texttt{better: high}:\ \begin{cases} \text{grön} & x \ge \text{övre} \cr \text{gul} & x \ge \text{lägre} \cr \text{röd} & \text{annars} \end{cases}
\qquad
\texttt{better: low}:\ \begin{cases} \text{grön} & x \le \text{lägre} \cr \text{gul} & x \le \text{övre} \cr \text{röd} & \text{annars} \end{cases}
$$

Gul och röd visar ▼ (`high`) eller ▲ (`low`) i rubrikraden. $x$ är värdet **avrundat till $d$ decimaler**, som det visas.

**Exempel:** `OEE` = 82,4 med `thresholds: [75, 85]` → gul `82,4 %` och ▼. `OEE` = 84,96 visas `85,0 %` och är grön.

### Trend (`trend: true`)

$$
\Delta = \mathrm{round}_d\bigl(x_\text{senaste} - x_\text{näst senaste}\bigr)
$$

- De två senaste värdena i taggens historik (varje värdeändring från PLC:n loggas; historiken laddas om var 10:e s).
- ▲ om $\Delta \gt  0$, ▼ om $\Delta \lt  0$, ● om $\Delta = 0$ efter avrundning till $d$ decimaler; visat som $|\Delta|$ med $d$ decimaler.
- **Färg:** grön när förändringen går åt det bättre hållet (`better: high` och ▲, eller `better: low` och ▼), röd åt det sämre, grå vid ●.
- Kräver minst två numeriska värden, annars visas ingen trend.

**Exempel:** OEE 81,8 → 82,4: `▲ 0,6` grön. TPM 140,0 → 138,6: `▼ 1,4` röd.

### Mål och framdriftsstapel (`target`)

$$
\text{stapel} = \min\left(1,\ \max\left(0,\ \frac{x}{\text{mål}}\right)\right)
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
- **Raster:** utan `PlannedTime` (tomt i exempelfilen idag) är hela den förflutna skifttiden planerad tid, så raster sänker
  Tillgänglighet och OEE. Med `PlannedTime` fördelas den planerade tiden jämnt över skiftet (inte vid rastens klockslag).
- **Skifttider i Skift kvar** visas i webbläsarens tidszon, skiftfönstret räknas i `TIMEZONE`. Ställ in samma zon på båda.
- **7 dagar, dagar före skiftloggen (`raw`):** skifttiderna antas vara desamma alla dagar (nuvarande `ShiftStart`/`ShiftEnd`); ändras skifttiderna räknas
  tidigare dagar som inte redan är sparade om med de nya tiderna. En skiftdel med totalt haveri (ingen körtid alls) räknas inte
  som planerad, vilket ger för hög OEE den dagen. Ökningar räknas till den tid de loggades (upplösning ≈ 1 s).
- **Skiftloggen:** ett nattskift delas efter tidsandel, inte efter när pannorna faktiskt gjordes. En rättelse av `ShiftStart`
  framåt mitt i ett skift (t.ex. 14:00 → 14:30 kl. 14:10) tolkas som ett nytt skift. Var backend nere över flera skift blir det
  ett långt skift (det gamla stängs vid det senaste skiftbytet). Parametrar som kommer mer än `SHIFT_SETTLE_S` före
  `ShiftStart` hamnar på det gamla skiftet; höj då `SHIFT_SETTLE_S`.
- **Highscore:** ändras `HIGHSCORE_MIN_STOP_S` gäller det nya körningar; sparade körningar räknas inte om. Tidsstämpeln
  visas i webbläsarens tidszon (som Skift kvar).
- **Trend efter nollställning:** när en räknare nollställs vid skiftbyte visar trenden en stor ▼ (röd för `better: high`).
