# Delivery Tracking — Backend

Backend del sistema de rastreo de paquetes enviados en vuelos dentro de EE. UU., con la posición del avión en vivo desde [OpenSky Network](https://opensky-network.org/).

Proyecto base: *Delivery Tracking con tracking geoespacial en vivo (WebSockets, suavizado de trayectoria en el frontend y recálculo dinámico de ETA)*. El frontend (Vue 3 + Leaflet) vive en un repositorio aparte.

## Stack

- Node.js (LTS) + Express 5 + TypeScript estricto
- Zod (validación de `.env` y de parámetros)
- pino (logs JSON con `x-correlation-id`)
- Axios (solo para consumir OpenSky)
- Próximamente: PostgreSQL + Prisma y WebSocket (`ws`)

## Requisitos

- Node.js LTS y npm
- (Opcional) Cuenta de OpenSky con credenciales OAuth2. Sin ellas el backend funciona en modo anónimo, con un cupo diario menor.

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
| `USE_FIXTURE` | No | `false` | `true` sirve los datos grabados en vez de llamar a OpenSky (plan B de demo). |

## API

Todas las respuestas son JSON y llevan el header `x-correlation-id`. Las rutas bajo `/api` tienen rate limiting (300 peticiones por IP cada 15 min); `/health` no.

| Método y ruta | Respuesta 200 |
|---|---|
| `GET /health` | `{ status: "ok", uptime, timestamp }` |
| `GET /api/aircraft` | `{ time, count, aircraft: AircraftState[] }` con los aviones sobre EE. UU. continental |
| `GET /api/aircraft/:icao24` | Un `AircraftState`. `icao24` son 6 caracteres hexadecimales (se aceptan mayúsculas). |

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
| `ts` | `number` | Unix en segundos (`time_position` o, si falta, `last_contact`). |

`time` es el momento del lote según OpenSky, en Unix segundos.

**Errores:** siempre `{ error: { code, message, correlationId } }`.

| HTTP | `code` |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON` |
| 404 | `NOT_FOUND`, `AIRCRAFT_NOT_FOUND` |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `FIXTURE_MISSING`, `INTERNAL_ERROR` |
| 502 | `OPENSKY_UNAVAILABLE`, `OPENSKY_AUTH_FAILED`, `OPENSKY_BAD_RESPONSE` |
| 503 | `OPENSKY_QUOTA_EXCEEDED` |
| 504 | `OPENSKY_TIMEOUT` |

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
- `GET /api/aircraft`: aviones reales sobre EE. UU. desde OpenSky (OAuth2 o anónimo, según el `.env`), con caché en memoria.
- `GET /api/aircraft/:icao24`: un avión concreto, con validación Zod.
- Manejo global de errores con formato JSON único, `helmet`, CORS y rate limiting.
- Plan B de demo con datos grabados (`USE_FIXTURE=true`).

**Viene después**
- Modelo de datos con Prisma y PostgreSQL (migraciones y seed de aeropuertos).
- Autenticación con doble token y roles (Cliente y Staff).
- Envíos y eventos de rastreo, con estados automáticos de despegue y aterrizaje.
- WebSocket con un canal por vuelo.
- Cálculo de ETA en vivo.
