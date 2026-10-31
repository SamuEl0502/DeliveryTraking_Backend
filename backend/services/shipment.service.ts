import type { FlightStatus, ShipmentStatus, TrackingEventType } from '@prisma/client';
import * as shipmentRepository from '../repositories/shipment.repository.ts';
import type { ShipmentRecord } from '../repositories/shipment.repository.ts';
import { AppError } from '../utils/AppError.ts';

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

// Prisma devuelve el peso como Decimal y las fechas como Date: aquí quedan en número y texto
function toDetail(s: ShipmentRecord): ShipmentDetail {
  return {
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
