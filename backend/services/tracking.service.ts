import type { Logger } from 'pino';
import * as trackingRepository from '../repositories/tracking.repository.ts';
import type { AircraftState } from '../types/aircraft.ts';
import type { LiveResult, ShipmentTracking } from '../types/tracking.ts';
import { AppError } from '../utils/AppError.ts';
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

// Solo la lista de EE. UU. que ya comparte el mapa: un envío consultado no gasta créditos extra por avión
async function findLive(flight: { aircraftIcao24: string | null } | null, log: Logger): Promise<LiveResult> {
  if (!flight) return { live: null, reason: 'no_flight' };
  if (!flight.aircraftIcao24) return { live: null, reason: 'no_aircraft' };
  try {
    return liveFrom(flight.aircraftIcao24, (await aircraftService.getUsAircraft(log)).aircraft);
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
