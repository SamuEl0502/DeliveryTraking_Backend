# Cambios de la API: asignación de envíos

Notas para integrar el frontend con la asignación, reasignación y desasignación de envíos. Lo que se pueda resumir en una fila también va en "Cambios importantes en la API" del `README.md`.

## Después de fusionar

Dentro de `backend/`:

```powershell
npm install
npm run db:deploy
npm run db:seed
```

**Cuidado:** `npm run db:seed` ahora borra todos los envíos que no sean del seed, con sus eventos, y pone `version` en 0. Sirve para que la demo empiece siempre igual. No corre con `NODE_ENV=production`.

## Cómo asignar un envío

1. Obtén el `id` del envío con `GET /api/shipments/:trackingCode`.
2. Obtén el `id` y la `version` del vuelo con `GET /api/flights`.
3. Envía esa `version` como `expectedFlightVersion` en `POST /api/assignments`.
4. Si responde 409 `VERSION_CONFLICT`, recarga el vuelo, muéstrale al usuario que cambió y deja que reintente.

## Endpoints nuevos

Solo para `STAFF` y `ADMIN`, con `Authorization: Bearer <access token>`. Sin token responden 401, y con `CLIENT`, 403.

### `POST /api/assignments`

Asigna el envío al vuelo o lo reasigna si ya tenía uno. Todos los campos son obligatorios.

```json
{
  "shipmentId": "4f7c1f0e-8a39-4b52-9d11-2c6e7a1b3d90",
  "flightId": "a1d9c2b4-6e57-4f08-8c33-71be0f5a2e14",
  "expectedFlightVersion": 3
}
```

`expectedFlightVersion` debe ser un número entero, no un texto.

### `DELETE /api/assignments/:shipmentId`

Quita el envío de su vuelo y libera su peso. No lleva body ni `expectedFlightVersion`. El envío conserva su ruta y luego solo se puede asignar a un vuelo con esa misma ruta.

### Respuesta

Ambos responden 200 con el mismo formato de `GET /api/shipments/:trackingCode`. Con `DELETE`, `flight` llega en `null`.

```json
{
  "id": "4f7c1f0e-8a39-4b52-9d11-2c6e7a1b3d90",
  "trackingCode": "DT-K2M4P6",
  "description": "Paquete de ropa",
  "weightKg": 12.5,
  "status": "RECEIVED",
  "createdAt": "2026-11-06T20:00:00.000Z",
  "updatedAt": "2026-11-06T21:30:00.000Z",
  "flight": {
    "flightNumber": "DT102",
    "callsign": null,
    "status": "SCHEDULED",
    "scheduledDeparture": "2026-12-01T20:00:00.000Z",
    "scheduledArrival": "2026-12-01T22:05:00.000Z",
    "origin": { "iataCode": "ATL", "icaoCode": "KATL", "name": "...", "city": "Atlanta", "lat": 33.6367, "lng": -84.428101, "timezone": "America/New_York" },
    "destination": { "iataCode": "ORD", "icaoCode": "KORD", "name": "...", "city": "Chicago", "lat": 41.9786, "lng": -87.9048, "timezone": "America/Chicago" }
  },
  "events": [
    { "id": "...", "type": "REASSIGNED", "occurredAt": "2026-11-06T21:30:00.000Z", "note": null, "airport": { "iataCode": "ATL", "name": "...", "city": "Atlanta" } },
    { "id": "...", "type": "RECEIVED", "occurredAt": "2026-11-06T08:00:00.000Z", "note": null, "airport": { "iataCode": "ATL", "name": "...", "city": "Atlanta" } }
  ]
}
```

### Errores

Usan el formato de siempre: `{ "error": { "code", "message", "correlationId" } }`.

| HTTP | `code` | Cuándo | Qué hacer en la vista |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Faltan datos o tienen un formato inválido | Revisar el formulario |
| 401 | `UNAUTHORIZED` | Sin token | Llevar al login |
| 403 | `FORBIDDEN` | El usuario es `CLIENT` | Ocultar la opción |
| 403 | `FORBIDDEN_AIRPORT` | `STAFF` con un vuelo que no sale de su aeropuerto, o sin aeropuerto asignado | Mostrar el mensaje |
| 404 | `SHIPMENT_NOT_FOUND` | El envío no existe | Mostrar el mensaje |
| 404 | `FLIGHT_NOT_FOUND` | El vuelo no existe | Recargar la lista |
| 409 | `VERSION_CONFLICT` | El vuelo cambió desde que se leyó | Recargar el vuelo y reintentar |
| 400 | `FLIGHT_NOT_AVAILABLE` | El vuelo no está `SCHEDULED` | Recargar la lista |
| 400 | `ROUTE_MISMATCH` | El origen o el destino no coinciden con los del envío | Mostrar solo vuelos de esa ruta |
| 400 | `SHIPMENT_NOT_ASSIGNABLE` | El envío ya no está en `RECEIVED` | Ocultar la acción |
| 400 | `ALREADY_ASSIGNED` | El envío ya está en ese vuelo | Quitar ese vuelo de las opciones |
| 400 | `INSUFFICIENT_CAPACITY` | No cabe; el mensaje indica el peso y los kg disponibles | Mostrar el mensaje |
| 400 | `SHIPMENT_NOT_ASSIGNED` | `DELETE` de un envío sin vuelo | Recargar el envío |

## `expectedFlightVersion` y el 409

- Sale del campo `version` de `GET /api/flights` o `GET /api/flights/:id`.
- La `version` sube cuando se asigna, reasigna o desasigna un envío del vuelo, y también cuando un cliente crea un envío en ese vuelo con `POST /api/shipments`. Por eso puede llegar un 409 aunque nadie más esté usando la vista de Staff.
- Al reasignar sube en los dos vuelos, así que hay que recargar ambos.

## Capacidad

`capacityKg` es la capacidad total y no cambia al asignar. Para saber el espacio libre, usa `remainingCapacityKg`, y para el peso ocupado, `assignedKg`.

## Rol `ADMIN`

- `Role` ahora es `CLIENT`, `STAFF` o `ADMIN`. El valor llega en el usuario de `/api/auth/login` y `/api/auth/me`, y el token del rol `ADMIN` es válido en toda la API.
- `ADMIN` puede usar `/api/flights` y `/api/assignments`, sin límite de aeropuerto. No puede usar `POST /api/shipments` ni `GET /api/shipments/available-flights`, que son solo para `CLIENT`.
- En el frontend, agrega `ADMIN` a los tipos y a los `meta.roles` de las rutas de Staff.

## Cambios en los tipos

- `ShipmentDetail` ahora incluye `id`.
- El `type` de los eventos puede ser también `ASSIGNED`, `REASSIGNED` o `UNASSIGNED`. Si la línea de tiempo traduce los tipos, hay que agregar estos tres.
- `backend/types/assignment.ts` trae el contrato `CreateAssignmentRequest`; cópialo a `src/types/`.

## Datos de prueba

Todos los usuarios usan la clave `Prueba123`.

| Usuario | Rol | Alcance |
|---|---|---|
| `cliente@deliverytracking.test` | `CLIENT` | Dueño de los envíos del seed |
| `staff@deliverytracking.test` | `STAFF` | Solo vuelos que salen de ATL |
| `admin@deliverytracking.test` | `ADMIN` | Sin límite |

| Código | Estado | Vuelo | Para mostrar |
|---|---|---|---|
| `DT-K2M4P6` | `RECEIVED` | DT101 | Reasignar a DT102 (`REASSIGNED`) |
| `DT-Q7R8S9` | `RECEIVED` | DT101 | Pasar a DT102: 1500 kg no caben en 1400 (`INSUFFICIENT_CAPACITY`) |
| `DT-T3V5W6` | `RECEIVED` | Sin vuelo | Asignar a DT101 o DT102 (`ASSIGNED`) |
| `DT-A1B2C3` | `RECEIVED` | DT101 | Pasar a DT103: otro destino (`ROUTE_MISMATCH`) |
| `DT-D4E5F6` | `LOADED` | DT202 | Moverlo como `ADMIN` (`SHIPMENT_NOT_ASSIGNABLE`) o como `staff@` (`FORBIDDEN_AIRPORT`) |
| `DT-G7H8J9` | `DELIVERED` | DT303 | Historial completo |

## Pendiente

- **Listado para Staff:** no hay un endpoint de envíos pendientes. Por ahora, el `shipmentId` solo se obtiene consultando un código de seguimiento, así que la vista de asignación necesita pedirlo o esperar ese listado.
- **`GET /api/shipments/:trackingCode` sigue siendo público:** cualquiera con el código ve el envío, su `id` y su historial. El plan pide limitarlo a su dueño y a Staff.
