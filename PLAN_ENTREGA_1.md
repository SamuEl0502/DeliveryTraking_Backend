# PLAN DE ACCIÓN: ENTREGA 1 (mañana)

**Meta:** mostrar algo que se vea y funcione, no todo el sistema.
**Resultado a presentar:** un mapa con aviones reales de EE. UU. (OpenSky), actualizándose en vivo y con movimiento suave, más el backend base con el estándar y el modelo de datos listo.

**Regla de oro:** no pegues código que no puedas explicar en una frase. Mañana te van a preguntar.

---

## 0. Qué entra y qué no

| Prioridad | Qué | Estado para mañana |
|---|---|---|
| **MUST** | Backend base (`/health`, correlation-id, errores, env con Zod) | Hecho |
| **MUST** | `OpenSkyProvider` + caché + endpoint de aviones | Hecho |
| **MUST** | Frontend: mapa con aviones reales y panel del avión seguido | Hecho |
| SHOULD | Suavizado de trayectoria (lerp + `requestAnimationFrame`) | Hecho |
| SHOULD | Esquema Prisma + migración + seed de aeropuertos | Si hay tiempo |
| COULD | WebSocket para el avión seguido | Solo si sobra |
| **NO HOY** | Auth completa, RBAC, envíos, eventos, ETA, estados automáticos | Entregas 2 a 4 |

Para mañana el frontend consulta por polling al backend (con caché). Se explica como el paso previo al WebSocket.

---

## 1. Bloque 0: Preparación (30 min)

- [x] Registrar la cuenta en OpenSky **ahora** (si hay demora de activación, no te bloquea después). Guardar client id y secret en `.env`.
- [x] Pegar `CONTEXTO.md` en la raíz de ambos repos.
- [x] Renombrar `simulator/` a `providers/` en el backend. Crear `websocket/`, `utils/` y `migrations/` si faltan.
- [x] Confirmar que `.env` no se sube (`git status`).
- [ ] Verificar que Node (LTS) y PostgreSQL están instalados.

*Tu amigo puede hacer el registro en OpenSky y la instalación de PostgreSQL por su lado.*

---

## 2. Bloque 1: Esqueleto del backend (60-75 min)

**Instalar:** `express`, `zod`, `dotenv`, `helmet`, `cors`, `express-rate-limit`, `pino` (logs estructurados) y como dev `typescript`, `tsx`, `@types/express`, `@types/node`.

- [x] `tsconfig.json` con `strict: true`. Renombrar `server.js` a `server.ts`.
- [x] `config/env.ts`: lee `.env` y lo valida con Zod (falla al arrancar si falta algo).
- [x] `middlewares/correlationId.ts`: toma `x-correlation-id` del header o genera uno, lo devuelve en la respuesta y lo pone en los logs.
- [x] `middlewares/errorHandler.ts`: manejo global de errores con formato JSON único.
- [x] `middlewares/rateLimiter.ts`, `helmet` y `cors` en `app.ts`.
- [x] Separar `app.ts` (configura Express) de `server.ts` (levanta el servidor).
- [x] `GET /health`.
- [x] Script `npm run dev`.

**Listo cuando:** `curl -i localhost:PORT/health` responde JSON, trae el header `x-correlation-id` y el log muestra ese mismo id.

---

## 3. Bloque 2: OpenSky (60-90 min)

- [x] **Primero, a mano:** hacer una consulta de prueba (Postman o curl) con una caja geográfica de EE. UU. y mirar qué devuelve. Revisar en la documentación de OpenSky el orden de los campos de cada estado antes de mapearlos.
- [x] **Guardar una respuesta real en un JSON** (`fixtures/opensky-sample.json`). Es tu plan B para la demo si la API falla o se agota el cupo.
- [x] `types`: `AircraftState` (`icao24`, `callsign`, `lat`, `lng`, `hdg`, `spd`, `alt`, `onGround`, `ts`).
- [x] `providers/openSky.provider.ts`: Axios con OAuth2 (o anónimo si la cuenta aún no está activa), convierte la respuesta al tipo `AircraftState`, ignora aviones sin posición y maneja el caso de lista vacía o `null`.
- [x] Caché en memoria (TTL de 10 s o más, configurable en `.env`). La API de OpenSky **nunca** se llama desde el frontend.
- [x] Ruta, controller y service: `GET /api/aircraft` (aviones de la caja de EE. UU.) y `GET /api/aircraft/:icao24`.
- [x] Zod valida los parámetros de la ruta.

**Listo cuando:** `/api/aircraft` devuelve la lista tipada y una segunda llamada dentro del TTL muestra "cache hit" en el log.

---

## 4. Bloque 3: Frontend con mapa (90-120 min)

> **ANTES DE EMPEZAR ESTE BLOQUE: el asistente debe pedirte las referencias de diseño.**
> Al abrir el chat de este bloque, si no las has adjuntado, lo primero que debe hacer es pedirte las capturas de Flighty (iOS) para copiar el estilo.
> - [ ] Entrar al enlace de Flighty en Mobbin (el que te pasó tu amigo) y tomar **2 o 3 capturas**: (1) el mapa con el avión en vuelo, (2) el panel o pantalla de detalle del vuelo, (3) la lista de vuelos.
> - [ ] Adjuntarlas al chat junto con `CONTEXTO.md`.
> - [ ] Si no tienes capturas a mano, el asistente sigue con un diseño sencillo y limpio, sin bloquear el bloque.
> - Mobbin como conector queda para después de la entrega, no se conecta hoy.

**Instalar:** `vue-router`, `pinia`, `axios`, `leaflet`, `@types/leaflet`.

- [x] Pasar a TypeScript estricto: `vite.config.ts`, `tsconfig.json` con `strict`, `main.ts`, `App.vue` con `<script setup lang="ts">`.
- [x] `types/aircraft.ts`: mismo contrato que el backend.
- [x] `services/api.ts`: instancia de Axios con `baseURL` desde variable de entorno y un interceptor básico de errores.
- [x] `store/aircraft.ts` (Pinia): lista de aviones, `loading`, `error`, `lastUpdated`, y `selectedIcao24`.
- [x] `views/MapView.vue`: mapa Leaflet con tiles de OpenStreetMap, un marcador por avión rotado según su rumbo, polling cada 10 s.
- [x] Clic en un avión: se vuelve el "avión seguido" y se abre un panel lateral con callsign, velocidad, altitud, en tierra o en aire y hora de la última actualización.
- [x] Estados visibles: indicador de carga y banner de error si el backend no responde.

**Listo cuando:** abres el navegador, ves aviones reales sobre EE. UU., haces clic en uno y ves sus datos. Si apagas el backend, aparece el error y no se rompe la pantalla.

---

## 5. Bloque 4 (SHOULD): Suavizado (45-60 min)

- [x] `composables/useSmoothedPosition.ts`: guarda la posición anterior y la nueva, interpola linealmente (`lerp`) con `requestAnimationFrame` durante el intervalo entre actualizaciones.
- [x] Aplicarlo al avión seguido (y a todos si el rendimiento lo permite).

**Es lo más vistoso en la demo.** Si el tiempo aprieta, hazlo antes que Prisma.

---

## 5b. Extra (fuera del plan original): panel con ruta y horarios

- [x] `GET /api/aircraft/:icao24/details`: avión y ruta (adsbdb), progreso y ETA calculados.
- [x] `GET /api/aircraft/:icao24/schedule`: ruta real, horarios y puertas (Aviationstack + hexdb), solo con botón.
- [x] Panel del frontend al estilo FlightRadar24, probado de punta a punta.

---

## 6. Bloque 5 (SHOULD): Modelo de datos (30-45 min)

- [ ] `npx prisma init` y `schema.prisma` con `User`, `Airport`, `Flight`, `Shipment`, `TrackingEvent`, enums de roles y estados, y campos `version` en `Shipment` y `Flight`. Incluir `Flight.aircraftIcao24`.
- [ ] `prisma migrate dev` si PostgreSQL está listo.
- [ ] Seed con 5 aeropuertos grandes de EE. UU. (ATL, LAX, ORD, DFW, JFK). Saca las coordenadas de una fuente oficial, por ejemplo OurAirports.

Aunque no llegue a conectarse con el resto, el esquema y la migración se ven bien en el repo y sirven para explicar el modelo.

---

## 7. Bloque 6 (COULD): WebSocket (45-60 min)

Solo si sobra tiempo real. `websocket/` con `ws`, un canal por avión seguido, que emite el payload `{ lat, lng, hdg, spd, ts, src }`. Sin autenticación todavía. Si no llega, se presenta como la siguiente entrega.

---

## 8. Bloque final: Cierre (45 min, no lo saltes)

- [x] `README.md` de cada repo: qué es, cómo instalar, variables de `.env.example`, cómo correrlo.
- [x] `.env.example` actualizado (sin valores reales).
- [x] Commits ordenados, con ramas `feature/...` y PR a `main` si el tiempo lo permite.
- [ ] Capturas de pantalla o un GIF corto del mapa.
- [ ] Probar desde cero: ambos servidores arrancan con `npm run dev`.
- [ ] Ensayar la demo una vez completa, cronometrada.

---

## 9. Calendario sugerido

| Cuándo | Qué |
|---|---|
| Esta noche, primeras 3 horas | Bloques 0, 1 y 2 |
| Siguientes 2 horas | Bloque 3 (lo que se ve) |
| Dormir | Un demo con poco sueño falla más que uno con menos funciones |
| Mañana, antes de clase | Bloque 4, Bloque 5 si hay tiempo, y Bloque final |

**Regla de corte:** si llegas al final del Bloque 2 pasadas 3 horas y media, simplifica el Bloque 1 (deja `rate limiter` para después) y pasa directo al mapa. Orden de lo que se recorta: WebSocket, luego Prisma, luego suavizado. **El mapa con aviones reales no se recorta.**

---

## 10. Guion de la demo (4-5 min)

1. **La idea (30 s):** rastreo de paquetes en vuelos con tracking geoespacial en vivo.
2. **Arquitectura y estándar (1 min):** estructura MVC con capas, flujo `routes -> middlewares -> controller -> service -> repository`, Zod, correlation-id, TypeScript estricto.
3. **Demo en vivo (2 min):** el mapa con aviones reales, clic en un avión, panel de datos, movimiento suave.
4. **Modelo de datos (30 s):** esquema Prisma (si está).
5. **Lo que viene (30 s):** autenticación y roles, envíos y eventos, WebSocket por vuelo, ETA, estados automáticos.

**Plan B de la demo:** si OpenSky falla ese día, el backend sirve `fixtures/opensky-sample.json` (variable de entorno, solo para ese caso) y lo dices con claridad.

---

## 11. Cómo trabajar conmigo hoy (ahorro de tokens)

- Un chat por bloque. Al abrir cada uno: pega `CONTEXTO.md` y escribe "Bloque N de PLAN_ENTREGA_1".
- Pide el esqueleto del archivo, léelo y ajústalo tú. Así lo entiendes y lo puedes explicar.
- Si algo falla, pega solo el error y el archivo implicado.
- Para el Bloque 3 (frontend), adjunta también las capturas de referencia de Flighty. El asistente te las pedirá si no las incluyes.

## 12. Qué puede hacer tu amigo sin Claude

- Registrar la cuenta de OpenSky y probar las credenciales.
- Instalar PostgreSQL y dejar la BD creada.
- Redactar los `README.md`.
- Preparar las diapositivas o el guion de la demo.
- Buscar las coordenadas oficiales de los 5 aeropuertos para el seed.
