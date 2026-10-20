import { PrismaClient } from '@prisma/client';

// Coordenadas de OurAirports (dominio público): https://ourairports.com/data/
const AIRPORTS = [
  { iataCode: 'ATL', icaoCode: 'KATL', name: 'Hartsfield Jackson Atlanta International Airport', city: 'Atlanta', lat: 33.6367, lng: -84.428101, timezone: 'America/New_York' },
  { iataCode: 'LAX', icaoCode: 'KLAX', name: 'Los Angeles International Airport', city: 'Los Angeles', lat: 33.942501, lng: -118.407997, timezone: 'America/Los_Angeles' },
  { iataCode: 'ORD', icaoCode: 'KORD', name: "Chicago O'Hare International Airport", city: 'Chicago', lat: 41.9786, lng: -87.9048, timezone: 'America/Chicago' },
  { iataCode: 'DFW', icaoCode: 'KDFW', name: 'Dallas Fort Worth International Airport', city: 'Dallas-Fort Worth', lat: 32.896801, lng: -97.038002, timezone: 'America/Chicago' },
  { iataCode: 'JFK', icaoCode: 'KJFK', name: 'John F. Kennedy International Airport', city: 'New York', lat: 40.639447, lng: -73.779317, timezone: 'America/New_York' },
];

const prisma = new PrismaClient();

// upsert: se puede correr varias veces sin duplicar
for (const airport of AIRPORTS) {
  await prisma.airport.upsert({ where: { iataCode: airport.iataCode }, update: airport, create: airport });
}
console.log(`seed: ${AIRPORTS.length} aeropuertos`);
await prisma.$disconnect();
