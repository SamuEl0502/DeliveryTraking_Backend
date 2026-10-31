import type { Prisma } from '@prisma/client';
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
