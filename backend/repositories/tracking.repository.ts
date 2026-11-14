import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.ts';
import { airportSelect } from './flight.repository.ts';

// Resumen público del envío más el avión del vuelo; ni dueño, ni descripción, ni historial
const trackingSelect = {
  trackingCode: true,
  status: true,
  flight: {
    select: {
      flightNumber: true,
      callsign: true,
      aircraftIcao24: true,
      status: true,
      scheduledDeparture: true,
      scheduledArrival: true,
      origin: { select: airportSelect },
      destination: { select: airportSelect },
    },
  },
} satisfies Prisma.ShipmentSelect;

export type TrackingRecord = Prisma.ShipmentGetPayload<{ select: typeof trackingSelect }>;

export function findByTrackingCode(trackingCode: string): Promise<TrackingRecord | null> {
  return prisma.shipment.findUnique({ where: { trackingCode }, select: trackingSelect });
}
