# Explicación del backend (Bloques 1 y 2)

Guía para entender y explicar el código. El backend es un servidor Express con TypeScript estricto que hoy hace dos cosas: decir si está vivo (`/health`) y entregar aviones reales sobre EE. UU. desde OpenSky (`/api/aircraft`).

---

## 1. Qué hace cada archivo

### Arranque y configuración
| Archivo | Qué hace |
|---|---|
| `package.json` | Lista las dependencias y los scripts (`npm run dev`, `npm run typecheck`, `npm run fixture:save`). |
| `tsconfig.json` | Configura TypeScript en modo `strict`. Solo revisa tipos; `tsx` es quien ejecuta el código. |
| `server.ts` | Punto de entrada: levanta el servidor en `PORT` y lo cierra limpio con Ctrl+C. |
| `app.ts` | Arma la aplicación Express: middlewares en orden, rutas, 404 y manejador de errores. |
| `config/env.ts` | Lee `.env` y lo valida con Zod; si falta algo, el servidor no arranca. |
| `config/logger.ts` | Crea el logger `pino` que escribe logs estructurados en JSON. |
| `.env.example` | Plantilla de variables de entorno, sin valores reales. |

### Middlewares (se ejecutan antes o después de las rutas)
| Archivo | Qué hace |
|---|---|
| `middlewares/correlationId.ts` | Da un id único a cada petición, lo devuelve en el header `x-correlation-id` y lo pone en cada log. |
| `middlewares/rateLimiter.ts` | Limita a 300 peticiones por IP cada 15 minutos en `/api`. |
| `middlewares/validate.ts` | Valida los parámetros de la URL con un esquema Zod; si fallan, responde 400. |
| `middlewares/errorHandler.ts` | Atrapa cualquier error y responde siempre el mismo formato JSON; también maneja el 404. |

### Capas del recorrido
| Archivo | Capa | Qué hace |
|---|---|---|
| `routes/health.routes.ts` | Route | Conecta `GET /health` con su controller. |
| `routes/aircraft.routes.ts` | Route | Conecta `GET /api/aircraft` y `GET /api/aircraft/:icao24`. |
| `validators/aircraft.validator.ts` | Validación | Esquema Zod: `icao24` debe tener 6 caracteres hexadecimales. |
| `controllers/health.controller.ts` | Controller | Responde `{ status: "ok", uptime, timestamp }`. |
| `controllers/aircraft.controller.ts` | Controller | Recibe la petición, llama al service y responde JSON. |
| `services/aircraft.service.ts` | Service | Lógica: define la caja de EE. UU., usa la caché y lanza 404 si no hay avión. |
| `providers/openSky.provider.ts` | Provider | Único que habla con OpenSky: token OAuth2, consulta, conversión a `AircraftState` y errores. |
| `services/flightDetails.service.ts` | Service | Panel del avión seleccionado: decide qué API responde cada dato, calcula progreso y ETA y verifica la ruta. |
| `providers/adsbdb.provider.ts` | Provider | Habla con adsbdb (gratis): modelo, matrícula y foto de respaldo por `icao24`, y ruta por indicativo. |
| `providers/planespotters.provider.ts` | Provider | Foto del avión revisada por moderadores, con fotógrafo y enlace (gratis). |
| `providers/aviationStack.provider.ts` | Provider | Habla con Aviationstack: tramo activo del vuelo (ruta real, horarios, retraso, terminal, puerta). Cada llamada gasta 1 de 100 peticiones al mes. |
| `providers/hexdb.provider.ts` | Provider | Habla con hexdb (gratis): coordenadas de los aeropuertos que da Aviationstack. |

### Utilidades, tipos y datos
| Archivo | Qué hace |
|---|---|
| `utils/AppError.ts` | Error con código HTTP y código legible (`NOT_FOUND`, `OPENSKY_TIMEOUT`...). |
| `utils/ttlCache.ts` | Caché en memoria con tiempo de vida; evita llamadas repetidas a OpenSky. |
| `types/flightDetails.ts` | Contratos del panel: `AircraftDetails`, `FlightRoute`, `FlightProgress`, `FlightSchedule`... |
| `scripts/check.ts` | Prueba rápida (`npm run check`): distancias, progreso, ETA, elección del vuelo de Aviationstack y conversión de horas. |
| `fixtures/aviationstack-sample.json` | Respuesta real de Aviationstack (AAL3304) que usa `check.ts`. |
| `types/aircraft.ts` | Contratos `AircraftState` (la forma de un avión en la API) y `AircraftSnapshot` (el lote con su `time`). |
| `types/express.d.ts` | Le dice a TypeScript que `req` tiene `correlationId` y `log`. |
| `scripts/saveFixture.ts` | Guarda una respuesta real de OpenSky en `fixtures/opensky-sample.json`. |
| `fixtures/opensky-sample.json` | Respuesta real grabada; plan B de la demo con `USE_FIXTURE=true`. |

---

## 2. Recorrido de una petición a `GET /api/aircraft`

1. **Llega la petición** al servidor que abrió `server.ts`.
2. **`correlationId`** toma el header `x-correlation-id` o genera uno nuevo, lo pone en la respuesta y crea `req.log` (un logger que lleva ese id).
3. **`helmet`** agrega headers de seguridad y **`cors`** revisa que el origen esté permitido (`CORS_ORIGIN`).
4. **`express.json`** lee el cuerpo, si viene uno (aquí no hay).
5. **`rateLimiter`** cuenta la petición; si la IP pasó el límite, va directo al `errorHandler` con 429.
6. **`aircraft.routes.ts`** ve que es `GET /` y llama a `listAircraft`.
7. **`aircraft.controller.ts`** llama a `aircraftService.getUsAircraft(req.log)`.
8. **`aircraft.service.ts`** pide a la caché la clave `"us"`:
   - Si hay dato fresco, el log dice **"cache hit"** y se devuelve sin llamar a OpenSky.
   - Si no, el log dice **"cache miss"** y se llama al provider.
9. **`openSky.provider.ts`**:
   1. Si `USE_FIXTURE=true`, lee `fixtures/opensky-sample.json` y salta al paso 3.
   2. Si hay credenciales, consigue un token OAuth2 (lo reutiliza hasta 60 s antes de que venza); si no, consulta en modo anónimo. Llama a `https://opensky-network.org/api/states/all` con la caja de EE. UU.
   3. Valida la respuesta con Zod (`states` puede venir `null`).
   4. Convierte cada fila (un arreglo de 17 campos) en un `AircraftState` y descarta los aviones sin latitud o longitud.
10. **Vuelta al service:** guarda el resultado en la caché por `OPENSKY_CACHE_TTL_MS` milisegundos.
11. **Vuelta al controller:** responde `{ time, count, aircraft: [...] }`.
12. **`correlationId`** escribe al final el log `"request completed"` con el estado y la duración.

**Si algo falla** (cuota agotada, timeout, credenciales malas), el provider lanza un `AppError` y Express lo lleva al **`errorHandler`**, que responde por ejemplo:
```json
{ "error": { "code": "OPENSKY_QUOTA_EXCEEDED", "message": "...", "correlationId": "..." } }
```
El servidor sigue funcionando. Si la caché tenía un dato viejo, se sirve ese dato en vez del error.

---

## 3. Preguntas que podría hacer el profesor

**1. ¿Por qué `app.ts` y `server.ts` están separados?**
`app.ts` configura la aplicación y `server.ts` la pone a escuchar en un puerto. Así se puede probar `app` sin abrir un puerto real, y cada archivo tiene una sola responsabilidad.

**2. ¿Para qué sirve el `x-correlation-id`?**
Es un id por petición que aparece en la respuesta y en todos sus logs. Si alguien reporta un error, con ese id se encuentra todo lo que pasó en esa petición.

**3. ¿Por qué validan el `.env` con Zod?**
Para fallar al arrancar si falta una variable o tiene un valor inválido, y no a mitad de una petición. Además, `env` queda tipado: `env.PORT` es un número, no un texto.

**4. ¿Por qué el frontend no llama directo a OpenSky?**
Porque las credenciales quedarían expuestas en el navegador y cada usuario gastaría cuota. El backend centraliza la llamada, guarda el token y usa caché para que muchos usuarios compartan una sola consulta.

**5. ¿Cómo funciona la caché y qué pasa si llegan dos peticiones a la vez?**
Guarda el resultado en memoria con una fecha de vencimiento (TTL). Si dos peticiones llegan mientras se carga, la segunda espera la misma promesa, así que se hace una sola llamada a OpenSky.

**6. ¿Cómo sabes qué campo es la latitud en la respuesta de OpenSky?**
Por la documentación oficial: cada estado es un arreglo en orden fijo. El índice 5 es la longitud y el 6 la latitud. Los índices están en la constante `F` del provider.

**7. ¿Qué pasa si OpenSky responde 429 o no responde a tiempo?**
El provider convierte el error en un `AppError`: 503 `OPENSKY_QUOTA_EXCEEDED` o 504 `OPENSKY_TIMEOUT`. El `errorHandler` responde un JSON claro y el servidor no se cae. Si hay un dato viejo en la caché, se sirve ese.

**8. ¿Por qué el provider no está en `repositories/`?**
El repository accede a nuestra base de datos (Prisma); el provider accede a una API externa. Cumplen el mismo papel (aislar la fuente de datos), pero separarlos deja claro de dónde viene cada dato.

---

**9. ¿Por qué varias APIs y no una?**
Cada una da algo que las otras no dan, y se usa la más barata para cada dato. OpenSky da la posición en vivo, pero no sabe el origen ni el destino. adsbdb da el avión y una ruta aproximada gratis. Aviationstack da la ruta real, horarios y puertas, pero su plan gratis solo alcanza para 100 consultas al mes, por eso solo se llama cuando el usuario pulsa "Ver horarios". hexdb completa las coordenadas de los aeropuertos.

**9b. ¿Por qué las horas de Aviationstack se convierten?**
Aviationstack manda la hora local del aeropuerto, pero marcada como UTC (`+00:00`). Con AAL3304 se notó: la salida "17:40 UTC" implicaba 5 h de vuelo en un trayecto de 3 h. El provider toma la hora de reloj y la convierte con la zona horaria del aeropuerto (`America/New_York`), que viene en la misma respuesta.

**10. ¿Cómo saben si la ruta es correcta?**
adsbdb devuelve la ruta asignada al indicativo, que a veces está desactualizada. El service suma la distancia del origen al avión y del avión al destino; si es más de un 20 % mayor que la distancia directa, o si el rumbo del avión se aleja más de 90° de la dirección al destino, el avión no está en esa ruta y se marca `verified: false`. Por ejemplo, UAL19 decía JFK→SFO pero volaba hacia el noreste sobre el Atlántico. Si además el recorrido de OpenSky muestra el despegue, manda el origen: DAL803 figuraba LAX→SEA en adsbdb, pero despegó de Dallas, así que no se confirma.

## 4. Dato importante sobre la cuota de OpenSky

Una consulta de toda la caja de EE. UU. cuesta **4 créditos**. Una cuenta registrada tiene **4000 créditos al día**: unas 1000 consultas. Con TTL de 10 s y el mapa abierto, son hasta 360 consultas por hora (1440 créditos), así que la cuota alcanza para unas 2 o 3 horas de uso continuo. Por eso `.env.example` trae `OPENSKY_CACHE_TTL_MS=30000` (el mínimo y valor por defecto es `10000`). Durante el desarrollo conviene dejarlo así y apagar el servidor cuando no se use.
