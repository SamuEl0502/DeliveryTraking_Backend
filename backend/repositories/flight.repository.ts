import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

const airportSelect = {
  iataCode: true,
  icaoCode: true,
  name: true,
  city: true,
  lat: true,
  lng: true,
  timezone: true,
} satisfies Prisma.AirportSelect;

// De los envíos solo hace falta el peso, para calcular la capacidad restante
const flightSelect = {
  id: true,
  flightNumber: true,
  callsign: true,
  aircraftIcao24: true,
  status: true,
  scheduledDeparture: true,
  scheduledArrival: true,
  capacityKg: true,
  version: true,
  origin: { select: airportSelect },
  destination: { select: airportSelect },
  shipments: { select: { weightKg: true } },
} satisfies Prisma.FlightSelect;

export type FlightRecord = Prisma.FlightGetPayload<{ select: typeof flightSelect }>;

export interface FlightFilters {
  origin?: string | undefined;
  destination?: string | undefined;
  /** Día de salida en UTC, AAAA-MM-DD */
  date?: string | undefined;
}

export function findMany({ origin, destination, date }: FlightFilters): Promise<FlightRecord[]> {
  const where: Prisma.FlightWhereInput = {};
  if (origin) where.origin = { iataCode: origin };
  if (destination) where.destination = { iataCode: destination };
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const nextDay = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    where.scheduledDeparture = { gte: start, lt: nextDay };
  }
  // El id desempata los vuelos a la misma hora para que las páginas no cambien de orden
  return prisma.flight.findMany({
    where,
    select: flightSelect,
    orderBy: [{ scheduledDeparture: 'asc' }, { id: 'asc' }],
  });
}

export function findById(id: string): Promise<FlightRecord | null> {
  return prisma.flight.findUnique({ where: { id }, select: flightSelect });
}
