# Guía del código (backend)

Guía para entender y explicar cada archivo del backend. Se basa en el código real del repo. Este repositorio **solo contiene el backend**; el frontend (Vue + mapa) vive en otro repositorio y no se describe aquí.

**Recorrido de una petición en este backend:**

```
cliente -> server.ts -> app.ts -> middlewares -> route -> (validate) -> controller -> service -> provider -> OpenSky
```

Las respuestas y los errores vuelven por el mismo camino. Los errores terminan en `errorHandler`.

---

## Índice

1. [Configuración](#1-configuración): `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`
2. [Arranque](#2-arranque): `server.ts`, `app.ts`
3. [Config compartida](#3-config-compartida): `config/env.ts`, `config/logger.ts`
4. [Middlewares](#4-middlewares): `correlationId.ts`, `rateLimiter.ts`, `validate.ts`, `errorHandler.ts`
5. [Routes](#5-routes): `health.routes.ts`, `aircraft.routes.ts`
6. [Validators](#6-validators): `aircraft.validator.ts`
7. [Controllers](#7-controllers): `health.controller.ts`, `aircraft.controller.ts`
8. [Services](#8-services): `aircraft.service.ts`
9. [Providers](#9-providers): `openSky.provider.ts`
10. [Types](#10-types): `aircraft.ts`, `express.d.ts`
11. [Utils](#11-utils): `AppError.ts`, `ttlCache.ts`
12. [Scripts y datos](#12-scripts-y-datos): `saveFixture.ts`, `opensky-sample.json`
13. [Recorrido completo de un dato](#13-recorrido-completo-de-un-dato)
14. [Glosario](#14-glosario)
15. [Si el profesor pide X, dónde toco](#15-si-el-profesor-pide-x-dónde-toco)

---

## 1. Configuración

### `backend/package.json`
**Para qué existe:** describe el proyecto Node, sus dependencias y sus comandos.
**Dónde encaja:** fuera del recorrido; es la configuración del proyecto.

| Parte | Qué hace |
|---|---|
| `"type": "module"` | El proyecto usa módulos ES (`import`/`export`) en vez de `require`. |
| `scripts.dev` | `tsx watch server.ts`: arranca el servidor y lo reinicia al guardar un archivo. |
| `scripts.typecheck` | `tsc --noEmit`: revisa los tipos sin generar archivos `.js`. |
| `scripts.fixture:save` | Ejecuta `scripts/saveFixture.ts` para grabar una respuesta real de OpenSky. |
| `dependencies` | Lo que el servidor necesita para funcionar: `express`, `zod`, `dotenv`, `helmet`, `cors`, `express-rate-limit`, `pino`, `axios`. |
| `devDependencies` | Solo para desarrollar: `typescript`, `tsx` y los tipos `@types/*`. |

### `backend/tsconfig.json`
**Para qué existe:** le dice a TypeScript cómo revisar el código.
**Dónde encaja:** fuera del recorrido; configuración de compilación.

| Opción | Qué hace |
|---|---|
| `strict: true` | Activa todas las revisiones estrictas (por ejemplo, no deja usar un valor que puede ser `null` sin comprobarlo). |
| `module` / `moduleResolution: "nodenext"` | Resuelve los `import` igual que Node moderno. |
| `noEmit: true` | `tsc` solo revisa tipos; quien ejecuta el código es `tsx`. |
| `allowImportingTsExtensions` | Permite escribir `import ... from './app.ts'` con extensión `.ts`. |
| `verbatimModuleSyntax` | Obliga a usar `import type` cuando solo se importa un tipo. |
| `noUncheckedIndexedAccess` | Leer `arreglo[i]` da `T \| undefined`: obliga a comprobar que el elemento existe. |
| `skipLibCheck` | No revisa los tipos de las librerías de `node_modules` (más rápido). |
| `include: ["**/*.ts"]` | Revisa todos los `.ts` del backend, incluido `types/express.d.ts`. |

### `backend/.env.example`
**Para qué existe:** plantilla de las variables de entorno, sin secretos. Se copia a `.env` y se completa.
**Dónde encaja:** fuera del recorrido; `config/env.ts` lee esas variables al arrancar.

| Variable | Qué controla |
|---|---|
| `PORT` | Puerto del servidor (por defecto 3000). |
| `NODE_ENV` | `development`, `test` o `production`. |
| `CORS_ORIGIN` | Qué orígenes (frontends) pueden llamar a la API. Es la única obligatoria. |
| `DATABASE_URL` | Conexión a PostgreSQL. Hoy no se usa; se usará con Prisma. |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | Credenciales OAuth2 de OpenSky. Si faltan, se usa el modo anónimo. |
| `OPENSKY_CACHE_TTL_MS` | Cuánto dura un dato en la caché (mínimo y por defecto 10000 ms; la plantilla trae 30000). |
| `LOG_LEVEL` | Qué tan detallados son los logs. |
| `USE_FIXTURE` | `true` sirve el archivo grabado en vez de llamar a OpenSky (plan B). |

### `.gitignore` (raíz)
Ignora `.env` (secretos) y `node_modules/` (dependencias que se reinstalan con `npm install`).

---

## 2. Arranque

### `backend/server.ts`
**Para qué existe:** es el punto de entrada; pone la aplicación a escuchar en un puerto.
**Dónde encaja:** antes de todo el recorrido; recibe las conexiones y se las pasa a `app`.

| Elemento | Recibe | Devuelve | Qué hace | Quién lo llama |
|---|---|---|---|---|
| `app.listen(env.PORT, ...)` | puerto y callback | el servidor HTTP (`server`) | Abre el puerto y escribe el log `"server started"`. | Se ejecuta al iniciar el archivo (`npm run dev`). |
| `shutdown(signal)` | nombre de la señal (`"SIGINT"` o `"SIGTERM"`) | nada | Escribe `"shutting down"`, deja terminar las peticiones en curso (`server.close`) y sale del proceso. | Node, al presionar Ctrl+C (SIGINT) o al recibir SIGTERM. |

### `backend/app.ts`
**Para qué existe:** arma la aplicación Express: qué middlewares corren, en qué orden y qué rutas existen. No abre ningún puerto.
**Dónde encaja:** es el recorrido en sí; define el orden por el que pasa cada petición.

No tiene funciones propias; exporta `app`. El orden de los `app.use` es:

1. `correlationId`: primero, para que todo lo demás tenga id.
2. `helmet()`: headers de seguridad.
3. `cors(...)`: permite solo los orígenes de `CORS_ORIGIN`. Si hay varios separados por coma, los divide.
4. `express.json({ limit: '100kb' })`: lee cuerpos JSON de hasta 100 KB.
5. `/health` → `healthRouter`. Va antes del rate limiter, así que `/health` no tiene límite.
6. `/api` → `rateLimiter`: el límite aplica a todo lo que empiece con `/api`.
7. `/api/aircraft` → `aircraftRouter`.
8. `notFound`: si ninguna ruta respondió, genera un 404.
9. `errorHandler`: siempre al final; recibe cualquier error.

**Lo importa:** `server.ts`.

---

## 3. Config compartida

### `backend/config/env.ts`
**Para qué existe:** lee el `.env` y valida con Zod que las variables existan y tengan el tipo correcto. Si algo está mal, el servidor no arranca.
**Dónde encaja:** fuera del recorrido; lo importan `app.ts`, `server.ts`, `logger.ts`, el service y el provider.

| Elemento | Recibe | Devuelve | Qué hace |
|---|---|---|---|
| `dotenv.config({ quiet: true })` | nada | nada | Carga las variables del archivo `.env` en `process.env`, sin escribir mensajes. |
| `envSchema` | — | esquema Zod | Describe cada variable: tipo, valor por defecto y reglas. Por ejemplo, `PORT` se convierte de texto a número entero positivo. |
| `rawEnv` | — | objeto | Copia de `process.env` sin las variables vacías, para que `PORT=` use el valor por defecto en vez de fallar. |
| `envSchema.safeParse(rawEnv)` | variables | `{ success, data }` o `{ success, error }` | Valida. Si falla, escribe qué variable está mal y termina el proceso con `process.exit(1)`. |
| `env` (exportado) | — | objeto tipado | Las variables ya validadas: `env.PORT` es `number`, `env.USE_FIXTURE` es `boolean`. |

### `backend/config/logger.ts`
**Para qué existe:** crea el logger de la aplicación con `pino`, que escribe cada log como una línea JSON.
**Dónde encaja:** fuera del recorrido; lo usan `server.ts`, el provider, el script, y `correlationId.ts` para crear `req.log`.

| Elemento | Qué hace |
|---|---|
| `logger` | Logger principal. Su nivel viene de `env.LOG_LEVEL`. |
| `redact` | Oculta `req.headers.authorization` y `req.headers.cookie` si alguna vez se loguean. Hoy el código no loguea headers, así que es una protección preventiva. |

---

## 4. Middlewares

### `backend/middlewares/correlationId.ts`
**Para qué existe:** da a cada petición un id único para seguirla en los logs, y registra cuánto tardó.
**Dónde encaja:** es el primer middleware de `app.ts`; corre en todas las peticiones.

| Elemento | Recibe | Devuelve | Qué hace | Quién la llama |
|---|---|---|---|---|
| `HEADER` | — | `'x-correlation-id'` | Nombre del header. | — |
| `VALID_ID` | — | regex | Acepta solo ids de 1 a 64 caracteres (letras, números, `_` o `-`), para no meter texto raro en los logs. | — |
| `correlationId(req, res, next)` | petición, respuesta, `next` | nada | Usa el id del header si es válido; si no, genera uno con `randomUUID()`. Lo guarda en `req.correlationId`, crea `req.log` (un logger hijo que agrega el id a cada log), lo pone en el header de la respuesta y llama a `next()`. | Express, en cada petición (`app.use`). |
| `res.on('finish', ...)` | — | — | Cuando se termina de enviar la respuesta, escribe `"request completed"` con método, URL, estado y milisegundos. | Node, al terminar la respuesta. |

### `backend/middlewares/rateLimiter.ts`
**Para qué existe:** limita cuántas peticiones puede hacer una IP, para frenar abusos.
**Dónde encaja:** middleware montado en `/api` en `app.ts`; corre antes de las rutas de `/api`.

| Elemento | Qué hace |
|---|---|
| `rateLimiter` | Creado con `rateLimit(...)` de `express-rate-limit`: máximo 300 peticiones por IP cada 15 minutos. |
| `standardHeaders: 'draft-8'` | Envía los headers estándar `RateLimit` para que el cliente sepa cuánto le queda. |
| `legacyHeaders: false` | No envía los headers antiguos `X-RateLimit-*`. |
| `handler` | Si se pasa del límite, crea `AppError(429, 'TOO_MANY_REQUESTS', ...)` y lo manda al `errorHandler`, así responde con el formato único. |

### `backend/middlewares/validate.ts`
**Para qué existe:** valida los parámetros de la URL con un esquema Zod antes de llegar al controller.
**Dónde encaja:** entre la route y el controller.

| Elemento | Recibe | Devuelve | Qué hace | Quién la llama |
|---|---|---|---|---|
| `validateParams(schema)` | un esquema Zod | una función middleware | Fabrica un middleware para ese esquema. | `aircraft.routes.ts`, con `icao24ParamsSchema`. |
| middleware devuelto `(req, _res, next)` | petición | nada | Valida `req.params`. Si falla, llama a `next(new AppError(400, 'VALIDATION_ERROR', ...))`. Si pasa, reemplaza `req.params` por la versión validada (por ejemplo, `icao24` en minúsculas) y sigue. | Express, al entrar a `GET /api/aircraft/:icao24`. |

> Probado: `GET /api/aircraft/A5F852` (en mayúsculas) encuentra el avión `a5f852`, es decir, el controller recibe la versión ya transformada.

### `backend/middlewares/errorHandler.ts`
**Para qué existe:** manejo global de errores: todo error termina aquí y sale con un único formato JSON.
**Dónde encaja:** al final de `app.ts`, después de todas las rutas.

| Elemento | Recibe | Devuelve | Qué hace | Quién la llama |
|---|---|---|---|---|
| `sendError(req, res, status, code, message)` | petición, respuesta, código HTTP, código y mensaje | nada | Responde `{ error: { code, message, correlationId } }`. | `errorHandler`. |
| `notFound(req, _res, next)` | petición | nada | Crea un `AppError(404, 'NOT_FOUND', ...)` con el método y la URL, y lo pasa a `next`. | Express, cuando ninguna ruta respondió. |
| `errorHandler(err, req, res, _next)` | el error, petición, respuesta | nada | Si es `AppError`, escribe un warning y responde su código. Si es JSON mal formado (`SyntaxError` con `body`), responde 400 `INVALID_JSON`. Cualquier otro error lo escribe completo en el log y responde 500 `INTERNAL_ERROR`, sin dar detalles internos. | Express, cuando alguien llama a `next(err)` o lanza un error. Lo reconoce como manejador de errores porque tiene 4 parámetros. |

---

## 5. Routes

### `backend/routes/health.routes.ts`
**Para qué existe:** conecta la URL `/health` con su controller.
**Dónde encaja:** capa route.

| Elemento | Qué hace | Quién lo usa |
|---|---|---|
| `healthRouter` | `Router` de Express con `GET /` → `getHealth`. Como se monta en `/health`, la URL final es `GET /health`. | `app.ts` |

### `backend/routes/aircraft.routes.ts`
**Para qué existe:** define las URLs de aviones.
**Dónde encaja:** capa route.

| Ruta final | Cadena que ejecuta |
|---|---|
| `GET /api/aircraft` | `listAircraft` |
| `GET /api/aircraft/:icao24` | `validateParams(icao24ParamsSchema)` → `getAircraft` |

`aircraftRouter` se monta en `/api/aircraft` desde `app.ts`.

---

## 6. Validators

### `backend/validators/aircraft.validator.ts`
**Para qué existe:** define las reglas que debe cumplir el parámetro `:icao24`.
**Dónde encaja:** lo aplica `validateParams`, entre la route y el controller.

| Elemento | Qué valida | Quién lo usa |
|---|---|---|
| `icao24ParamsSchema` | Objeto con `icao24`: un texto de exactamente 6 caracteres hexadecimales (0-9, a-f, A-F). Si no cumple, el mensaje es "icao24 debe tener 6 caracteres hexadecimales". Si cumple, lo pasa a minúsculas. | `aircraft.routes.ts` |

---

## 7. Controllers

### `backend/controllers/health.controller.ts`
**Para qué existe:** responde que el servidor está vivo.
**Dónde encaja:** capa controller. No llama a ningún service porque no hay lógica de negocio.

| Función | Recibe | Devuelve | Qué hace | Quién la llama |
|---|---|---|---|---|
| `getHealth(_req, res)` | petición, respuesta | nada (responde JSON) | Responde `{ status: "ok", uptime, timestamp }`: segundos encendido y fecha actual. | `healthRouter` |

### `backend/controllers/aircraft.controller.ts`
**Para qué existe:** recibe las peticiones de aviones, llama al service y responde. Sin lógica de negocio.
**Dónde encaja:** capa controller, entre la route y el service.

| Función | Recibe | Devuelve | Qué hace | Quién la llama |
|---|---|---|---|---|
| `listAircraft(req, res)` | petición, respuesta | `Promise<void>` | Pide al service los aviones de EE. UU. y responde `{ time, count, aircraft }`. | `aircraftRouter` (`GET /`) |
| `getAircraft(req, res)` | petición con `params.icao24`, respuesta | `Promise<void>` | Pide al service un avión por su `icao24` y lo responde. | `aircraftRouter` (`GET /:icao24`) |

No tienen `try/catch`: Express 5 envía al `errorHandler` cualquier error de una función `async`.

---

## 8. Services

### `backend/services/aircraft.service.ts`
**Para qué existe:** lógica de negocio de aviones: qué zona se consulta, uso de la caché y qué hacer si no hay avión.
**Dónde encaja:** capa service, entre el controller y el provider.

| Elemento | Recibe | Devuelve | Qué hace | Quién lo llama |
|---|---|---|---|---|
| `US_BOX` | — | `BoundingBox` | Caja de EE. UU. continental: latitud 24.5 a 49.5, longitud -125 a -66.9. | `getUsAircraft` y `scripts/saveFixture.ts` |
| `boxCache` | — | `TtlCache<AircraftSnapshot>` | Caché de la lista completa, con TTL `OPENSKY_CACHE_TTL_MS`. | `getUsAircraft` |
| `singleCache` | — | `TtlCache<AircraftState \| null>` | Caché de aviones individuales, uno por `icao24`. | `getAircraftByIcao24` |
| `getUsAircraft(log)` | logger de la petición | `Promise<AircraftSnapshot>` | Busca en la caché con la clave `"us"`; si no hay dato fresco, llama a `openSky.fetchByBox(US_BOX)`. | `listAircraft` |
| `findTrack(icao24, log)` / `getTrack(icao24, log)` | código del avión y logger | `FlightTrack \| null` / `FlightTrack` | Recorrido con caché de 1 min (`trackCache`), compartida entre `/details` y `/track`. `findTrack` nunca lanza; `getTrack` lanza 404 `TRACK_NOT_FOUND`. | `getDetails`, `getAircraftTrack` |
| `takeoffOf(track)` | recorrido o `null` | punto o `null` | Primer punto del recorrido si está en tierra o a menos de 1.500 m: el despegue. `getDetails` se lo pasa a `computeProgress` como tercer argumento; entonces `verified` exige que el origen de adsbdb esté a menos de 30 km del despegue y que el rumbo apunte al destino, sin mirar el desvío. Si OpenSky empezó a ver el avión ya en vuelo, `null`, y se usa la verificación por geometría. | `getDetails`, `check.ts` |
| `getAircraftByIcao24(icao24, log)` | código del avión y logger | `Promise<AircraftState>` | Busca en la caché con la clave `icao24`; si no hay dato, llama a `openSky.fetchByIcao24`. Si el resultado es `null`, lanza `AppError(404, 'AIRCRAFT_NOT_FOUND')`. | `getAircraft` |

Nota: un "no encontrado" (`null`) también se guarda en la caché durante el TTL. Mientras dure, preguntar otra vez por ese avión responde 404 sin llamar a OpenSky.

---

## 9. Providers

### `backend/providers/openSky.provider.ts`
**Para qué existe:** es el único archivo que habla con la API de OpenSky. Se autentica, consulta, convierte la respuesta a nuestro tipo y traduce los errores.
**Dónde encaja:** última capa del recorrido. Cumple para una API externa el papel que el repository cumple para la base de datos.

**Constantes y esquemas**

| Elemento | Qué es |
|---|---|
| `API_URL`, `TOKEN_URL` | URLs de la API y del servidor de tokens de OpenSky (tomadas de la documentación oficial). |
| `TIMEOUT_MS` | 10 segundos; si OpenSky tarda más, se corta la petición. |
| `FIXTURE_URL` | Ruta de `fixtures/opensky-sample.json`. |
| `BoundingBox` | Tipo de una caja geográfica: `lamin`, `lomin`, `lamax`, `lomax`. |
| `F` | En qué posición del arreglo de OpenSky está cada dato (por ejemplo, `lng` en la 5 y `lat` en la 6). |
| `statesResponseSchema` | Zod: la respuesta debe tener `time` (número) y `states` (arreglo de arreglos, o `null`). |
| `tokenResponseSchema` | Zod: la respuesta del token debe tener `access_token` y `expires_in`. |
| `hasCredentials` | `true` si hay client id y secret en `.env`. |
| `http` | Instancia de Axios con la URL base y el timeout. |
| `token` | Token guardado en memoria y su hora de vencimiento. |

Al cargar el archivo se escribe el log `"OpenSky provider mode"` con el modo: `fixture`, `oauth2` o `anonymous`.

**Funciones**

| Función | Recibe | Devuelve | Qué hace | Quién la llama |
|---|---|---|---|---|
| `getToken(forceRefresh)` | si debe forzar un token nuevo | `Promise<string \| null>` | Sin credenciales devuelve `null` (modo anónimo). Si el token guardado vence en más de 60 s, lo reutiliza. Si no, pide uno nuevo a `TOKEN_URL` con `client_credentials`. | `requestStates` |
| `requestStates(params)` | parámetros de la consulta (caja o `icao24`) | `Promise<unknown>` (respuesta cruda) | Llama a `GET /states/all` con el token. Si OpenSky responde 401, pide un token nuevo y reintenta una sola vez. Cualquier error lo convierte con `toAppError`. | `fetchRawByBox`, `fetchByIcao24` |
| `toAppError(err, step)` | el error y si ocurrió pidiendo el token o los estados | `AppError` | 429 → 503 `OPENSKY_QUOTA_EXCEEDED`; timeout → 504 `OPENSKY_TIMEOUT`; problema de autenticación → 502 `OPENSKY_AUTH_FAILED`; otro error → 502 `OPENSKY_UNAVAILABLE`. | `getToken`, `requestStates` |
| `num(v)` | cualquier valor | `number \| null` | Devuelve el número si es válido; si no, `null`. | `toAircraftState` |
| `toAircraftState(row)` | una fila de OpenSky (arreglo) | `AircraftState \| null` | Convierte la fila en un objeto con nombres claros. Devuelve `null` si falta `icao24`, `lat` o `lng`. Quita espacios del `callsign`, usa la altitud barométrica o, si falta, la geométrica, y usa `time_position` o, si falta, `last_contact`. | `toSnapshot` |
| `toSnapshot(raw)` | respuesta cruda | `AircraftSnapshot` | Valida la respuesta con Zod (si el formato es raro, lanza 502 `OPENSKY_BAD_RESPONSE`), trata `states: null` como lista vacía, convierte cada fila y descarta las `null`. | `fetchByBox`, `fetchByIcao24` |
| `readFixture()` | nada | `Promise<unknown>` | Lee y parsea `fixtures/opensky-sample.json`. Si no puede, lanza 500 `FIXTURE_MISSING`. | `fetchByBox`, `fetchByIcao24` (solo con `USE_FIXTURE=true`) |
| `fetchRawByBox(box)` | caja geográfica | `Promise<unknown>` | Pide los estados de esa caja, sin convertirlos. | `fetchByBox`, `scripts/saveFixture.ts` |
| `fetchByBox(box)` | caja geográfica | `Promise<AircraftSnapshot>` | Con `USE_FIXTURE` lee el archivo; si no, llama a OpenSky. En ambos casos convierte con `toSnapshot`. | `getUsAircraft` (service) |
| `fetchTrack(icao24)` | código del avión | `Promise<FlightTrack \| null>` | `GET /tracks/all?time=0`: recorrido del vuelo en curso. OpenSky lo marca como experimental. 404 = `null`; con `USE_FIXTURE`, siempre `null`. | `findTrack` (service) |
| `toTrack(raw)` | respuesta de `/tracks` | `FlightTrack` | Valida con Zod y convierte cada punto `[time, lat, lon, alt, track, on_ground]` en `TrackPoint`; descarta los que no tienen posición. | `fetchTrack`, `check.ts` |
| `fetchByIcao24(icao24)` | código del avión | `Promise<AircraftState \| null>` | Con `USE_FIXTURE` busca el avión en el archivo; si no, consulta a OpenSky con `?icao24=`. Devuelve el avión o `null`. | `getAircraftByIcao24` (service) |

---

### `backend/services/flightDetails.service.ts`
**Para qué existe:** arma el panel del avión seleccionado y decide qué API responde cada dato.
**Dónde encaja:** capa service; lo llama `aircraft.controller.ts` y usa `aircraft.service.ts`, `adsbdb.provider.ts`, `aviationStack.provider.ts` y `hexdb.provider.ts`.

| Elemento | Recibe | Devuelve | Qué hace | Quién lo llama |
|---|---|---|---|---|
| `aircraftCache`, `routeCache` | — | `TtlCache` | Caché de 6 h del avión (por `icao24`) y de la ruta (por indicativo). | `getDetails` |
| `scheduleCache` | — | `TtlCache` | Caché de 30 min del tramo activo de Aviationstack (por indicativo). | `getSchedule` |
| `airportCache` | — | `TtlCache` | Caché de 30 días de las coordenadas de los aeropuertos (hexdb). | `getAirport` |
| `distanceKm(a, b)` | dos puntos `{ lat, lng }` | km | Distancia sobre la Tierra con la fórmula de haversine. | `computeProgress`, `check.ts` |
| `bearingDeg(a, b)` | dos puntos | grados | Rumbo inicial de `a` hacia `b`. | `computeProgress`, `check.ts` |
| `computeProgress(state, route)` | avión y ruta | `{ progress, verified }` | Calcula km totales, recorridos y restantes, % y ETA (km restantes / velocidad). `totalKm` es recorrido + restante, para que el % cuadre. `verified` es `false` si el desvío pasa de 1,2 o si el rumbo se aleja más de 90° del destino (esto último no se exige a menos de 100 km del destino). | `getDetails`, `getSchedule`, `check.ts` |
| `getDetails(icao24, log)` | código del avión y logger | `Promise<AircraftDetails>` | Toma el avión de OpenSky (de la caché), pide a adsbdb el avión y la ruta en paralelo, y calcula el progreso. Si adsbdb falla, devuelve `null` en esas partes sin cortar la respuesta. | `getAircraftDetails` |
| `getSchedule(icao24, log)` | código del avión y logger | `Promise<FlightSchedule>` | Con el indicativo pide a Aviationstack el tramo activo, completa las coordenadas de los aeropuertos con hexdb y calcula la ruta real y el progreso con la posición actual. Sin indicativo o sin vuelo activo, lanza 404 `SCHEDULE_NOT_FOUND`. | `getAircraftSchedule` |

### `backend/providers/aircraftDb.provider.ts`
**Para qué existe:** dice el tipo de cada avión de la lista (`B738`, `C172`...) sin llamar a ninguna API, para que el mapa elija el icono por tamaño. Usa la base de Mictronics publicada por tar1090-db (unos 620.000 aviones).

| Función | Devuelve | Qué hace |
|---|---|---|
| `loadAircraftDb()` | `Promise<void>` | La llama `server.ts` al arrancar, sin esperar. Si falta `data/aircraft.csv.gz`, lo descarga (8 MB); después lo descomprime y llena el mapa en memoria. Si falla, solo avisa en el log y los aviones salen con `type: null`. |
| `parseAircraftDb(csv)` | `Map<string, string>` | Convierte filas `A0F1BB;N160AN;A321;...` en `a0f1bb -> A321`. Ignora las filas sin tipo. Lo prueba `npm run check`. |
| `typeOf(icao24)` | `string \| null` | Tipo del avión; lo usa `toAircraftState`. |

Para actualizar la base basta con borrar `backend/data/aircraft.csv.gz` y reiniciar.

### `backend/providers/airportDb.provider.ts`
**Para qué existe:** convierte el punto de despegue del recorrido en un aeropuerto. Usa la lista de OurAirports (dominio público), filtrada a los aeropuertos grandes y medianos con vuelos regulares (unos 3.300).

| Función | Devuelve | Qué hace |
|---|---|---|
| `loadAirportDb()` | `Promise<void>` | La llama `server.ts` al arrancar, sin esperar. Si falta `data/airports.csv`, lo descarga (12 MB). Si falla, solo avisa en el log y `departure` sale `null`. |
| `splitCsvLine(line)` | `string[]` | Separa una línea CSV respetando las comas y las comillas dentro de un campo. |
| `parseAirports(csv)` | `Airport[]` | Lee las columnas por nombre y se queda con `large_airport` y `medium_airport` con `scheduled_service = yes`. |
| `allAirports()` | `readonly Airport[]` | La lista cargada (vacía hasta que termina de cargar). |

En `flightDetails.service.ts` la usan dos funciones:

| Función | Qué hace |
|---|---|
| `nearestAirport(point, airports, maxKm = 15)` | Aeropuerto más cercano al punto, si está a menos de 15 km; si no, `null`. |
| `resolveRoute(state, raw, takeoff, departure)` | Elige la ruta del panel: (1) la de adsbdb si encaja (`verified: true, estimated: false`); (2) si no, y el despegue fue en otro aeropuerto, prueba despegue → destino de adsbdb con la verificación por geometría y, si encaja, la devuelve con `estimated: true`; (3) si nada encaja, la de adsbdb con `verified: false` y sin progreso. |

Para actualizar la lista basta con borrar `backend/data/airports.csv` y reiniciar.

### `backend/providers/adsbdb.provider.ts`
**Para qué existe:** habla con adsbdb (`api.adsbdb.com/v0`), gratis y sin llave. Timeout de 5 s.

| Función | Devuelve | Qué hace |
|---|---|---|
| `fetchAircraftInfo(icao24)` | `AircraftInfo \| null` | `GET /aircraft/{icao24}`: modelo, matrícula, dueño y foto. 404 = `null`. |
| `fetchRoute(callsign)` | ruta sin `verified`, o `null` | `GET /callsign/{callsign}`: aerolínea, número comercial, origen y destino. 404 = `null`. |

Se usan dos llamadas y no la combinada (`/aircraft/{icao24}?callsign=`) porque la combinada responde 404 si falta cualquiera de los dos datos, y se perdería el otro.

### `backend/providers/aviationStack.provider.ts`
**Para qué existe:** habla con Aviationstack (`api.aviationstack.com/v1`). La llave va en la URL (`access_key`), por eso nunca se loguea la URL ni el error de Axios.

| Elemento | Qué hace |
|---|---|
| `isEnabled` | `true` si hay `AVIATIONSTACK_API_KEY`. |
| `fetchActiveFlight(callsign, icao24)` | `GET /flights?flight_icao={callsign}&flight_status=active` (1 petición). Traduce errores: `usage_limit_reached` → 503 `AVIATIONSTACK_QUOTA_EXCEEDED`, llave inválida → 502 `AVIATIONSTACK_AUTH_FAILED`, timeout → 504. |
| `pickFlight(flights, icao24)` | La respuesta trae el vuelo del operador y sus códigos compartidos sobre el mismo avión; elige el del operador (`codeshared` vacío) con el mismo `icao24`. |
| `localToIso(t, tz)` | Aviationstack manda la hora local del aeropuerto marcada como `+00:00`; la convierte a UTC con la zona horaria (`Intl.DateTimeFormat`), en dos pasadas para acertar en los cambios de horario. |

### `backend/providers/hexdb.provider.ts`
**Para qué existe:** coordenadas de un aeropuerto por código ICAO (`hexdb.io/api/v1/airport/icao/{icao}`), gratis. 404 = `null`; otros fallos lanzan error para que el `null` no se guarde en caché.

## 10. Types

### `backend/types/aircraft.ts`
**Para qué existe:** define el contrato de datos de un avión, es decir, la forma del JSON que devuelve la API.
**Dónde encaja:** lo usan el provider (lo construye), el service (lo guarda en caché) y el controller (lo responde).

| Tipo | Campos |
|---|---|
| `AircraftState` | `icao24` (código del avión), `callsign` (indicativo del vuelo o `null`), `lat`, `lng`, `hdg` (rumbo en grados desde el norte), `spd` (velocidad en m/s), `alt` (altitud en metros), `onGround` (si está en tierra), `type` (tipo ICAO del avión o `null`), `ts` (hora de la posición, Unix en segundos). |
| `AircraftSnapshot` | `time` (hora del lote según OpenSky) y `aircraft` (lista de `AircraftState`). |

### `backend/types/express.d.ts`
**Para qué existe:** le dice a TypeScript que cada `req` de Express tiene `correlationId` (texto) y `log` (logger de pino). Sin esto, `strict` marcaría error al usar `req.log`.
**Dónde encaja:** solo agrega tipos; no se ejecuta. Esas propiedades las llena `correlationId.ts`.

---

## 11. Utils

### `backend/utils/AppError.ts`
**Para qué existe:** representa errores "esperados" que se pueden mostrar al cliente, con su código HTTP.
**Dónde encaja:** lo lanzan el middleware `validate.ts`, el service, el provider, `notFound` y el rate limiter, y lo atrapa `errorHandler`.

| Elemento | Recibe | Qué hace |
|---|---|---|
| `class AppError extends Error` | — | Error con dos campos extra: `statusCode` (por ejemplo, 404) y `code` (por ejemplo, `'NOT_FOUND'`). |
| `constructor(statusCode, code, message)` | código HTTP, código y mensaje | Guarda los tres datos y pone `name = 'AppError'`. |

### `backend/utils/ttlCache.ts`
**Para qué existe:** caché en memoria donde cada dato vence después de un tiempo (TTL).
**Dónde encaja:** la usa el service, entre el service y el provider.

| Elemento | Recibe | Devuelve | Qué hace | Quién la llama |
|---|---|---|---|---|
| `class TtlCache<T>` | — | — | Guarda valores de tipo `T` por clave (`entries`) y las cargas en curso (`pending`). | El service crea dos: `boxCache` y `singleCache`. |
| `constructor(ttlMs)` | milisegundos de vida | — | Guarda el TTL. | `aircraft.service.ts` |
| `getOrLoad(key, loader, log)` | clave, función que trae el dato, logger | `Promise<T>` | (1) Si hay dato vigente, escribe `"cache hit"` y lo devuelve. (2) Si hay un dato vencido, lo devuelve al instante y lanza `loader()` en segundo plano para refrescarlo (`"cache stale"`); así el cliente no espera a una fuente lenta. Si ese refresco falla, el dato viejo se queda (`"serving stale cache"`). (3) Sin ningún dato, espera la carga en curso (`"cache wait"`) o la empieza (`"cache miss"`) y guarda el resultado con su vencimiento. | `getUsAircraft`, `getAircraftByIcao24` |

Limitación conocida: las claves nunca se borran, así que la caché de aviones individuales crece con cada `icao24` distinto que se consulta. Para la escala de la demo no es un problema.

---

## 12. Scripts y datos

### `backend/scripts/saveFixture.ts`
**Para qué existe:** graba una respuesta real de OpenSky para usarla como plan B de la demo.
**Dónde encaja:** fuera del recorrido; se ejecuta a mano con `npm run fixture:save`.

**Qué hace, paso a paso** (no tiene funciones propias; el código corre de arriba a abajo):
1. Pide la respuesta cruda de `US_BOX` con `fetchRawByBox`.
2. Crea la carpeta `fixtures/` si no existe.
3. Escribe el JSON en `fixtures/opensky-sample.json`.
4. Escribe el log `"fixture saved"`.

Guarda la respuesta **cruda** a propósito: así el fixture pasa por el mismo `toSnapshot` que los datos reales.

### `backend/fixtures/opensky-sample.json`
No es código: es una respuesta real de OpenSky (`{ time, states }`) grabada el día de la prueba, con unos 4430 aviones. Se usa solo con `USE_FIXTURE=true`.

---

## 13. Recorrido completo de un dato

Seguimos un avión desde OpenSky hasta el JSON que recibe el cliente con `GET /api/aircraft`:

1. El cliente (navegador, frontend o `curl`) envía `GET /api/aircraft`.
2. **`server.ts`** recibe la conexión y se la pasa a `app`.
3. **`correlationId`** asigna un id, crea `req.log` y pone el header `x-correlation-id`.
4. **`helmet`** agrega headers de seguridad; **`cors`** comprueba el origen; **`express.json`** no hace nada porque no hay cuerpo.
5. **`rateLimiter`** cuenta la petición de esa IP.
6. **`aircraftRouter`** reconoce `GET /` y llama a **`listAircraft`**.
7. **`listAircraft`** llama a **`getUsAircraft(req.log)`**.
8. **`getUsAircraft`** llama a **`boxCache.getOrLoad('us', ...)`**:
   - **Cache hit:** devuelve el dato guardado y salta al paso 13.
   - **Cache miss:** ejecuta `openSky.fetchByBox(US_BOX)`.
9. **`fetchByBox`** llama a **`fetchRawByBox`** → **`requestStates`** con la caja. Si `USE_FIXTURE=true`, lee el archivo y salta al paso 11.
10. **`requestStates`**:
    1. **`getToken`** devuelve un token OAuth2 (el guardado o uno nuevo), o `null` si no hay credenciales (modo anónimo).
    2. Axios llama a `https://opensky-network.org/api/states/all?lamin=24.5&lomin=-125&lamax=49.5&lomax=-66.9`, con `Authorization: Bearer <token>` si hay token.
    3. OpenSky responde `{ time, states: [[icao24, callsign, país, ..., lng, lat, ...], ...] }`; cada fila tiene 17 campos.
11. **`toSnapshot`** valida esa forma con Zod y pasa cada fila por **`toAircraftState`**. Por ejemplo, `["a5f852", "RTY484  ", "United States", 1792201638, 1792201638, -104.4365, 40.6924, 2103.12, false, 67.42, 27.74, ...]` (primera fila del fixture) se convierte en `{ icao24: "a5f852", callsign: "RTY484", lat: 40.6924, lng: -104.4365, alt: 2103.12, onGround: false, spd: 67.42, hdg: 27.74, ts: 1792201638 }`. Las filas sin posición se descartan.
12. **`TtlCache`** guarda el `AircraftSnapshot` durante `OPENSKY_CACHE_TTL_MS`.
13. **`listAircraft`** responde `{ time, count, aircraft: [...] }` con estado 200.
14. Al terminar de enviar, **`correlationId`** escribe `"request completed"` con el mismo id, el estado y los milisegundos.

**Si algo falla** en los pasos 9 a 11 (cuota agotada, timeout, credenciales malas, formato raro):
- El provider lanza un `AppError`.
- Si la caché tenía un dato viejo, se devuelve ese dato.
- Si no, Express lleva el error a **`errorHandler`**, que responde `{ error: { code, message, correlationId } }`.
- El servidor sigue funcionando.

**Después** (en el repositorio del frontend), el JSON llega al cliente de Axios, se guarda en el store de Pinia y se dibuja en el mapa de Leaflet.

---

## 14. Glosario

| Término | Significado |
|---|---|
| **Express** | Librería de Node para crear servidores HTTP con rutas y middlewares. |
| **Middleware** | Función que recibe `(req, res, next)` y corre antes o después de las rutas; puede responder o pasar al siguiente con `next()`. |
| **Controller** | Capa que recibe la petición, llama al service y responde; no tiene lógica de negocio. |
| **Service** | Capa con la lógica de negocio (qué consultar, caché, reglas como el 404). |
| **Provider** | Capa que habla con una fuente externa (aquí, la API de OpenSky). |
| **Zod** | Librería para validar datos en tiempo de ejecución y obtener tipos de TypeScript a partir del esquema. |
| **TypeScript estricto** | `strict: true`: el compilador no deja pasar tipos dudosos, como valores que pueden ser `null` sin comprobarlo. |
| **Correlation id** | Id único por petición que aparece en la respuesta y en todos sus logs. |
| **pino** | Logger que escribe logs estructurados (una línea JSON por evento). |
| **CORS** | Regla del navegador que decide qué sitios web pueden llamar a la API; se configura con `CORS_ORIGIN`. |
| **Rate limiting** | Límite de peticiones por IP en una ventana de tiempo; si se supera, responde 429. |
| **OAuth2 client credentials** | Forma de autenticarse con OpenSky: se envían client id y secret, y se recibe un token temporal (Bearer). |
| **icao24** | Código hexadecimal de 6 caracteres que identifica el transpondedor de un avión. |
| **Caché con TTL** | Datos guardados en memoria que vencen después de un tiempo (Time To Live) para no repetir llamadas. |
| **Fixture** | Archivo con datos reales grabados que se usan para pruebas o como plan B de la demo. |
---

## 15. Si el profesor pide X, dónde toco

| Si el profesor pide... | Dónde toco |
|---|---|
| Cambiar cada cuánto se renuevan los datos de aviones en el backend | `OPENSKY_CACHE_TTL_MS` en `.env` (validado en `config/env.ts`, mínimo 10000). |
| Cambiar cada cuánto el mapa pide los aviones (polling) | En el repositorio del **frontend**, no en este. |
| Cambiar un color, el panel del avión o el mapa | En el repositorio del **frontend**, no en este. |
| Validar un parámetro nuevo de una ruta | Agregar el esquema en `validators/`, y en la route ponerlo con `validateParams(...)` antes del controller. |
| Validar parámetros de consulta (`?x=...`) | Hoy no existe; habría que crear un middleware parecido a `validateParams` para `req.query`. |
| Cambiar cuánto duran en caché la ruta o los horarios | `STATIC_TTL_MS` y `SCHEDULE_TTL_MS` en `services/flightDetails.service.ts`. |
| Cambiar cuándo una ruta se considera no verificada | `MAX_DETOUR`, `MAX_HEADING_OFF_DEG` y `HEADING_CHECK_MIN_KM` en `services/flightDetails.service.ts`. |
| Agregar un campo al avión (por ejemplo, velocidad vertical) | (1) Agregarlo en `types/aircraft.ts`. (2) Agregar su índice en `F` (el 11 es `vertical_rate` según la documentación de OpenSky). (3) Llenarlo en `toAircraftState`. (4) Actualizar el tipo en el frontend. |
| Cambiar la zona geográfica consultada | `US_BOX` en `services/aircraft.service.ts` (ojo: cajas grandes gastan más créditos). |
| Agregar un endpoint nuevo | route en `routes/` → controller en `controllers/` → función en el service → (si necesita datos externos) provider. Montar el router en `app.ts`. |
| Cambiar el formato de los errores | `sendError` en `middlewares/errorHandler.ts`. |
| Agregar un nuevo tipo de error | `throw new AppError(status, 'CODIGO', 'mensaje')` donde ocurra; el `errorHandler` ya lo maneja. |
| Cambiar el límite de peticiones | `limit` y `windowMs` en `middlewares/rateLimiter.ts`. |
| Permitir otro origen del frontend | `CORS_ORIGIN` en `.env` (varios separados por coma). |
| Agregar una variable de entorno | Agregarla en `envSchema` (`config/env.ts`) y en `.env.example`. |
| Ver más o menos detalle en los logs | `LOG_LEVEL` en `.env` (con `debug` se ven los créditos restantes de OpenSky). |
| Usar datos grabados si OpenSky falla | `USE_FIXTURE=true` en `.env`; para regrabar: `npm run fixture:save`. |
| Cambiar el timeout de OpenSky | `TIMEOUT_MS` en `providers/openSky.provider.ts`. |
| Cambiar qué responde `/health` | `getHealth` en `controllers/health.controller.ts`. |
