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