# CONTEXTO DEL PROYECTO

> Pega este archivo al inicio de cada sesión con el asistente. Mantenerlo actualizado: si una decisión cambia, se edita aquí primero.

**Nombre:** pendiente
**Base del proyecto:** "Delivery Tracking con Tracking Geoespacial en Vivo: transmisión de geolocalización continua por WebSockets, suavizado de trayectoria en el frontend y recálculo dinámico de ETA".
**Enfoque:** rastreo de paquetes enviados en vuelos entre aeropuertos de EE. UU., con la posición del avión en vivo desde OpenSky Network.

---

## 1. MVP

> Un cliente autenticado ve sus envíos asociados a un vuelo y, mientras el paquete va en el aire, observa en un mapa la posición en vivo del avión y el ETA actualizado, junto con el historial de eventos del paquete.

Prioridad: cubrir primero el MVP y el estándar obligatorio. Todo lo demás es plus.

**Alcance fijo:** vuelos directos (sin escalas ni conexiones), dentro de EE. UU.

---

## 2. Idea central

Un paquete tiene dos tipos de rastreo independientes:

| Tipo | Quién lo genera | Dónde vive |
|---|---|---|
| Eventos del paquete (recibido, cargado, descargado, entregado) | Staff, manualmente | `TrackingEvent` en PostgreSQL |
| Posición del avión | OpenSky (automático) | Memoria del servidor + último estado en `Flight` |

OpenSky no sabe nada de la carga. Los dos flujos se cruzan solo a través del **estado del envío**.

---

## 3. Roles

- **Cliente:** crea y ve SOLO sus envíos (resource ownership), sigue el mapa en vivo y su historial.
- **Staff:** gestiona usuarios, aeropuertos y vuelos, asigna el avión a cada vuelo, registra eventos manuales y asigna envíos a vuelos. Campo opcional `airportId` para limitar su alcance a un aeropuerto sin crear otro rol.

---

## 4. Entidades

`User`, `Airport`, `Flight`, `Shipment`, `TrackingEvent`.

Campos clave a tener en cuenta:
- `Flight.aircraftIcao24`: el avión que hace el vuelo (lo asigna el Staff). OpenSky filtra por `icao24`; el `callsign` solo sirve para encontrar el avión la primera vez.
- `Flight.lastKnown*`: último estado conocido (lat, lng, rumbo, velocidad, timestamp, `onGround`).
- `Shipment.version` y `Flight.version`: bloqueo optimista.
- Las posiciones en vivo NO se guardan en PostgreSQL en cada ciclo.

---

## 5. Fuentes de datos (sin simulador)

**Posición de los aviones: OpenSky Network** (única fuente de posiciones). Para el panel del avión seleccionado se suman fuentes externas, siempre desde el backend y bajo demanda:

| Fuente | Para qué | Límite |
|---|---|---|
| adsbdb | Modelo, matrícula, foto y una ruta aproximada por indicativo | Gratis. Sus rutas no se pueden copiar a nuestra BD (solo caché en memoria) |
| Aviationstack | Ruta real del tramo activo, horarios, retraso, terminal y puerta | 100 peticiones al mes; solo con el botón "Ver horarios" |
| hexdb | Coordenadas de aeropuertos | Gratis |

Consecuencia para el modelo de datos: el origen y destino de un `Flight` los define el Staff o el seed de aeropuertos (OurAirports), no adsbdb.

Sobre OpenSky:

- `OpenSkyProvider` hace polling cada 5-10 s **solo** de los `icao24` de aviones con envíos activos. Nunca se pide el mapa mundial.
- **Aviones a consultar:** vuelos con envíos en `LOADED` (desde poco antes de la hora de salida) y en `IN_FLIGHT`. No basta con `IN_FLIGHT`, porque para detectar el despegue hay que consultar antes.
- **Pantalla "Vuelos en el aire ahora" (Staff):** consulta a OpenSky con una caja geográfica de EE. UU., en caché y refrescada poco. El Staff elige un avión y lo vincula al `Flight`.
- **Cuotas:** las cuentas anónimas tienen un cupo diario bajo. Usar cuenta registrada con OAuth2 (client id y secret en `.env`). Verificar los créditos vigentes en la documentación de OpenSky, porque cambian.
- **Sin datos de OpenSky:** se aplica la lógica de "última posición conocida" (sección 7).
- **Pruebas:** los estados automáticos y la pérdida de señal se prueban con respuestas grabadas (mocks) en los tests, no con un simulador dentro del producto.

---

## 6. Estados del envío

- **Manuales (Staff):** `RECEIVED` (recibido en bodega), `LOADED` (cargado al avión), `UNLOADED` (descargado), `DELIVERED` (entregado).
- **Automáticos (por datos del avión, usando `on_ground`):** despegó, aterrizó.
- **Regla:** un envío pasa a `IN_FLIGHT` solo si estaba `LOADED` **y** el avión despegó. Si el avión despega y el envío no estaba cargado, se genera una alerta y no se cambia el estado.
- Los cambios de estado se hacen en transacción con bloqueo optimista.

---

## 7. Tiempo real

Flujo: `OpenSkyProvider -> servicio de tracking (ETA en memoria) -> WebSocket (ws) -> navegador`.

- **Un canal de WebSocket por vuelo**, no por paquete. Si hay 20 paquetes en un avión, todos escuchan el mismo canal.
- **Seguridad:** el WebSocket se autentica al conectar con el access token. Al suscribirse a un vuelo se verifica que el usuario tenga un envío en él (ABAC).
- **Al suscribirse** el cliente recibe de inmediato la última posición conocida.
- **Payload:** objeto con claves cortas y tipo compartido en TS:
  `{ lat, lng, hdg, spd, ts, eta, src }` donde `src` es `"live"` o `"estimated"`.
- **Posición estimada:** si OpenSky no devuelve datos, se extrapola con el último rumbo y velocidad, se marca `estimated` y el mapa la muestra distinta (ícono atenuado, "señal perdida hace X min"). Pasado un límite de tiempo se deja de extrapolar.
- **Persistencia:** el último estado se guarda en la BD cada 30-60 s o al cambiar de estado.
- **ETA:** distancia restante / velocidad + retraso acumulado. Simple y explicable.
- **Frontend:** Leaflet + suavizado de trayectoria con interpolación lineal y `requestAnimationFrame`.
- **Cola en memoria** para procesar las posiciones entrantes.

---

## 8. Stack

**Backend:** Node + Express + TypeScript estricto, Prisma, PostgreSQL, Zod, `ws`, Axios (solo para consumir OpenSky).
**Frontend:** Vue 3 + Pinia + TypeScript estricto (sin `any`), Axios tipado, Leaflet.

---

## 9. Arquitectura (MVC clásico por tipo de carpeta)

Flujo de una petición:
`routes -> middlewares (auth, validación Zod) -> controller -> service -> repository -> BD`

Reglas:
- **Controller:** recibe la petición, llama al servicio y responde. Sin lógica de negocio.
- **Service:** lógica de negocio (ETA, reglas de estados, asignación).
- **Repository:** único que toca Prisma. Delgado (funciones que envuelven Prisma). Se mantiene porque el estándar exige Controladores, Servicios y Repositorios.
- **Model:** entidades (esquema Prisma + tipos).

### Backend (`backend/`)

```
config/          env (validado con Zod), BD, logger
controllers/     auth · flights · shipments · tracking · airports · users
middlewares/     authenticate · authorize · validate · correlationId · errorHandler · rateLimiter
models/          tipos y entidades
routes/          auth · flights · shipments · tracking · airports · users
services/        lógica de negocio
repositories/    acceso a datos (Prisma)
validators/      esquemas Zod
providers/       OpenSkyProvider
websocket/       servidor ws, canales por vuelo
utils/
migrations/      migraciones versionadas
server.ts
```

### Frontend (`frontend/src/`)

```
assets/ · components/ · views/ · router/ (con guards) · store/ (Pinia)
services/        Axios tipado con interceptores y reintentos
types/           contratos de la API (compartidos con el backend)
composables/     useWebSocket · useMap
main.ts · App.vue
```

---

## 10. Estándar técnico obligatorio

**Seguridad y acceso**
- Auth con doble token: access token en memoria + refresh token rotativo en cookie `HttpOnly`, `SameSite=Strict`, `Secure`, con revocación de sesiones concurrentes.
- RBAC/ABAC por middleware validando pertenencia del recurso.
- Hash con Argon2id. Validación con Zod, prevención de XSS/SQLi, rate limiting.

**Frontend**
- TypeScript estricto de punta a punta, sin `any` (modelos, estado, contratos de API).
- Pinia: tiendas normalizadas, persistencia selectiva, estados explícitos de carga, error y caché.
- Navigation Guards asíncronos. Axios tipado con interceptores y reintentos automáticos.

**Backend y persistencia**
- Arquitectura limpia por capas (SOLID).
- PostgreSQL con migraciones versionadas, transacciones ACID y bloqueo optimista.
- Manejo global de excepciones, logs estructurados con `x-correlation-id`, colas en memoria.

---

## 11. Convenciones

- **Idioma:** código, rutas y entidades en inglés (`/api/shipments`, `Shipment`); documentación y negocio en español.
- **Git:** ramas `feature/<nombre>`, PR obligatorio hacia `main`.
- **Secretos:** `.env` fuera de Git, `.env.example` sin valores reales.
- **Contrato primero:** se define el contrato de la API (endpoints + JSON) antes de implementar, para trabajar backend y frontend en paralelo.

---

## 12. Plan de arranque

1. Cerrar pendientes (sección 13).
2. Definir el contrato de la API.
3. Esqueleto del backend: `/health`, `x-correlation-id`, manejo de errores, env validado.
4. Prisma + migraciones + seed de aeropuertos.
5. Autenticación y autorización.
6. Módulos de vuelos y envíos.
7. `OpenSkyProvider` + servicio de tracking + WebSocket.
8. Frontend: login, lista de envíos y detalle con mapa en vivo.

---

## 13. Pendientes por cerrar

- [ ] Nombre del proyecto.
- [x] Registrar cuenta en OpenSky (OAuth2) y comprobar créditos disponibles.
- [x] Prueba rápida: consultar un avión de EE. UU. por `icao24` y ver campos devueltos y frecuencia de actualización.
- [ ] División del trabajo (quién backend, quién frontend).
- [ ] Contrato de la API.

---

## 14. Plus (solo con el MVP funcionando)

API de horarios real para los vuelos, detección automática de despegue/aterrizaje con sugerencia al Staff, PostGIS, notificaciones, panel del Staff por aeropuerto, escalas y conexiones.

---

## 15. Instrucciones para el asistente (ahorro de tokens)

- Responder corto; código solo del cambio pedido, no archivos completos.
- Respetar el flujo `routes -> middlewares -> controller -> service -> repository`.
- No inventar datos de aeronaves (`icao24`, matrículas) ni límites de OpenSky: remitir a su documentación.
- Si una decisión de este archivo cambia, avisar para actualizarlo.
