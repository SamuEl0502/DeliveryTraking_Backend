import * as assignmentRepository from '../repositories/assignment.repository.ts';
import type { LockedShipment } from '../repositories/assignment.repository.ts';
import * as userRepository from '../repositories/user.repository.ts';
import { AppError } from '../utils/AppError.ts';
import type { CreateAssignmentInput } from '../validators/assignment.validator.ts';
import { toDetail } from './shipment.service.ts';
import type { ShipmentDetail } from './shipment.service.ts';
import type { AuthUser } from './token.service.ts';

// El aeropuerto se lee de la base porque no viaja en el token. Un Staff sin aeropuerto no puede operar
async function airportGuard(actor: AuthUser): Promise<(originId: string) => void> {
  if (actor.role === 'ADMIN') return () => {};
  const user = await userRepository.findById(actor.id);
  return (originId) => {
    if (user?.airportId !== originId) {
      throw new AppError(403, 'FORBIDDEN_AIRPORT', 'Solo puedes operar vuelos que salen de tu aeropuerto');
    }
  };
}

function shipmentNotFound(id: string): AppError {
  return new AppError(404, 'SHIPMENT_NOT_FOUND', `No existe un envío con el id ${id}`);
}

// Solo un envío recibido sigue en tierra sin cargar; después de eso ya no se puede cambiar de vuelo
function assertAssignable(shipment: LockedShipment): void {
  if (shipment.status !== 'RECEIVED') {
    throw new AppError(400, 'SHIPMENT_NOT_ASSIGNABLE', `Un envío en estado ${shipment.status} no se puede cambiar de vuelo`);
  }
}

// Cualquier error lanzado dentro de la transacción la revierte completa, incluidos los incrementos de version
export async function assign(input: CreateAssignmentInput, actor: AuthUser): Promise<ShipmentDetail> {
  const { shipmentId, flightId, expectedFlightVersion } = input;
  const assertAirport = await airportGuard(actor);

  const record = await assignmentRepository.inTransaction(async (tx) => {
    const shipment = await assignmentRepository.lockShipment(tx, shipmentId);
    if (!shipment) throw shipmentNotFound(shipmentId);

    const flights = await assignmentRepository.lockFlights(
      tx,
      shipment.flightId ? [flightId, shipment.flightId] : [flightId],
    );
    const flight = flights.get(flightId);
    if (!flight) throw new AppError(404, 'FLIGHT_NOT_FOUND', `No existe un vuelo con el id ${flightId}`);

    // Antes que el 409, para no revelar datos de vuelos de otro aeropuerto
    assertAirport(flight.originId);
    // lockFlights ya incrementó la versión: la fila está bloqueada, así que dos peticiones no pueden pasar con la misma
    if (flight.version - 1 !== expectedFlightVersion) {
      throw new AppError(409, 'VERSION_CONFLICT', 'El vuelo cambió desde que lo consultaste; vuelve a cargarlo e intenta de nuevo');
    }
    if (flight.status !== 'SCHEDULED') {
      throw new AppError(400, 'FLIGHT_NOT_AVAILABLE', 'El vuelo ya no admite envíos');
    }
    if (flight.originId !== shipment.originId || flight.destinationId !== shipment.destinationId) {
      throw new AppError(400, 'ROUTE_MISMATCH', 'La ruta del vuelo no coincide con la del envío');
    }
    assertAssignable(shipment);
    if (shipment.flightId === flightId) {
      throw new AppError(400, 'ALREADY_ASSIGNED', `El envío ya está asignado al vuelo ${flight.flightNumber}`);
    }

    const available = await assignmentRepository.availableKg(tx, flight);
    if (available.lessThan(shipment.weightKg)) {
      throw new AppError(
        400,
        'INSUFFICIENT_CAPACITY',
        `Capacidad insuficiente: el envío pesa ${shipment.weightKg.toNumber()} kg y el vuelo tiene ${available.toNumber()} kg disponibles`,
      );
    }

    return assignmentRepository.changeFlight(tx, {
      shipmentId,
      flightId,
      eventType: shipment.flightId ? 'REASSIGNED' : 'ASSIGNED',
      airportId: flight.originId,
      actorId: actor.id,
    });
  });
  return toDetail(record);
}

export async function unassign(shipmentId: string, actor: AuthUser): Promise<ShipmentDetail> {
  const assertAirport = await airportGuard(actor);

  const record = await assignmentRepository.inTransaction(async (tx) => {
    const shipment = await assignmentRepository.lockShipment(tx, shipmentId);
    if (!shipment) throw shipmentNotFound(shipmentId);

    const { flightId } = shipment;
    if (!flightId) throw new AppError(400, 'SHIPMENT_NOT_ASSIGNED', 'El envío no tiene un vuelo asignado');

    const flights = await assignmentRepository.lockFlights(tx, [flightId]);
    // La llave foránea garantiza que el vuelo de un envío existe
    const flight = flights.get(flightId)!;

    assertAirport(flight.originId);
    assertAssignable(shipment);

    return assignmentRepository.changeFlight(tx, {
      shipmentId,
      flightId: null,
      eventType: 'UNASSIGNED',
      airportId: flight.originId,
      actorId: actor.id,
    });
  });
  return toDetail(record);
}
