# Cambios de Sebastián: filtro de vuelos incompletos (B1)

Rama: `feature/filtro-vuelos-completos`. Sin commits todavía: los revisa y hace el usuario.

## Qué hace

Los vuelos de la base de datos que les falten datos vitales ya no salen en la lista de vuelos (`GET /api/flights`). Un vuelo está completo si tiene:

1. **Código IATA de origen** (`origin.iataCode`, no vacío).
2. **Código IATA de destino** (`destination.iataCode`, no vacío).
3. **Indicativo** (`callsign`, por ejemplo `AAL3304`).

En la base de datos los aeropuertos son obligatorios, así que el filtro solo cubre el caso de código vacío.

No son requisito:
- **El avión** (`aircraftIcao24`). Los vuelos programados nacen sin avión y el Staff lo asigna después (tarea B2). Si pidiéramos el avión, esos vuelos nunca aparecerían.
- **La posición** (`lastKnownLat`, `lastKnownLng`...). Un vuelo programado todavía no tiene posición.

## Dónde se aplica

Una sola función, `isComplete(flight)` en [`backend/services/flight.service.ts`](backend/services/flight.service.ts), usada en `list`:

| Endpoint | Función | Efecto |
|---|---|---|
| `GET /api/flights` | `flight.service.ts` → `list` | Los incompletos no salen en `flights` y no cuentan en `pagination.total` |

El filtro va antes de los filtros de capacidad y de paginación, así que `total` y `totalPages` cuadran.

No se aplica en:
- `GET /api/flights/:id`: un vuelo incompleto sigue existiendo y se puede consultar por id. Si se quiere que responda 404, es un cambio de una línea en `getById`.
- `GET /api/shipments/available-flights` (`shipment.service.ts`): ese archivo es de Samuel y no se toca en esta tarea. Por eso ese endpoint todavía puede ofrecer vuelos incompletos. Hay que decidir con Samuel si se añade el mismo filtro allí.

## Cambio de contrato

- `GET /api/flights` puede devolver menos vuelos y un `pagination.total` menor.
- Ningún campo nuevo, ningún campo quitado.
- El frontend no necesita cambios de código para seguir funcionando; sí debe saber que la lista puede estar más corta.

## Verificación

- `npm run typecheck` (dentro de `backend/`).
- `npm run check`: tiene un assert nuevo que prueba `isComplete` con un vuelo completo y con cuatro casos: sin indicativo (incompleto), sin avión (completo), origen sin IATA (incompleto) y destino sin IATA (incompleto).

## Pendiente o decidido por defecto

- **Posición:** no se exige. Si el equipo la quiere para vuelos en el aire, es otra regla.
- **Código IATA:** solo se revisa que no esté vacío. No se valida el formato de 3 letras, porque la base ya lo fuerza con `CHAR(3)`.
- **Vuelos sin avión:** siguen apareciendo en la lista hasta que el Staff les asigne uno (B2).
- **`available-flights`:** pendiente de decidir con Samuel (ver arriba).
