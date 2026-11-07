import type { FlightStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

// Solo los campos que se muestran; el dueño (owner) no se trae para no exponer sus datos
const airportSelect = {
  iataCode: true,
  icaoCode: true,
  name: true,
  city: true,
  lat: true,
  lng: true,
  timezone: true,
} satisfies Prisma.AirportSelect;

const shipmentSelect = {
  trackingCode: true,
  description: true,
  weightKg: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  flight: {
    select: {
      flightNumber: true,
      callsign: true,
      status: true,
      scheduledDeparture: true,
      scheduledArrival: true,
      origin: { select: airportSelect },
      destination: { select: airportSelect },
    },
  },
  // Del más reciente al más antiguo
  events: {
    select: {
      id: true,
      type: true,
      occurredAt: true,
      note: true,
      airport: { select: { iataCode: true, name: true, city: true } },
    },
    orderBy: { occurredAt: 'desc' },
  },
} satisfies Prisma.ShipmentSelect;

export type ShipmentRecord = Prisma.ShipmentGetPayload<{ select: typeof shipmentSelect }>;

export function findByTrackingCode(trackingCode: string): Promise<ShipmentRecord | null> {
  return prisma.shipment.findUnique({ where: { trackingCode }, select: shipmentSelect });
}

export interface NewShipment {
  trackingCode: string;
  description: string;
  weightKg: number;
  ownerId: string;
  flightId: string;
}

export interface FlightAvailability {
  status: FlightStatus;
  availableKg: Prisma.Decimal;
}

// Devuelve null si el vuelo no existe. Si authorize lanza un error, la transacción se revierte completa
export function createOnFlight(
  shipment: NewShipment,
  authorize: (flight: FlightAvailability) => void,
): Promise<ShipmentRecord | null> {
  const { flightId } = shipment;
  return prisma.$transaction(async (tx) => {
    // Actualizar la fila la bloquea hasta el final: otro envío al mismo vuelo espera y luego suma también este peso
    const { count } = await tx.flight.updateMany({ where: { id: flightId }, data: { version: { increment: 1 } } });
    if (count === 0) return null;

    const flight = await tx.flight.findUniqueOrThrow({
      where: { id: flightId },
      select: { status: true, capacityKg: true, originId: true },
    });
    const { _sum } = await tx.shipment.aggregate({ where: { flightId }, _sum: { weightKg: true } });
    // La suma es null cuando el vuelo aún no tiene envíos
    const availableKg = _sum.weightKg ? flight.capacityKg.minus(_sum.weightKg) : flight.capacityKg;
    authorize({ status: flight.status, availableKg });

    return tx.shipment.create({
      data: { ...shipment, events: { create: { type: 'RECEIVED', airportId: flight.originId } } },
      select: shipmentSelect,
    });
  });
}
