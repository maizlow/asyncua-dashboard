# Drift: en port för TV, editor och API

I drift serverar backend (FastAPI/uvicorn) allt från **en port**, som standard `8000`:

| Sökväg | Vad | Inloggning |
|---|---|---|
| `/`, `/?display=tv2` | TV-vyn (kioskwebbläsaren) | nej |
| `/editor/` | layout-editorn | ja, för allt som läser eller ändrar något (`/api/editor/…`) |
| `/api/…` | REST-API:t (TV:n läser layout, larm och historik) | bara `/api/editor/…` |
| `/ws` | WebSocket med livevärden till TV:n | nej |
| `/api/health` | enkel hälsokontroll: `{"status": "ok", "frontend": true, "opc_connected": …}` | nej |
| `/docs` | API-dokumentationen (Swagger) | nej |

Sidorna i sig (HTML, JavaScript) innehåller inga data eller hemligheter. Det är samma kod som den publika demon.
Editorn visar inloggningen och hämtar inget förrän du är inloggad. Det finns ingen HTTPS än, se
[Känd begränsning](#känd-begränsning-ingen-https).

## Bygga och starta

```bash
cd frontend && npm ci && npm run build   # vanliga bygget (base "/"), inte demobygget
cd .. && python -m backend.app.main      # TV på http://<dator>:8000/, editorn på http://<dator>:8000/editor/
```

- **Bygget:** `npm run build` skriver `frontend/dist/`, med `index.html` (TV), `editor/index.html` (editorn) och
  `assets/`. Bygg **inte** med `VITE_DEMO`/`VITE_BASE`: då blir det Pages-demon med simulerade värden. Backend vägrar inte,
  men testet `test_real_build_references_resolve` upptäcker ett demobygge i `dist/`.
- **Saknas bygget** loggar backend en varning och serverar bara API:t (`/` svarar då med ett JSON-meddelande). Det är
  normalt under utveckling, när Vite kör på port 5173 och proxar `/api` och `/ws` till 8000.
- **Inställningar** i `.env`:

| Variabel | Standard | Beskrivning |
|---|---|---|
| `HTTP_HOST` | `0.0.0.0` | Adressen servern lyssnar på. `127.0.0.1` när en HTTPS-proxy ligger framför (se nedan). |
| `HTTP_PORT` | `8000` | Porten för allt ovan. |
| `FRONTEND_DIST` | `frontend/dist` | Var bygget ligger. En relativ sökväg räknas från projektets rotmapp. |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxyer vars `X-Forwarded-Proto`/`-For` litas på. Behövs bara med en proxy framför. |

**Cache:** filerna i `assets/` har hash i namnet och skickas med `Cache-Control: public, max-age=31536000, immutable`.
Allt annat (sidorna, `favicon.svg`, logotyperna) skickas med `no-cache`. Webbläsaren frågar alltså om sidan varje gång
och får ett billigt `304`. Efter en ny version räcker det att ladda om sidan, och TV:n behöver aldrig tömma sin cache.

**Sökvägar som inte finns:**
- `/editor/<något>` ger editorns sida och `/<något>` TV-vyn (klientsidans routing).
- En fil som saknas, t.ex. en `assets/…` från ett äldre bygge, ger `404`. Den får aldrig en HTML-sida som om den vore
  JavaScript.
- Okända `/api/…` ger `404` som JSON. API- och WebSocket-vägarna ligger alltid före filerna.

## Docker

Det finns ingen Docker-image i repot än. Den är planerad, se "Docker för drift på Fitlet3" i [ROADMAP](../ROADMAP.md).
Uppläggget ovan är gjort för att passa den:

1. **Steg 1 (node):** kör `npm ci && npm run build` i `frontend/`.
2. **Steg 2 (python):** kopiera `backend/` och `frontend/dist/` till imagen, eller sätt `FRONTEND_DIST`. Exponera port
   `8000` och kör `python -m backend.app.main`.
3. **Hälsokontroll:** `HEALTHCHECK` mot `http://127.0.0.1:8000/api/health`.
4. **Monteras in:** `.env`, `certificates/` och databasen (`DB_PATH`).

## Känd begränsning: ingen HTTPS

Allt går i dag över **okrypterad HTTP** på fabriksnätet. Det betyder:

- **Lösenordet:** när du loggar in i editorn skickas namn och lösenord i klartext. Den som kan avlyssna trafiken mellan
  datorn och servern kan läsa dem. Det gäller t.ex. en dator på samma nät eller VLAN, en speglad switchport eller en
  kapad enhet.
- **Sessionskakan** (`aud_editor`) skickas också i klartext, med varje anrop till `/api/editor/…`. Den som snappar upp
  den kan använda editorn som du tills sessionen går ut (12 h) eller du loggar ut. Den kan då publicera layouter och läsa
  i PLC:n via bläddringen. Ingen kan skriva till PLC:n via editorn, för den koden finns inte.
- **Kakans skydd:** den har `HttpOnly` och `SameSite=Strict` men inte `Secure`, eftersom `Secure` kräver HTTPS. Med HTTPS
  sätts den automatiskt, se nedan.
- **TV:n** visar bara det som redan syns på skärmarna. Där skyddar kryptering inget hemligt.

Så länge det inte finns HTTPS:

- **Begränsa nätet:** gör port 8000 nåbar bara från TV-datorerna och de datorer som ska köra editorn (VLAN eller
  brandvägg). Exponera den aldrig mot internet.
- **Lösenordet:** använd ett eget lösenord för editorn. Återanvänd det inte från Windows, OPC-användaren eller något
  annat.
- **Logga ut** när du är klar. Det tar bort sessionen på servern, så en uppsnappad kaka slutar fungera.
  `python -m backend.users passwd <namn>` loggar ut alla sessioner.

## Lägga till HTTPS senare

**Rekommenderat: en TLS-proxy framför**, på samma dator, t.ex. Caddy eller nginx. Den tar emot `https://` och skickar
vidare till `http://127.0.0.1:8000`. Ingen kodändring behövs:

1. **Lyssna lokalt:** sätt `HTTP_HOST=127.0.0.1` så att den okrypterade porten bara nås från proxyn.
2. **Lita på proxyn:** behåll `FORWARDED_ALLOW_IPS=127.0.0.1`. Uvicorn litar då på proxyns `X-Forwarded-Proto: https`
   och `X-Forwarded-For`. Det har tre följder:
   - sessionskakan får `Secure` av sig själv (testat i `test_cookie_is_secure_only_over_https`);
   - spärren efter 5 felaktiga inloggningar räknas per riktig klientadress, inte per proxy;
   - TV:n kopplar `wss://…/ws` av sig själv, eftersom den använder sidans protokoll.
3. **Certifikatet:** skaffa ett från företagets interna CA, eller ett självsignerat. TV-datorernas och de bärbara
   datorernas webbläsare måste lita på det, annars visar kioskläget en varning i stället för dashboarden.
   Med ett självsignerat certifikat: lägg in det i datorernas certifikatarkiv, och slå inte på HSTS.

Exempel med Caddy (`/etc/caddy/Caddyfile`):

```
dashboard.fabrik.local {
    tls /etc/caddy/certs/dashboard.crt /etc/caddy/certs/dashboard.key
    reverse_proxy 127.0.0.1:8000
}
```

Caddy skickar `X-Forwarded-Proto` och hanterar WebSocket utan extra inställningar. Med nginx behövs
`proxy_set_header X-Forwarded-Proto $scheme;`, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` och, för
`/ws`, `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`.

**Alternativ utan proxy:** uvicorn kan själv köra TLS (`ssl_certfile`/`ssl_keyfile`). Det kräver två nya inställningar i
`backend/app/api_server.py`. Det är enklare men ger ingen omdirigering från `http://`.

Vill man att TV:erna ska stanna på HTTP medan editorn kör HTTPS kan proxyn lyssna på båda. Säkrast är ändå att allt går
via HTTPS.
