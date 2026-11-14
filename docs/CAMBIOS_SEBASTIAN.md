# Cambios de Sebastián

## B2: asignar avión a un vuelo

Rama: `feature/flight-aircraft`. Sin commits todavía: los revisa y hace el usuario.

### Contrato nuevo (para el frontend)

**`PATCH /api/flights/:id/aircraft`** asigna o cambia el avión de un vuelo.

Body:

```json
{ "icao24": "a39bfa", "expectedVersion": 3 }
```

- `icao24`: 6 caracteres hexadecimales. Se acepta en mayúsculas y se guarda en minúsculas.
- `expectedVersion`: la `version` que el cliente vio al consultar el vuelo (`GET /api/flights/:id` o la lista).

Respuesta `200`: el vuelo completo, igual que `GET /api/flights/:id`, con `aircraftIcao24` ya actualizado y `version` incrementada en 1.

**`DELETE /api/flights/:id/aircraft`** quita el avión asignado.

Body: `{ "expectedVersion": 4 }`. Respuesta `200`: el vuelo con `aircraftIcao24: null` y `version` incrementada en 1.

Ambos requieren sesión y rol `STAFF` o `ADMIN`. Un `CLIENT` recibe `403 FORBIDDEN`.

### Errores

| Estado | Código | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body mal formado (`icao24` con formato incorrecto, `expectedVersion` que no es entero ≥ 0) |
| 403 | `FORBIDDEN_AIRPORT` | Un `STAFF` intenta cambiar un vuelo cuyo aeropuerto de origen no es el suyo. `ADMIN` no tiene esta restricción |
| 404 | `FLIGHT_NOT_FOUND` | No existe el vuelo |
| 404 | `AIRCRAFT_NOT_FOUND` | El `icao24` no está en OpenSky ahora mismo. Solo en `PATCH` |
| 409 | `VERSION_CONFLICT` | `expectedVersion` no coincide con la versión actual del vuelo. Pasa también si otra petición cambió el vuelo a la vez |

Si hay `VERSION_CONFLICT`, el frontend debe volver a cargar el vuelo y reintentar con la versión nueva.

### Reglas

- El orden de las comprobaciones es: vuelo existe → aeropuerto del `STAFF` → versión → OpenSky. Así un cambio que no se puede hacer no gasta créditos de OpenSky.
- El `PATCH` consulta OpenSky con la misma función que `GET /api/aircraft/:icao24`. Si el avión está en la caché del mapa, no gasta créditos.
- La versión se comprueba otra vez dentro de la misma consulta que guarda el cambio, así que dos peticiones simultáneas no se pisan.

### Dónde está el código

- Ruta y controlador: [`backend/routes/flight.routes.ts`](backend/routes/flight.routes.ts), [`backend/controllers/flight.controller.ts`](backend/controllers/flight.controller.ts).
- Lógica: [`backend/services/flight.service.ts`](backend/services/flight.service.ts) (`setAircraft`, `unsetAircraft`).
- Acceso a datos: [`backend/repositories/flight.repository.ts`](backend/repositories/flight.repository.ts) (`setAircraft`).
- Validación: [`backend/validators/flight.validator.ts`](backend/validators/flight.validator.ts).

### Verificación

- `npm run typecheck` (dentro de `backend/`) pasa.
- `npm run check` pasa; tiene asserts nuevos para el body de `PATCH` y `DELETE`.
- **No probado contra la base de datos ni contra OpenSky real.** Falta probar: la respuesta 403 de un `STAFF` de otro aeropuerto, el 409 con versión vieja y el 404 de un `icao24` que no existe.

### Pendiente o decidido por defecto

- **Estado del vuelo:** el cambio no revisa el estado del vuelo. Se puede cambiar el avión de un vuelo ya `DEPARTED` o `LANDED`. Hay que decidir si se bloquea.
- **Versión y asignaciones de envíos:** la asignación de envíos (`assignment.service.ts`) también incrementa `version` del vuelo. Un cambio de avión hecho después de una asignación requiere la versión nueva. El frontend debe recargar el vuelo tras cada cambio.
- **Callsign:** `PATCH` no rellena el indicativo (`callsign`) con el de OpenSky. Eso sería una decisión aparte.
- **Eliminación del `DELETE`:** es opcional según la guía; se implementó igual para cubrir la desvinculación.
