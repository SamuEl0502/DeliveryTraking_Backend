import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { FlightStatus, ShipmentStatus, TrackingEventType } from '@prisma/client';
import * as flightRepository from '../repositories/flight.repository.ts';
import * as shipmentRepository from '../repositories/shipment.repository.ts';
import * as userRepository from '../repositories/user.repository.ts';
import type { FlightAvailability, ShipmentRecord, ShipmentSummaryRecord } from '../repositories/shipment.repository.ts';
import type { AvailableFlightList, ShipmentList } from '../types/shipment.ts';
import { AppError } from '../utils/AppError.ts';
import type { FlightListQuery } from '../validators/flight.validator.ts';
import type { CreateShipmentInput, MyShipmentsQuery, ShipmentListQuery } from '../validators/shipment.validator.ts';
import { toFlight } from './flight.service.ts';
import type { AuthUser } from './token.service.ts';

// Respuesta de GET /api/shipments/:trackingCode (fechas en ISO, UTC)
export interface ShipmentAirport {
  iataCode: string;
  icaoCode: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  timezone: string;
}

export interface ShipmentEvent {
  id: string;
  type: TrackingEventType;
  occurredAt: string;
  note: string | null;
  airport: { iataCode: string; name: string; city: string } | null;
}

export interface ShipmentDetail {
  id: string;
  trackingCode: string;
  description: string;
  weightKg: number;
  status: ShipmentStatus;
  createdAt: string;
  updatedAt: string;
  flight: {
    flightNumber: string;
    callsign: string | null;
    status: FlightStatus;
    scheduledDeparture: string;
    scheduledArrival: string;
    origin: ShipmentAirport;
    destination: ShipmentAirport;
  } | null;
  /** Del más reciente al más antiguo */
  events: ShipmentEvent[];
}

export async function getByTrackingCode(trackingCode: string): Promise<ShipmentDetail> {
  const shipment = await shipmentRepository.findByTrackingCode(trackingCode);
  if (!shipment) {
    throw new AppError(404, 'SHIPMENT_NOT_FOUND', `No existe un envío con el código ${trackingCode}`);
  }
  return toDetail(shipment);
}

// Envíos del usuario autenticado. Staff y Admin no son dueños de envíos: reciben la lista vacía
export async function listMine(ownerId: string, { page, limit }: MyShipmentsQuery): Promise<ShipmentList> {
  const [records, total] = await shipmentRepository.findPage({ ownerId }, page, limit);
  return toList(records, total, page, limit);
}

// Admin ve todos. Staff solo los que salen de su aeropuerto, que se lee de la base porque no viaja en el token
export async function list(actor: AuthUser, { status, page, limit }: ShipmentListQuery): Promise<ShipmentList> {
  let originId: string | undefined;
  if (actor.role !== 'ADMIN') {
    const user = await userRepository.findById(actor.id);
    if (!user?.airportId) {
      throw new AppError(403, 'FORBIDDEN_AIRPORT', 'No tienes un aeropuerto asignado');
    }
    originId = user.airportId;
  }
  const [records, total] = await shipmentRepository.findPage({ originId, status }, page, limit);
  return toList(records, total, page, limit);
}

function toList(records: ShipmentSummaryRecord[], total: number, page: number, limit: number): ShipmentList {
  return {
    shipments: records.map((s) => ({
      id: s.id,
      trackingCode: s.trackingCode,
      status: s.status,
      weightKg: s.weightKg.toNumber(),
      createdAt: s.createdAt.toISOString(),
      origin: s.origin,
      destination: s.destination,
      hasFlight: s.flightId !== null,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// Sin letras ni números que se confundan al leerlos (I, O, 0, 1)
const TRACKING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TRACKING_CODE_ATTEMPTS = 3;

function generateTrackingCode(): string {
  const chars = Array.from({ length: 6 }, () => TRACKING_CODE_ALPHABET.charAt(randomInt(TRACKING_CODE_ALPHABET.length)));
  return `DT-${chars.join('')}`;
}

export async function create(input: CreateShipmentInput, ownerId: string): Promise<ShipmentDetail> {
  for (let attempt = 1; ; attempt++) {
    try {
      const shipment = await shipmentRepository.createOnFlight(
        { ...input, ownerId, trackingCode: generateTrackingCode() },
        (flight) => authorizeOnFlight(flight, input.weightKg),
      );
      if (!shipment) {
        throw new AppError(404, 'FLIGHT_NOT_FOUND', `No existe un vuelo con el id ${input.flightId}`);
      }
      return toDetail(shipment);
    } catch (err) {
      // El único campo único que se genera aquí es trackingCode: si ya existe, se prueba con otro
      const repeatedCode = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!repeatedCode || attempt === TRACKING_CODE_ATTEMPTS) throw err;
    }
  }
}

function authorizeOnFlight({ status, availableKg }: FlightAvailability, weightKg: number): void {
  if (status !== 'SCHEDULED') {
    throw new AppError(400, 'FLIGHT_NOT_AVAILABLE', 'El vuelo ya no admite envíos');
  }
  if (availableKg.lessThan(weightKg)) {
    throw new AppError(
      400,
      'INSUFFICIENT_CAPACITY',
      `Capacidad insuficiente: el envío pesa ${weightKg} kg y el vuelo tiene ${availableKg.toNumber()} kg disponibles`,
    );
  }
}

// shortcut: los filtros de estado, salida y capacidad se aplican en memoria como en flight.service; pasar a SQL si hay miles de vuelos
export async function listAvailableFlights(query: FlightListQuery): Promise<AvailableFlightList> {
  const { minCapacityKg = 0, page, limit } = query;
  const now = Date.now();
  const records = await flightRepository.findMany(query);
  const matching = records
    .map(toFlight)
    .filter(
      (f) =>
        f.status === 'SCHEDULED' &&
        Date.parse(f.scheduledDeparture) > now &&
        f.remainingCapacityKg > 0 &&
        f.remainingCapacityKg >= minCapacityKg,
    );

  return {
    // Se eligen los campos uno a uno para no exponer la capacidad al cliente
    flights: matching.slice((page - 1) * limit, page * limit).map((f) => ({
      id: f.id,
      flightNumber: f.flightNumber,
      scheduledDeparture: f.scheduledDeparture,
      scheduledArrival: f.scheduledArrival,
      origin: f.origin,
      destination: f.destination,
    })),
    pagination: { page, limit, total: matching.length, totalPages: Math.ceil(matching.length / limit) },
  };
}

// Prisma devuelve el peso como Decimal y las fechas como Date: aquí quedan en número y texto
export function toDetail(s: ShipmentRecord): ShipmentDetail {
  return {
    id: s.id,
    trackingCode: s.trackingCode,
    description: s.description,
    weightKg: s.weightKg.toNumber(),
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    flight: s.flight && {
      flightNumber: s.flight.flightNumber,
      callsign: s.flight.callsign,
      status: s.flight.status,
      scheduledDeparture: s.flight.scheduledDeparture.toISOString(),
      scheduledArrival: s.flight.scheduledArrival.toISOString(),
      origin: s.flight.origin,
      destination: s.flight.destination,
    },
    events: s.events.map((e) => ({
      id: e.id,
      type: e.type,
      occurredAt: e.occurredAt.toISOString(),
      note: e.note,
      airport: e.airport,
    })),
  };
}
