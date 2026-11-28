import type { Logger } from 'pino';
import * as trackingRepository from '../repositories/tracking.repository.ts';
import type { AircraftState } from '../types/aircraft.ts';
import type { LiveResult, ShipmentTracking } from '../types/tracking.ts';
import { AppError } from '../utils/AppError.ts';
import { inTakeoffWindow } from '../utils/takeoffWindow.ts';
import * as aircraftService from './aircraft.service.ts';

export async function getByTrackingCode(trackingCode: string, log: Logger): Promise<ShipmentTracking> {
  const shipment = await trackingRepository.findByTrackingCode(trackingCode);
  if (!shipment) {
    throw new AppError(404, 'SHIPMENT_NOT_FOUND', `No existe un envío con el código ${trackingCode}`);
  }
  const { flight } = shipment;
  return {
    trackingCode: shipment.trackingCode,
    status: shipment.status,
    flight: flight && {
      flightNumber: flight.flightNumber,
      callsign: flight.callsign,
      status: flight.status,
      scheduledDeparture: flight.scheduledDeparture.toISOString(),
      scheduledArrival: flight.scheduledArrival.toISOString(),
      origin: flight.origin,
      destination: flight.destination,
    },
    ...(await findLive(flight, log)),
  };
}

const normalizeCallsign = (c: string | null | undefined): string => c?.trim().toUpperCase() ?? '';

/** Avión de la lista cuyo indicativo coincide con el del vuelo, sin importar mayúsculas ni espacios en los extremos */
export function findByCallsign(aircraft: AircraftState[], callsign: string | null | undefined): AircraftState | undefined {
  const wanted = normalizeCallsign(callsign);
  if (!wanted) return undefined;
  return aircraft.find((a) => normalizeCallsign(a.callsign) === wanted);
}

type LiveFlight = Pick<
  NonNullable<trackingRepository.TrackingRecord['flight']>,
  'aircraftIcao24' | 'callsign' | 'status' | 'scheduledDeparture'
>;

type AircraftSource = Pick<typeof aircraftService, 'getUsAircraft' | 'peekUsAircraft'>;

// Solo la lista de EE. UU. que ya comparte el mapa: un envío consultado no gasta créditos extra por avión
export async function findLive(
  flight: LiveFlight | null,
  log: Logger,
  source: AircraftSource = aircraftService,
  now = Date.now(),
): Promise<LiveResult> {
  if (!flight) return { live: null, reason: 'no_flight' };
  const { aircraftIcao24, callsign, status, scheduledDeparture } = flight;
  // Sin avión vinculado solo se carga la lista si el vuelo está por salir o en el aire
  const wanted = status === 'DEPARTED' || (status === 'SCHEDULED' && inTakeoffWindow(scheduledDeparture, now));
  try {
    if (aircraftIcao24) return liveFrom(aircraftIcao24, (await source.getUsAircraft(log)).aircraft);
    // Se busca por indicativo sin guardar nada; fuera de la ventana basta con lo que haya en caché
    const snapshot = wanted ? await source.getUsAircraft(log) : source.peekUsAircraft();
    const match = findByCallsign(snapshot?.aircraft ?? [], callsign);
    return match ? liveFrom(match.icao24, [match]) : { live: null, reason: 'no_aircraft' };
  } catch (err) {
    log.warn({ err }, 'live position unavailable');
    return { live: null, reason: 'source_unavailable' };
  }
}

/** Posición del avión icao24 dentro de la lista de OpenSky, sin el resto de campos de AircraftState */
export function liveFrom(icao24: string, aircraft: AircraftState[]): LiveResult {
  const a = aircraft.find((s) => s.icao24 === icao24);
  if (!a) return { live: null, reason: 'no_position' };
  const { lat, lng, hdg, spd, alt, onGround, ts } = a;
  return { live: { lat, lng, hdg, spd, alt, onGround, ts }, reason: null };
}
