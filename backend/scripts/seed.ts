import { PrismaClient } from '@prisma/client';
import type { FlightStatus, ShipmentStatus, TrackingEventType } from '@prisma/client';
import { argon2id, hash } from 'argon2';

// Datos de prueba para desarrollo: npm run db:seed (se puede correr varias veces sin duplicar)

// Coordenadas de OurAirports (dominio público): https://ourairports.com/data/
const AIRPORTS = [
  { iataCode: 'ATL', icaoCode: 'KATL', name: 'Hartsfield Jackson Atlanta International Airport', city: 'Atlanta', lat: 33.6367, lng: -84.428101, timezone: 'America/New_York' },
  { iataCode: 'LAX', icaoCode: 'KLAX', name: 'Los Angeles International Airport', city: 'Los Angeles', lat: 33.942501, lng: -118.407997, timezone: 'America/Los_Angeles' },
  { iataCode: 'ORD', icaoCode: 'KORD', name: "Chicago O'Hare International Airport", city: 'Chicago', lat: 41.9786, lng: -87.9048, timezone: 'America/Chicago' },
  { iataCode: 'DFW', icaoCode: 'KDFW', name: 'Dallas Fort Worth International Airport', city: 'Dallas-Fort Worth', lat: 32.896801, lng: -97.038002, timezone: 'America/Chicago' },
  { iataCode: 'JFK', icaoCode: 'KJFK', name: 'John F. Kennedy International Airport', city: 'New York', lat: 40.639447, lng: -73.779317, timezone: 'America/New_York' },
  // Centros de carga: FedEx (MEM), UPS (SDF) y DHL/Amazon (CVG)
  { iataCode: 'MEM', icaoCode: 'KMEM', name: 'Frederick W. Smith International Airport', city: 'Memphis', lat: 35.043845, lng: -89.97634, timezone: 'America/Chicago' },
  { iataCode: 'SDF', icaoCode: 'KSDF', name: 'Louisville Muhammad Ali International Airport', city: 'Louisville', lat: 38.1706, lng: -85.735076, timezone: 'America/Kentucky/Louisville' },
  { iataCode: 'CVG', icaoCode: 'KCVG', name: 'Cincinnati Northern Kentucky International Airport', city: 'Cincinnati / Covington', lat: 39.048801, lng: -84.667801, timezone: 'America/New_York' },
];

// Clave solo de prueba; en la BD queda el hash, nunca el texto
const TEST_PASSWORD = 'Prueba123';

// Vuelos de ejemplo con fechas fijas para que el upsert los encuentre en cada corrida.
// Sin aircraftIcao24: el avión lo asigna el Staff con datos reales de OpenSky
const FLIGHTS: {
  flightNumber: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  status: FlightStatus;
}[] = [
  { flightNumber: 'DT101', origin: 'ATL', destination: 'ORD', departure: '2026-10-24T14:00:00Z', arrival: '2026-10-24T16:05:00Z', status: 'SCHEDULED' },
  { flightNumber: 'DT202', origin: 'MEM', destination: 'LAX', departure: '2026-10-24T18:30:00Z', arrival: '2026-10-24T22:40:00Z', status: 'SCHEDULED' },
  { flightNumber: 'DT303', origin: 'SDF', destination: 'DFW', departure: '2026-10-20T12:00:00Z', arrival: '2026-10-20T14:35:00Z', status: 'LANDED' },
];

// Cada envío con su historial; TOOK_OFF y LANDED son automáticos (sin Staff)
const SHIPMENTS: {
  trackingCode: string;
  description: string;
  weightKg: string;
  flightNumber: string;
  status: ShipmentStatus;
  events: { type: TrackingEventType; at: string; where: 'origin' | 'destination'; note?: string }[];
}[] = [
  {
    trackingCode: 'DT-A1B2C3',
    description: 'Caja con documentos',
    weightKg: '1.20',
    flightNumber: 'DT101',
    status: 'RECEIVED',
    events: [{ type: 'RECEIVED', at: '2026-10-24T10:15:00Z', where: 'origin' }],
  },
  {
    trackingCode: 'DT-D4E5F6',
    description: 'Repuestos electrónicos',
    weightKg: '8.75',
    flightNumber: 'DT202',
    status: 'LOADED',
    events: [
      { type: 'RECEIVED', at: '2026-10-24T13:00:00Z', where: 'origin' },
      { type: 'LOADED', at: '2026-10-24T17:45:00Z', where: 'origin' },
    ],
  },
  {
    trackingCode: 'DT-G7H8J9',
    description: 'Muestras de laboratorio',
    weightKg: '3.40',
    flightNumber: 'DT303',
    status: 'DELIVERED',
    events: [
      { type: 'RECEIVED', at: '2026-10-20T08:30:00Z', where: 'origin' },
      { type: 'LOADED', at: '2026-10-20T11:20:00Z', where: 'origin' },
      { type: 'TOOK_OFF', at: '2026-10-20T12:08:00Z', where: 'origin' },
      { type: 'LANDED', at: '2026-10-20T14:31:00Z', where: 'destination' },
      { type: 'UNLOADED', at: '2026-10-20T15:05:00Z', where: 'destination' },
      { type: 'DELIVERED', at: '2026-10-20T18:40:00Z', where: 'destination', note: 'Entregado en recepción' },
    ],
  },
];

const AUTOMATIC: TrackingEventType[] = ['TOOK_OFF', 'LANDED'];

const prisma = new PrismaClient();

try {
  // upsert: se puede correr varias veces sin duplicar
  const airportId = new Map<string, string>();
  for (const airport of AIRPORTS) {
    const saved = await prisma.airport.upsert({ where: { iataCode: airport.iataCode }, update: airport, create: airport });
    airportId.set(saved.iataCode, saved.id);
  }
  const idOf = (iata: string): string => {
    const id = airportId.get(iata);
    if (!id) throw new Error(`aeropuerto ${iata} no está en el seed`);
    return id;
  };

  // Hash nuevo en cada corrida (sal distinta), pero la clave de prueba sigue siendo la misma
  const passwordHash = await hash(TEST_PASSWORD, { type: argon2id });
  const client = {
    email: 'cliente@deliverytracking.test',
    name: 'Cliente de Prueba',
    role: 'CLIENT' as const,
    airportId: null,
    passwordHash,
  };
  // Staff limitado a Atlanta para probar el alcance por aeropuerto
  const staff = {
    email: 'staff@deliverytracking.test',
    name: 'Staff de Prueba',
    role: 'STAFF' as const,
    airportId: idOf('ATL'),
    passwordHash,
  };
  const savedClient = await prisma.user.upsert({ where: { email: client.email }, update: client, create: client });
  const savedStaff = await prisma.user.upsert({ where: { email: staff.email }, update: staff, create: staff });

  const flightIds = new Map<string, { id: string; originId: string; destinationId: string }>();
  for (const f of FLIGHTS) {
    const data = {
      flightNumber: f.flightNumber,
      originId: idOf(f.origin),
      destinationId: idOf(f.destination),
      scheduledDeparture: new Date(f.departure),
      scheduledArrival: new Date(f.arrival),
      status: f.status,
    };
    const saved = await prisma.flight.upsert({
      where: { flightNumber_scheduledDeparture: { flightNumber: data.flightNumber, scheduledDeparture: data.scheduledDeparture } },
      update: data,
      create: data,
    });
    flightIds.set(f.flightNumber, saved);
  }

  let eventCount = 0;
  for (const s of SHIPMENTS) {
    const flight = flightIds.get(s.flightNumber);
    if (!flight) throw new Error(`vuelo ${s.flightNumber} no está en el seed`);
    const data = {
      trackingCode: s.trackingCode,
      description: s.description,
      weightKg: s.weightKg,
      ownerId: savedClient.id,
      flightId: flight.id,
      status: s.status,
    };
    const shipment = await prisma.shipment.upsert({ where: { trackingCode: s.trackingCode }, update: data, create: data });

    // Los eventos no tienen campo único: se borran y se vuelven a crear juntos en una transacción
    await prisma.$transaction([
      prisma.trackingEvent.deleteMany({ where: { shipmentId: shipment.id } }),
      prisma.trackingEvent.createMany({
        data: s.events.map((e) => ({
          shipmentId: shipment.id,
          type: e.type,
          occurredAt: new Date(e.at),
          note: e.note ?? null,
          airportId: e.where === 'origin' ? flight.originId : flight.destinationId,
          createdById: AUTOMATIC.includes(e.type) ? null : savedStaff.id,
        })),
      }),
    ]);
    eventCount += s.events.length;
  }

  console.log(
    `seed: ${AIRPORTS.length} aeropuertos, 2 usuarios, ${FLIGHTS.length} vuelos, ${SHIPMENTS.length} envíos, ${eventCount} eventos`,
  );
} catch (err) {
  console.error('seed falló:', err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
