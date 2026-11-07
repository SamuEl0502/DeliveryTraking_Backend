import type { Prisma, TrackingEventType } from '@prisma/client';
import { prisma } from '../config/prisma.ts';
import { shipmentSelect } from './shipment.repository.ts';
import type { ShipmentRecord } from './shipment.repository.ts';

export type Tx = Prisma.TransactionClient;

export function inTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(work);
}

const lockedShipmentSelect = {
  flightId: true,
  originId: true,
  destinationId: true,
  status: true,
  weightKg: true,
} satisfies Prisma.ShipmentSelect;

export type LockedShipment = Prisma.ShipmentGetPayload<{ select: typeof lockedShipmentSelect }>;

// Actualizar la fila la bloquea hasta el final de la transacción: una petición sobre el mismo envío espera y lee el estado nuevo
export async function lockShipment(tx: Tx, id: string): Promise<LockedShipment | null> {
  const { count } = await tx.shipment.updateMany({ where: { id }, data: { version: { increment: 1 } } });
  if (count === 0) return null;
  return tx.shipment.findUniqueOrThrow({ where: { id }, select: lockedShipmentSelect });
}

const lockedFlightSelect = {
  id: true,
  flightNumber: true,
  version: true,
  status: true,
  capacityKg: true,
  originId: true,
  destinationId: true,
} satisfies Prisma.FlightSelect;

export type LockedFlight = Prisma.FlightGetPayload<{ select: typeof lockedFlightSelect }>;

// Incrementa version en cada vuelo y lo devuelve ya incrementado; los que no existen no aparecen en el resultado.
// Siempre en orden de id: dos reasignaciones cruzadas (A a B y B a A) no pueden bloquearse entre sí
export async function lockFlights(tx: Tx, ids: string[]): Promise<Map<string, LockedFlight>> {
  const sorted = [...new Set(ids)].sort();
  for (const id of sorted) {
    await tx.flight.updateMany({ where: { id }, data: { version: { increment: 1 } } });
  }
  const flights = await tx.flight.findMany({ where: { id: { in: sorted } }, select: lockedFlightSelect });
  return new Map(flights.map((f) => [f.id, f]));
}

export async function availableKg(tx: Tx, flight: LockedFlight): Promise<Prisma.Decimal> {
  const { _sum } = await tx.shipment.aggregate({ where: { flightId: flight.id }, _sum: { weightKg: true } });
  // La suma es null cuando el vuelo aún no tiene envíos
  return _sum.weightKg ? flight.capacityKg.minus(_sum.weightKg) : flight.capacityKg;
}

export interface FlightChange {
  shipmentId: string;
  flightId: string | null;
  eventType: TrackingEventType;
  airportId: string;
  actorId: string;
}

export function changeFlight(
  tx: Tx,
  { shipmentId, flightId, eventType, airportId, actorId }: FlightChange,
): Promise<ShipmentRecord> {
  return tx.shipment.update({
    where: { id: shipmentId },
    data: { flightId, events: { create: { type: eventType, airportId, createdById: actorId } } },
    select: shipmentSelect,
  });
}
