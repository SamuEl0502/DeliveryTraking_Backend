import type { Logger } from 'pino';
import * as flightRepository from '../repositories/flight.repository.ts';
import type { FlightRecord } from '../repositories/flight.repository.ts';
import * as userRepository from '../repositories/user.repository.ts';
import type { Flight, FlightList } from '../types/flight.ts';
import { AppError } from '../utils/AppError.ts';
import type { FlightAircraftInput, FlightListQuery } from '../validators/flight.validator.ts';
import * as aircraftService from './aircraft.service.ts';
import type { AuthUser } from './token.service.ts';

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

function versionConflict(): AppError {
  return new AppError(409, 'VERSION_CONFLICT', 'El vuelo cambió desde que lo consultaste; vuelve a cargarlo e intenta de nuevo');
}

// Staff solo opera vuelos que salen de su aeropuerto; Admin no tiene restricción
async function assertAirport(actor: AuthUser, originId: string): Promise<void> {
  if (actor.role === 'ADMIN') return;
  const user = await userRepository.findById(actor.id);
  if (user?.airportId !== originId) {
    throw new AppError(403, 'FORBIDDEN_AIRPORT', 'Solo puedes operar vuelos que salen de tu aeropuerto');
  }
}

// Antes de consultar OpenSky: un cambio que no se puede hacer no gasta créditos, y no se revelan vuelos de otro aeropuerto
async function checkAircraftChange(id: string, actor: AuthUser, expectedVersion: number): Promise<void> {
  const record = await flightRepository.findById(id);
  if (!record) throw new AppError(404, 'FLIGHT_NOT_FOUND', `No existe un vuelo con el id ${id}`);
  await assertAirport(actor, record.originId);
  if (record.version !== expectedVersion) throw versionConflict();
}

// Si otra petición cambió el vuelo antes, responde 409 en vez de pisar su cambio
async function saveAircraft(id: string, aircraftIcao24: string | null, expectedVersion: number): Promise<Flight> {
  if (!(await flightRepository.setAircraft(id, aircraftIcao24, expectedVersion))) throw versionConflict();
  return getById(id);
}

export async function setAircraft(id: string, input: FlightAircraftInput, actor: AuthUser, log: Logger): Promise<Flight> {
  await checkAircraftChange(id, actor, input.expectedVersion);
  // El avión tiene que estar en OpenSky ahora mismo; si no, aircraftService lanza 404 AIRCRAFT_NOT_FOUND
  await aircraftService.getAircraftByIcao24(input.icao24, log);
  return saveAircraft(id, input.icao24, input.expectedVersion);
}

export async function unsetAircraft(id: string, expectedVersion: number, actor: AuthUser): Promise<Flight> {
  await checkAircraftChange(id, actor, expectedVersion);
  return saveAircraft(id, null, expectedVersion);
}
