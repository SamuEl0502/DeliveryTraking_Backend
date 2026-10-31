import type { Logger } from 'pino';
import { env } from '../config/env.ts';
import * as openSky from '../providers/openSky.provider.ts';
import type { AircraftSnapshot, AircraftState, FlightTrack } from '../types/aircraft.ts';
import { AppError } from '../utils/AppError.ts';
import { TtlCache } from '../utils/ttlCache.ts';

// EE. UU. continental. Caja > 400 grados² = 4 créditos de OpenSky por llamada
export const US_BOX: openSky.BoundingBox = { lamin: 24.5, lomin: -125, lamax: 49.5, lomax: -66.9 };

const boxCache = new TtlCache<AircraftSnapshot>(env.OPENSKY_CACHE_TTL_MS);
const singleCache = new TtlCache<AircraftState | null>(env.OPENSKY_CACHE_TTL_MS);
// El recorrido crece poco en 1 min; el panel y el mapa lo piden casi a la vez y comparten esta caché
const trackCache = new TtlCache<FlightTrack | null>(60_000);
// Si el recorrido empieza en tierra o por debajo de 1.500 m, ese primer punto es el despegue
const TAKEOFF_MAX_ALT_M = 1_500;

export function getUsAircraft(log: Logger): Promise<AircraftSnapshot> {
  return boxCache.getOrLoad('us', () => openSky.fetchByBox(US_BOX), log);
}

/** Aviones de una aerolínea por el prefijo ICAO de su indicativo (FDX = FedEx); sin código, todos */
export function byAirline(aircraft: AircraftState[], code: unknown): AircraftState[] {
  if (typeof code !== 'string' || code.trim() === '') return aircraft;
  const prefix = code.trim().toUpperCase();
  return aircraft.filter((a) => a.callsign?.startsWith(prefix) === true);
}

export async function getAircraftByIcao24(icao24: string, log: Logger): Promise<AircraftState> {
  // Primero la lista de EE. UU. (ya en caché por el mapa): seleccionar un avión no gasta créditos
  const fromMap = (await getUsAircraft(log)).aircraft.find((a) => a.icao24 === icao24);
  if (fromMap) return fromMap;

  const aircraft = await singleCache.getOrLoad(icao24, () => openSky.fetchByIcao24(icao24), log);
  if (!aircraft) {
    throw new AppError(404, 'AIRCRAFT_NOT_FOUND', `No hay posición para el avión ${icao24}`);
  }
  return aircraft;
}

/** Recorrido o null; nunca lanza, porque el panel puede vivir sin él */
export function findTrack(icao24: string, log: Logger): Promise<FlightTrack | null> {
  return trackCache.getOrLoad(icao24, () => openSky.fetchTrack(icao24), log).catch((err: unknown) => {
    log.warn({ err }, 'track unavailable');
    return null;
  });
}

export async function getTrack(icao24: string, log: Logger): Promise<FlightTrack> {
  const track = await findTrack(icao24, log);
  if (!track) throw new AppError(404, 'TRACK_NOT_FOUND', `No hay recorrido para el avión ${icao24}`);
  return track;
}

/** Punto de despegue según el recorrido, o null si OpenSky empezó a verlo ya en vuelo */
export function takeoffOf(track: FlightTrack | null): { lat: number; lng: number } | null {
  const first = track?.path[0];
  if (!first || (!first.onGround && (first.alt === null || first.alt > TAKEOFF_MAX_ALT_M))) return null;
  return first;
}
