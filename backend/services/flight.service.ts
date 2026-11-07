import * as flightRepository from '../repositories/flight.repository.ts';
import type { FlightRecord } from '../repositories/flight.repository.ts';
import type { Flight, FlightList } from '../types/flight.ts';
import { AppError } from '../utils/AppError.ts';
import type { FlightListQuery } from '../validators/flight.validator.ts';

// shortcut: minCapacityKg y la paginación se aplican en memoria porque la capacidad restante se calcula con los envíos; pasar a SQL si hay miles de vuelos
export async function list(query: FlightListQuery): Promise<FlightList> {
  const { minCapacityKg = 0, page, limit } = query;
  const records = await flightRepository.findMany(query);
  const matching = records.map(toFlight).filter((f) => f.remainingCapacityKg >= minCapacityKg);

  return {
    flights: matching.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: matching.length, totalPages: Math.ceil(matching.length / limit) },
  };
}

export async function getById(id: string): Promise<Flight> {
  const record = await flightRepository.findById(id);
  if (!record) {
    throw new AppError(404, 'FLIGHT_NOT_FOUND', `No existe un vuelo con el id ${id}`);
  }
  return toFlight(record);
}

// Se resta con Decimal, no con number, para que los pesos no acumulen errores de redondeo (0.1 + 0.2)
export function toFlight(f: FlightRecord): Flight {
  const remaining = f.shipments.reduce((left, s) => left.minus(s.weightKg), f.capacityKg);
  return {
    id: f.id,
    flightNumber: f.flightNumber,
    callsign: f.callsign,
    aircraftIcao24: f.aircraftIcao24,
    status: f.status,
    scheduledDeparture: f.scheduledDeparture.toISOString(),
    scheduledArrival: f.scheduledArrival.toISOString(),
    origin: f.origin,
    destination: f.destination,
    capacityKg: f.capacityKg.toNumber(),
    assignedKg: f.capacityKg.minus(remaining).toNumber(),
    remainingCapacityKg: remaining.toNumber(),
    version: f.version,
  };
}
