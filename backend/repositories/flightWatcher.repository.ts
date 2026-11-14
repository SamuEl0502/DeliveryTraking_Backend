import type { FlightStatus, Prisma, TrackingEventType } from '@prisma/client';
import { prisma } from '../config/prisma.ts';
import type { AircraftState } from '../types/aircraft.ts';

type Tx = Prisma.TransactionClient;

const watchedSelect = {
  id: true,
  flightNumber: true,
  aircraftIcao24: true,
  status: true,
  scheduledDeparture: true,
  scheduledArrival: true,
  version: true,
  originId: true,
  destinationId: true,
} satisfies Prisma.FlightSelect;

export type WatchedFlight = Prisma.FlightGetPayload<{ select: typeof watchedSelect }>;

/** Vuelos que aún pueden despegar o aterrizar y tienen avión para seguir */
export function findWatched(): Promise<WatchedFlight[]> {
  return prisma.flight.findMany({
    where: { status: { in: ['SCHEDULED', 'DEPARTED'] }, aircraftIcao24: { not: null } },
    select: watchedSelect,
  });
}

// Cambia el estado solo si el vuelo sigue en la versión y el estado leídos: así un segundo ciclo, otro proceso o un cambio del Staff no lo repiten ni lo pisan
async function transition(tx: Tx, f: WatchedFlight, from: FlightStatus, to: FlightStatus, a: AircraftState): Promise<boolean> {
  const { count } = await tx.flight.updateMany({
    where: { id: f.id, version: f.version, status: from },
    data: {
      status: to,
      version: { increment: 1 },
      lastKnownLat: a.lat,
      lastKnownLng: a.lng,
      lastKnownHdg: a.hdg,
      lastKnownSpd: a.spd,
      lastKnownAlt: a.alt,
      lastKnownOnGround: a.onGround,
      lastKnownAt: new Date(a.ts * 1000),
    },
  });
  return count === 1;
}

// Eventos automáticos: createdById null
async function addEvents(tx: Tx, shipmentIds: string[], type: TrackingEventType, airportId: string, a: AircraftState): Promise<void> {
  await tx.trackingEvent.createMany({
    data: shipmentIds.map((shipmentId) => ({ shipmentId, type, airportId, occurredAt: new Date(a.ts * 1000) })),
  });
}

/** SCHEDULED → DEPARTED; sus envíos LOADED pasan a IN_FLIGHT con un evento TOOK_OFF. false si el vuelo ya había cambiado */
export function markDeparted(f: WatchedFlight, a: AircraftState): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    if (!(await transition(tx, f, 'SCHEDULED', 'DEPARTED', a))) return false;
    // Solo los que de verdad cambiaron reciben evento, aunque el Staff haya movido alguno a la vez
    const moved = await tx.shipment.updateManyAndReturn({
      where: { flightId: f.id, status: 'LOADED' },
      data: { status: 'IN_FLIGHT', version: { increment: 1 } },
      select: { id: true },
    });
    await addEvents(tx, moved.map((s) => s.id), 'TOOK_OFF', f.originId, a);
    return true;
  });
}

/** DEPARTED → LANDED con un evento LANDED en sus envíos IN_FLIGHT, que siguen así hasta que el Staff los descargue. false si el vuelo ya había cambiado */
export function markLanded(f: WatchedFlight, a: AircraftState): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    if (!(await transition(tx, f, 'DEPARTED', 'LANDED', a))) return false;
    const onBoard = await tx.shipment.findMany({ where: { flightId: f.id, status: 'IN_FLIGHT' }, select: { id: true } });
    await addEvents(tx, onBoard.map((s) => s.id), 'LANDED', f.destinationId, a);
    return true;
  });
}
