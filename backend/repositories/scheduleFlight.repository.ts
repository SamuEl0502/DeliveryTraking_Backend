import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

export const airportIdSelect = {
    id:true,
  iataCode: true,
} satisfies Prisma.AirportSelect;

export type airports = Prisma.AirportGetPayload<{select: typeof airportIdSelect}>

export async function coincidesAirports(IATACodes: string[]):Promise<airports[]>{
    return prisma.airport.findMany({where: {iataCode:{in: IATACodes}}, select:airportIdSelect});
}

// De cada vuelo solo hace falta lo que se devuelve en la importación
export const importedFlightSelect = {
  id: true,
  flightNumber: true,
  scheduledDeparture: true,
} satisfies Prisma.FlightSelect;

export type ImportedFlightRecord = Prisma.FlightGetPayload<{ select: typeof importedFlightSelect }>;

export interface NewFlightData {
  flightNumber: string;
  callsign: string;
  originId: string;
  destinationId: string;
  scheduledDeparture: Date;
  scheduledArrival: Date;
  capacityKg: number;
}

// Busca un vuelo con el mismo número cuya salida esté entre dos fechas (ambas incluidas)
export function findFlightBetween(flightNumber: string, from: Date, to: Date): Promise<ImportedFlightRecord | null> {
  return prisma.flight.findFirst({
    where: { flightNumber, scheduledDeparture: { gte: from, lte: to } },
    select: importedFlightSelect,
  });
}

// Solo inserta: nunca actualiza un vuelo que ya existe
export function createFlight(data: NewFlightData): Promise<ImportedFlightRecord> {
  return prisma.flight.create({
    data: { ...data, status: 'SCHEDULED' },
    select: importedFlightSelect,
  });
}