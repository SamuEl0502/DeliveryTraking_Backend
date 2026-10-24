# Delivery Tracking — Backend

Backend del sistema de rastreo de paquetes enviados en vuelos dentro de EE. UU., con la posición del avión en vivo desde [OpenSky Network](https://opensky-network.org/).

Proyecto base: *Delivery Tracking con tracking geoespacial en vivo (WebSockets, suavizado de trayectoria en el frontend y recálculo dinámico de ETA)*. El frontend (Vue 3 + Leaflet) vive en un repositorio aparte.

## Stack

- Node.js (LTS) + Express 5 + TypeScript estricto
- Zod (validación de `.env` y de parámetros)
- pino (logs JSON con `x-correlation-id`)
- Axios (para consumir OpenSky, adsbdb, Aviationstack y hexdb)
- PostgreSQL + Prisma 6 (modelo de datos, migraciones y seed)
- Próximamente: WebSocket (`ws`)

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

## Base de datos (PostgreSQL)

El backend usa PostgreSQL con Prisma 6. El esquema está en `models/schema.prisma`, las migraciones en `migrations/` y el seed en `scripts/seed.ts` (esas rutas se definen en `prisma.config.ts`). Sirve un PostgreSQL instalado en el equipo (opción A) o uno en Docker (opción B). **Docker es opcional.**

Antes de cualquier comando de base de datos hay que correr `npm install` dentro de `backend/`. Usa los scripts de npm y no `npx prisma` sin instalar: `npx` descargaría otra versión de Prisma.

### Opción A: PostgreSQL instalado en local (Windows)

1. Instalar PostgreSQL 17 o 18. El instalador crea el usuario `postgres` y pide su clave. El servicio (`postgresql-x64-18`) queda escuchando en `localhost:5432`.
2. Crear la base de datos `delivery_tracking`:
   - En DBeaver: nueva conexión PostgreSQL (host `localhost`, puerto `5432`, base `postgres`, usuario `postgres` y su clave), luego clic derecho en **Databases** → **Create New Database** → nombre `delivery_tracking`.
   - O con SQL: `CREATE DATABASE delivery_tracking;`
3. En `backend/.env`, con tu clave en lugar del relleno:
   ```
   DATABASE_URL=postgresql://postgres:TU_CLAVE@localhost:5432/delivery_tracking
   ```
4. Crear las tablas y cargar los datos de prueba:
   ```powershell
   cd backend
   npm run db:deploy    # aplica las migraciones de migrations/
   npm run db:seed      # aeropuertos, usuarios, vuelos y envíos de prueba (puede repetirse sin duplicar)
   ```
5. Revisar en DBeaver: `delivery_tracking` → Schemas → `public` → Tables. Deben aparecer `Airport`, `Flight`, `Shipment`, `TrackingEvent`, `User` y `_prisma_migrations`. Si no se ven, clic derecho → Refresh.

### Opción B: Docker (opcional)

Requiere Docker Desktop en marcha y el puerto 5432 libre. Si ya tienes PostgreSQL instalado, detén su servicio o usa la opción A.

```powershell
cd backend
npm run db:up        # levanta PostgreSQL 17 en 127.0.0.1:5432 (docker-compose.yml de la raíz)
npm run db:deploy
npm run db:seed
```

Con Docker, el `DATABASE_URL` es el que aparece comentado en `.env.example`.

### Datos de prueba del seed

| Usuario | Rol | Clave |
|---|---|---|
| `cliente@deliverytracking.test` | `CLIENT` | `Prueba123` |
| `staff@deliverytracking.test` | `STAFF` (aeropuerto ATL) | `Prueba123` |

Son solo para desarrollo: las claves se guardan con hash Argon2id. Además se cargan 8 aeropuertos (ATL, ORD, DFW, JFK, LAX, MEM, SDF y CVG), 3 vuelos, 3 envíos del cliente y sus eventos de rastreo.

Para cambiar el esquema en desarrollo: editar `models/schema.prisma` y ejecutar `npm run db:migrate` (crea una migración nueva). La base de datos solo escucha en el propio equipo; no la expongas a la red.

### Errores comunes en Windows

| Error | Causa | Solución |
|---|---|---|
| `EPERM: operation not permitted, rename ... query_engine-windows.dll.node` | OneDrive o un `npm run dev` abierto bloquean el motor de Prisma mientras se regenera | Detén el servidor, pausa la sincronización de OneDrive y vuelve a correr `npm install` (o `npx prisma generate`) |
| `P1000: Authentication failed` | Clave equivocada, o la clave tiene caracteres especiales sin codificar | Escribe los caracteres especiales con su código: `@` → `%40`, `#` → `%23`, `:` → `%3A`, `/` → `%2F`, `?` → `%3F`, `&` → `%26`, `%` → `%25`. Por ejemplo, `ab@1` queda `ab%401` |
| `P1001: Can't reach database server at localhost:5432` | El servicio de PostgreSQL está detenido | `Get-Service postgresql*` y, si está detenido, iniciarlo desde `services.msc` |
| `Bind for 127.0.0.1:5432 failed: port is already allocated` (Docker) | El PostgreSQL instalado ya usa el puerto 5432 | Usa solo uno de los dos: detén el servicio local o no levantes Docker. `Get-NetTCPConnection -LocalPort 5432` muestra quién lo ocupa |
| `P1003: Database delivery_tracking does not exist` | Falta crear la base de datos | Paso 2 de la opción A |
| `psql` no se reconoce como comando | La carpeta `bin` de PostgreSQL no está en el PATH | Usa DBeaver o la ruta completa: `& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres` |

## Variables de entorno

Definidas en [`backend/.env.example`](backend/.env.example). El servidor las valida con Zod al arrancar y no inicia si alguna es inválida. `.env` nunca se sube a Git.

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `PORT` | No | `3000` | Puerto del servidor. |
| `NODE_ENV` | No | `development` | `development`, `test` o `production`. |
| `CORS_ORIGIN` | **Sí** | — | Origen(es) del frontend permitidos, separados por coma. |
| `DATABASE_URL` | No | — | Conexión a PostgreSQL para Prisma (`postgresql://usuario:clave@host:puerto/base`). La necesitan los comandos `db:*`. Si se define, debe empezar por `postgresql://` o `postgres://`. |
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
| [adsbdb](https://github.com/mrjackwills/adsbdb) | Modelo, matrícula, foto de respaldo, aerolínea, origen y destino | Al seleccionar un avión (caché de 6 h) | Gratis, sin llave |
| [Planespotters](https://www.planespotters.net/photo/api) | Foto del avión revisada por moderadores, fotógrafo y enlace | Al seleccionar un avión (misma caché de 6 h) | Gratis, sin llave |
| Cálculo propio | Progreso, km recorridos y restantes, ETA | Al seleccionar un avión | 0 |
| [Aviationstack](https://aviationstack.com/pricing) | Ruta real del tramo activo, horarios programados/estimados/reales, retraso, terminal, puerta, estado | Solo con `/schedule` (caché de 30 min) | 1 petición (plan gratis: 100 al mes) |
| [hexdb](https://hexdb.io) | Coordenadas de los aeropuertos de Aviationstack | Con `/schedule` (caché de 30 días) | Gratis, sin llave |
| [Base de aeronaves de Mictronics](https://www.mictronics.de/aircraft-database/) (vía [tar1090-db](https://github.com/wiedehopf/tar1090-db)) | Tipo ICAO de cada avión (`B738`, `C172`...) para el icono del mapa | Se descarga sola al arrancar en `backend/data/` (8 MB, no va al repo) y vive en memoria | Gratis, sin llave |
| [OurAirports](https://ourairports.com/data/) | Aeropuertos grandes y medianos con vuelos regulares (3.269), para saber de qué aeropuerto despegó un avión | Se descarga sola al arrancar en `backend/data/` (12 MB, no va al repo) y vive en memoria | Gratis, dominio público |

Restricciones: los datos de rutas de adsbdb no se pueden copiar a otra base de datos (solo caché en memoria). El plan gratis de Aviationstack no permite uso comercial. Planespotters exige mostrar el fotógrafo con un enlace a la foto (`photographer`, `photoLink`) y no permite guardar la imagen.

La ruta de adsbdb es la asignada al indicativo y en vivo acierta poco (7 de 25 vuelos en una prueba), porque las aerolíneas reutilizan números de vuelo. La de Aviationstack es la del tramo que el avión vuela ahora, así que `/schedule` la devuelve para reemplazar a la de `/details`.

Si el recorrido de OpenSky empieza en tierra o a menos de 1.500 m, su primer punto es el despegue real. En ese caso la ruta de adsbdb solo se acepta si su origen está a menos de 30 km de ese punto y el avión apunta al destino. Un desvío por clima ya no la invalida, y un origen distinto sí. En una prueba con 20 vuelos se confirmaron 5: en los demás, adsbdb tenía otro tramo del mismo número de vuelo.

Por eso el despegue también se convierte en aeropuerto: el aeropuerto de OurAirports más cercano, a menos de 15 km, es `departure`. Si la ruta de adsbdb no encaja, el panel muestra "Despegó de …" y el destino como desconocido: no se inventa un destino. Por ejemplo, DAL803 figuraba LAX→SEA en adsbdb, pero despegó de Dallas, así que sale "Despegó de DFW". En una prueba con 20 vuelos se supo el aeropuerto de despegue de los 20. En otra con 40 vuelos de aerolínea, 7 tenían la ruta confirmada; el destino real de los demás se consulta con "Ver horarios".

La base de aeronaves de Mictronics se publica, según tar1090-db y proyectos que la usan, con licencia ODC-By 1.0, que exige citar la fuente (pendiente de confirmar en la web de Mictronics, que no respondió).

## API

Todas las respuestas son JSON y llevan el header `x-correlation-id`. Las rutas bajo `/api` tienen rate limiting (300 peticiones por IP cada 15 min); `/health` no.

| Método y ruta | Respuesta 200 |
|---|---|
| `GET /health` | `{ status: "ok", uptime, timestamp }` |
| `GET /api/aircraft` | `{ time, count, aircraft: AircraftState[] }` con los aviones sobre EE. UU. continental |
| `GET /api/aircraft/:icao24` | Un `AircraftState`. `icao24` son 6 caracteres hexadecimales (se aceptan mayúsculas). |
| `GET /api/aircraft/:icao24/details` | `{ state, aircraft, route, progress, departure }` para el panel del avión. `departure` es el aeropuerto del que despegó según OpenSky, o `null`. No gasta Aviationstack. |
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
| 404 | `NOT_FOUND`, `AIRCRAFT_NOT_FOUND`, `SCHEDULE_NOT_FOUND`, `TRACK_NOT_FOUND` |
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
models/ (Prisma)  migrations/  seed: scripts/seed.ts   repositories/  websocket/   reservadas para próximas entregas
```

Más detalle: [`backend/EXPLICACION.md`](backend/EXPLICACION.md) (resumen y preguntas frecuentes) y [`GUIA_CODIGO.md`](GUIA_CODIGO.md) (archivo por archivo).

## Qué muestra la página

La página (repositorio del frontend, `http://localhost:5173`) es un mapa a pantalla completa con un panel lateral. Cada bloque sale de un endpoint de este backend:

```
┌──────────────────────────────┬────────────────────────────────┐
│ Tarjeta "En el aire"         │ Panel del avión seleccionado   │
│  aviones sobre EE. UU.       │                                │
│  y hora de actualización     │  1. Cabecera                   │
│                              │  2. Ruta y progreso            │
│ Mapa (Leaflet + OSM)         │  3. Avión                      │
│  un avión por marcador,      │  4. Horarios (con botón)       │
│  rotado según su rumbo,      │  5. Datos en vivo              │
│  con movimiento suave        │                                │
└──────────────────────────────┴────────────────────────────────┘
```

| Zona | Qué muestra | Endpoint | Fuente |
|---|---|---|---|
| Tarjeta y mapa | Aviones sobre EE. UU. (polling cada 10 s, pausado si la pestaña está oculta), aviso de error si el backend no responde | `GET /api/aircraft` | OpenSky |
| 1. Cabecera | Número de vuelo (UA251), aerolínea, "En el aire" / "En tierra" / "Señal perdida" | `/details` | adsbdb + OpenSky |
| 2. Ruta y progreso | Origen → destino (IATA y ciudad), barra de progreso, km recorridos y restantes, "Llega en ~X h Y min". Si la ruta no encaja con la posición: "Ruta no verificada", sin barra. Si no hay ruta: "Ruta no disponible" | `/details` | adsbdb + cálculo propio |
| 3. Avión | Foto, modelo y matrícula | `/details` | adsbdb |
| 4. Horarios | Solo al pulsar "Ver horarios": ruta real del tramo activo (reemplaza a la del bloque 2), salida y llegada con hora real, estimada o programada, retraso, terminal y puerta. Muestra "Horarios: Aviationstack" | `/schedule` | Aviationstack + hexdb |
| 5. Datos en vivo | Velocidad (km/h y kt), altitud (m y ft), rumbo, posición, hora de la última posición | `GET /api/aircraft` (store) | OpenSky |

`/details` se pide una vez por selección; `/schedule`, solo con el botón. Si cualquiera falla, el panel sigue mostrando los datos en vivo.

## Estado actual

Actualizado el 2026-10-19. Backend y frontend sincronizados en `main` (backend PR #2, frontend PR #1 y #2).

| Bloque del plan | Estado |
|---|---|
| 0. Preparación | Hecho (falta confirmar PostgreSQL) |
| 1. Esqueleto del backend | Hecho |
| 2. OpenSky | Hecho |
| 3. Frontend con mapa | Hecho (repositorio del frontend) |
| 4. Movimiento suave | Hecho (repositorio del frontend) |
| Extra: panel con ruta y horarios | Hecho (`/details`, `/schedule`) |
| 5. Modelo de datos (Prisma + PostgreSQL) | **Siguiente** |
| 6. WebSocket | Pendiente |
| Cierre (capturas, prueba desde cero, ensayo) | Pendiente |

**Funciona hoy**
- `GET /health`, con el header `x-correlation-id` y logs estructurados.
- `GET /api/aircraft`: aviones reales sobre EE. UU. desde OpenSky (OAuth2 o anónimo, según el `.env`), con caché en memoria. Si OpenSky va lento, se responde al instante con el último dato y se refresca en segundo plano (tope de 45 s por descarga).
- `GET /api/aircraft/:icao24`: un avión concreto, con validación Zod. Se busca primero en la lista ya en caché, así que no gasta créditos de OpenSky.
- `GET /api/aircraft/:icao24/details`: avión, ruta, progreso y ETA para el panel (adsbdb + cálculo propio). La foto viene de Planespotters, con el fotógrafo y el enlace para los créditos.
- `GET /api/aircraft/:icao24/schedule`: ruta real, horarios, retraso, terminal y puerta bajo demanda (Aviationstack + hexdb).
- Manejo global de errores con formato JSON único, `helmet`, CORS y rate limiting.
- Plan B de demo con datos grabados (`USE_FIXTURE=true`).
- `npm run check`: prueba la geometría del panel y la lectura de Aviationstack con respuestas reales.

**Viene después**
- Modelo de datos con Prisma y PostgreSQL (migraciones y seed de aeropuertos).
- Autenticación con doble token y roles (Cliente y Staff).
- Envíos y eventos de rastreo, con estados automáticos de despegue y aterrizaje.
- WebSocket con un canal por vuelo.
- ETA con retrasos acumulados y por WebSocket.

## Cambios importantes en la API

Lo que cambió respecto al contrato inicial y por qué. Si el frontend usa algo de esta lista, debe estar al día.

| Fecha | PR | Cambio | Motivo |
|---|---|---|---|
| 2026-10-19 | #1 | Contrato de la API documentado en este README (endpoints, `AircraftState`, errores) | Trabajar backend y frontend en paralelo |
| 2026-10-19 | #2 | Nuevo `GET /api/aircraft/:icao24/details` | Panel estilo FlightRadar24: avión, ruta, progreso y ETA |
| 2026-10-19 | #2 | Nuevo `GET /api/aircraft/:icao24/schedule` | Horarios, puertas y ruta real solo bajo demanda, para cuidar el cupo |
| 2026-10-19 | #2 | `GET /api/aircraft/:icao24` busca primero en la lista ya en caché | Seleccionar un avión ya no gasta créditos de OpenSky |
| 2026-10-19 | #2 | La ruta de adsbdb se verifica por desvío (≤ 20 %) y por rumbo (≤ 90° del destino); si no encaja, `verified: false` y sin progreso | adsbdb acierta ~30 % en vivo; UAL19 salía como JFK→SFO sobre el Atlántico |
| 2026-10-19 | #2 | AeroDataBox descartado; se usa Aviationstack (`AVIATIONSTACK_API_KEY`) | La llave de AeroDataBox era del acceso directo, que no tiene plan gratis |
| 2026-10-19 | #2 | `/schedule` devuelve `route` y `progress` con la ruta real del tramo activo | Corrige la ruta de adsbdb (AAL3304: BOS→PHL era falso; el real es MIA→ORD) |
| 2026-10-19 | #2 | Horas de Aviationstack convertidas de hora local a UTC | Aviationstack marca como `+00:00` la hora local del aeropuerto |
| 2026-10-19 | #2 | En códigos compartidos se usan el número y la aerolínea del operador | Se mostraba "EI7399 · Aer Lingus" en un vuelo de American |
| 2026-10-19 | #2 | Nuevos errores `AVIATIONSTACK_*` y `SCHEDULE_NOT_FOUND` | Errores de la nueva fuente con el formato único |
| 2026-10-20 | — | Si OpenSky va lento, `GET /api/aircraft` responde al instante con el dato anterior de la caché y lo refresca en segundo plano (tope de 45 s por descarga) | OpenSky mandaba la lista a goteo: tardaba ~58 s y el frontend se rendía a los 8 s |
| 2026-10-22 | #5 | Modelo de datos con Prisma (`User`, `Airport`, `Flight`, `Shipment`, `TrackingEvent`), migración inicial y seed. No cambia ningún endpoint | Base para usuarios, vuelos y envíos de las próximas entregas |
| 2026-10-22 | #6 | En `/details`, `aircraft` trae `photoUrl`, `photoThumbnailUrl`, `photoLink` y `photographer` de Planespotters. Si Planespotters no tiene foto, se usa la de adsbdb y `photoLink` y `photographer` llegan `null` | Las fotos de adsbdb a veces mostraban cabinas u otro avión; Planespotters exige mostrar el fotógrafo con enlace |
| 2026-10-22 | #7 | Nuevo campo `type` en cada `AircraftState` (tipo ICAO, por ejemplo `B738`; `null` si no se conoce) | Elegir el ícono del avión en el mapa |
| 2026-10-22 | #8 | Nuevo `GET /api/aircraft/:icao24/track` con el recorrido desde el despegue (`{ icao24, callsign, path: TrackPoint[] }`) y error `TRACK_NOT_FOUND` | Estela del vuelo con colores por altitud |
| 2026-10-22 | #8 | Nuevo campo `departure` en `/details`: aeropuerto real del despegue (OurAirports), o `null`. La ruta de adsbdb solo se confirma si su origen está a menos de 30 km de ese despegue | adsbdb suele traer otro tramo del mismo número de vuelo; así no se inventa un destino |
