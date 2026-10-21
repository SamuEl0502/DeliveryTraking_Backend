# Delivery Tracking — Backend

Backend del sistema de rastreo de paquetes enviados en vuelos dentro de EE. UU., con la posición del avión en vivo desde [OpenSky Network](https://opensky-network.org/).

Proyecto base: *Delivery Tracking con tracking geoespacial en vivo (WebSockets, suavizado de trayectoria en el frontend y recálculo dinámico de ETA)*. El frontend (Vue 3 + Leaflet) vive en un repositorio aparte.

## Stack

- Node.js (LTS) + Express 5 + TypeScript estricto
- Zod (validación de `.env` y de parámetros)
- pino (logs JSON con `x-correlation-id`)
- Axios (para consumir OpenSky, adsbdb, Aviationstack y hexdb)
- Próximamente: PostgreSQL + Prisma y WebSocket (`ws`)

## Requisitos

- Node.js LTS y npm
- (Opcional) Cuenta de OpenSky con credenciales OAuth2. Sin ellas el backend funciona en modo anónimo, con un cupo diario menor.
- (Opcional) Llave de [Aviationstack](https://aviationstack.com) (plan gratis: 100 peticiones al mes) para los horarios y la ruta real. Sin llave, el resto funciona.

## Instalación y ejecución (PowerShell)

```powershell
cd backend
npm install
Copy-Item .env.example .env   # luego completa los valores en .env
npm run dev                   # servidor en http://localhost:3000
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca el servidor con `tsx` y lo reinicia al guardar un archivo. |
| `npm run typecheck` | Revisa los tipos con TypeScript (`tsc --noEmit`). |
| `npm run check` | Prueba rápida del panel: progreso, ETA, elección del vuelo de Aviationstack y conversión de horas. |
| `npm run fixture:save` | Guarda una respuesta real de OpenSky en `fixtures/opensky-sample.json`. |

Prueba rápida:

```powershell
curl.exe -i http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/api/aircraft | Select-Object count
```

## Variables de entorno

Definidas en [`backend/.env.example`](backend/.env.example). El servidor las valida con Zod al arrancar y no inicia si alguna es inválida. `.env` nunca se sube a Git.

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `PORT` | No | `3000` | Puerto del servidor. |
| `NODE_ENV` | No | `development` | `development`, `test` o `production`. |
| `CORS_ORIGIN` | **Sí** | — | Origen(es) del frontend permitidos, separados por coma. |
| `DATABASE_URL` | No | — | Conexión a PostgreSQL (se usará con Prisma). |
| `OPENSKY_CLIENT_ID` | No | — | Client id OAuth2 de OpenSky. Vacío = modo anónimo. |
| `OPENSKY_CLIENT_SECRET` | No | — | Client secret OAuth2 de OpenSky. |
| `OPENSKY_CACHE_TTL_MS` | No | `10000` | Vida de la caché de OpenSky en ms (mínimo `10000`; la plantilla trae `30000` para ahorrar cuota). |
| `LOG_LEVEL` | No | `info` | `fatal`, `error`, `warn`, `info`, `debug` o `trace`. |
| `AVIATIONSTACK_API_KEY` | No | — | Llave de Aviationstack. Vacía = horarios deshabilitados (503). |
| `USE_FIXTURE` | No | `false` | `true` sirve los datos grabados en vez de llamar a OpenSky (plan B de demo). |

## Fuentes de datos

Cada dato sale de la fuente más barata. Las APIs externas solo se llaman desde el backend.

| Fuente | Qué da | Cuándo se llama | Costo |
|---|---|---|---|
| [OpenSky](https://openskynetwork.github.io/opensky-api/rest.html) | Posición, altitud, velocidad, rumbo, en tierra | Lista de EE. UU. con caché de `OPENSKY_CACHE_TTL_MS` | 4 créditos por consulta |
| [adsbdb](https://github.com/mrjackwills/adsbdb) | Modelo, matrícula, foto, aerolínea, origen y destino | Al seleccionar un avión (caché de 6 h) | Gratis, sin llave |
| Cálculo propio | Progreso, km recorridos y restantes, ETA | Al seleccionar un avión | 0 |
| [Aviationstack](https://aviationstack.com/pricing) | Ruta real del tramo activo, horarios programados/estimados/reales, retraso, terminal, puerta, estado | Solo con `/schedule` (caché de 30 min) | 1 petición (plan gratis: 100 al mes) |
| [hexdb](https://hexdb.io) | Coordenadas de los aeropuertos de Aviationstack | Con `/schedule` (caché de 30 días) | Gratis, sin llave |
| [Base de aeronaves de Mictronics](https://www.mictronics.de/aircraft-database/) (vía [tar1090-db](https://github.com/wiedehopf/tar1090-db)) | Tipo ICAO de cada avión (`B738`, `C172`...) para el icono del mapa | Se descarga sola al arrancar en `backend/data/` (8 MB, no va al repo) y vive en memoria | Gratis, sin llave |

Restricciones: los datos de rutas de adsbdb no se pueden copiar a otra base de datos (solo caché en memoria). El plan gratis de Aviationstack no permite uso comercial.

La ruta de adsbdb es la asignada al indicativo y en vivo acierta poco (7 de 25 vuelos en una prueba), porque las aerolíneas reutilizan números de vuelo. La de Aviationstack es la del tramo que el avión vuela ahora, así que `/schedule` la devuelve para reemplazar a la de `/details`.

Si el recorrido de OpenSky empieza en tierra o a menos de 1.500 m, su primer punto es el despegue real. En ese caso la ruta de adsbdb solo se acepta si su origen está a menos de 30 km de ese punto y el avión apunta al destino. Un desvío por clima ya no la invalida, y un origen distinto sí. En una prueba con 20 vuelos se confirmaron 5: en los demás, adsbdb tenía otro tramo del mismo número de vuelo.

La base de aeronaves de Mictronics se publica, según tar1090-db y proyectos que la usan, con licencia ODC-By 1.0, que exige citar la fuente (pendiente de confirmar en la web de Mictronics, que no respondió).

## API

Todas las respuestas son JSON y llevan el header `x-correlation-id`. Las rutas bajo `/api` tienen rate limiting (300 peticiones por IP cada 15 min); `/health` no.

| Método y ruta | Respuesta 200 |
|---|---|
| `GET /health` | `{ status: "ok", uptime, timestamp }` |
| `GET /api/aircraft` | `{ time, count, aircraft: AircraftState[] }` con los aviones sobre EE. UU. continental |
| `GET /api/aircraft/:icao24` | Un `AircraftState`. `icao24` son 6 caracteres hexadecimales (se aceptan mayúsculas). |
| `GET /api/aircraft/:icao24/details` | `{ state, aircraft, route, progress }` para el panel del avión. No gasta Aviationstack. |
| `GET /api/aircraft/:icao24/track` | `{ icao24, callsign, path: TrackPoint[] }`: recorrido del vuelo actual desde el despegue, con altitud en cada punto, para la estela por colores. 4 créditos de OpenSky de su propia cuenta y caché de 1 min. 404 `TRACK_NOT_FOUND` si OpenSky no lo tiene. |
| `GET /api/aircraft/:icao24/schedule` | `{ flightNumber, airline, status, departure, arrival, route, progress, source }`. Única ruta que gasta Aviationstack. |

`AircraftState` ([`backend/types/aircraft.ts`](backend/types/aircraft.ts)):

| Campo | Tipo | Unidad / nota |
|---|---|---|
| `icao24` | `string` | Código del transpondedor, en minúsculas. |
| `callsign` | `string \| null` | Indicativo sin espacios; `null` si viene vacío. |
| `lat`, `lng` | `number` | Grados. Los aviones sin posición se descartan. |
| `hdg` | `number \| null` | Rumbo en grados desde el norte, sentido horario. |
| `spd` | `number \| null` | m/s. |
| `alt` | `number \| null` | Metros (barométrica; si falta, geométrica). |
| `onGround` | `boolean` | En tierra o en el aire. |
| `type` | `string \| null` | Tipo ICAO del avión (`B738`, `A321`, `C172`). `null` si no está en la base de aeronaves o si aún no terminó de cargar. |
| `ts` | `number` | Unix en segundos (`time_position` o, si falta, `last_contact`). |

`time` es el momento del lote según OpenSky, en Unix segundos.

Los tipos de `/details` y `/schedule` están en [`backend/types/flightDetails.ts`](backend/types/flightDetails.ts). Detalles importantes:
- `aircraft` y `route` son `null` si adsbdb no los conoce (por ejemplo, aviones privados). Si adsbdb falla, también llegan `null` y el resto de la respuesta sigue igual.
- `route.verified` es `false` si la posición del avión no encaja con la ruta (desvío mayor al 20 %, o rumbo a más de 90° del destino). En ese caso `progress` es `null`.
- `progress.etaMinutes` es una estimación en línea recta a la velocidad actual; `null` en tierra o sin velocidad.
- En `/schedule`, las horas van en ISO 8601 UTC. Aviationstack las manda en hora local del aeropuerto marcadas como `+00:00`; el backend las convierte con la zona horaria de cada aeropuerto.
- En `/schedule`, `route.origin.city` y `route.destination.city` son `null` (hexdb no da la ciudad).

**Errores:** siempre `{ error: { code, message, correlationId } }`.

| HTTP | `code` |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON` |
| 404 | `NOT_FOUND`, `AIRCRAFT_NOT_FOUND`, `SCHEDULE_NOT_FOUND` |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `FIXTURE_MISSING`, `INTERNAL_ERROR` |
| 502 | `OPENSKY_UNAVAILABLE`, `OPENSKY_AUTH_FAILED`, `OPENSKY_BAD_RESPONSE`, `AVIATIONSTACK_UNAVAILABLE`, `AVIATIONSTACK_AUTH_FAILED`, `AVIATIONSTACK_BAD_RESPONSE` |
| 503 | `OPENSKY_QUOTA_EXCEEDED`, `AVIATIONSTACK_QUOTA_EXCEEDED`, `AVIATIONSTACK_DISABLED` |
| 504 | `OPENSKY_TIMEOUT`, `AVIATIONSTACK_TIMEOUT` |

Si OpenSky falla y la caché tiene un dato anterior, se responde ese dato en vez del error.

## Estructura (`backend/`)

```
server.ts / app.ts   arranque del servidor / configuración de Express
config/              env (validado con Zod) y logger
middlewares/         correlationId, rateLimiter, validate, errorHandler
routes/ -> (validate) -> controllers/ -> services/ -> providers/ | repositories/
validators/          esquemas Zod
types/  utils/       contratos (AircraftState), AppError, caché TTL
fixtures/  scripts/  respuesta real de OpenSky y script para regenerarla
models/  repositories/  migrations/  websocket/   reservadas para próximas entregas
```

Más detalle: [`backend/EXPLICACION.md`](backend/EXPLICACION.md) (resumen y preguntas frecuentes) y [`GUIA_CODIGO.md`](GUIA_CODIGO.md) (archivo por archivo).

## Estado actual

**Funciona hoy (Entrega 1, Bloques 1 y 2)**
- `GET /health`, con el header `x-correlation-id` y logs estructurados.
- `GET /api/aircraft`: aviones reales sobre EE. UU. desde OpenSky (OAuth2 o anónimo, según el `.env`), con caché en memoria. Si OpenSky va lento, se responde al instante con el último dato y se refresca en segundo plano (tope de 45 s por descarga).
- `GET /api/aircraft/:icao24`: un avión concreto, con validación Zod. Se busca primero en la lista ya en caché, así que no gasta créditos de OpenSky.
- `GET /api/aircraft/:icao24/details`: avión, ruta, progreso y ETA para el panel (adsbdb + cálculo propio).
- `GET /api/aircraft/:icao24/schedule`: ruta real, horarios, retraso, terminal y puerta bajo demanda (Aviationstack + hexdb).
- Manejo global de errores con formato JSON único, `helmet`, CORS y rate limiting.
- Plan B de demo con datos grabados (`USE_FIXTURE=true`).

**Viene después**
- Modelo de datos con Prisma y PostgreSQL (migraciones y seed de aeropuertos).
- Autenticación con doble token y roles (Cliente y Staff).
- Envíos y eventos de rastreo, con estados automáticos de despegue y aterrizaje.
- WebSocket con un canal por vuelo.
- ETA con retrasos acumulados y por WebSocket.
