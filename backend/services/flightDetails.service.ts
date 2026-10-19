import type { Logger } from 'pino';
import * as adsbdb from '../providers/adsbdb.provider.ts';
import * as aeroDataBox from '../providers/aeroDataBox.provider.ts';
import type { AircraftState } from '../types/aircraft.ts';
import type {
  AircraftDetails,
  AircraftInfo,
  FlightProgress,
  FlightRoute,
  FlightSchedule,
} from '../types/flightDetails.ts';
import { AppError } from '../utils/AppError.ts';
import { TtlCache } from '../utils/ttlCache.ts';
import { getAircraftByIcao24 } from './aircraft.service.ts';

// Quién responde qué en el panel del avión seleccionado:
//   OpenSky     -> posición, altitud, velocidad, rumbo (ya en caché por el mapa)
//   adsbdb      -> modelo, matrícula, foto, aerolínea, origen y destino (gratis)
//   este archivo -> progreso y ETA, calculados con las coordenadas (sin llamadas)
//   AeroDataBox -> horarios, terminal, puerta y estado (2 unidades; solo si se piden)

// Avión y ruta cambian poco: 6 h. Horarios cambian con retrasos: 30 min
const STATIC_TTL_MS = 6 * 60 * 60 * 1000;
const SCHEDULE_TTL_MS = 30 * 60 * 1000;
// Si pasar por el avión alarga la ruta más de un 30 %, la ruta no encaja con la posición
const MAX_DETOUR = 1.3;

const aircraftCache = new TtlCache<AircraftInfo | null>(STATIC_TTL_MS);
const routeCache = new TtlCache<Omit<FlightRoute, 'verified'> | null>(STATIC_TTL_MS);
const scheduleCache = new TtlCache<FlightSchedule | null>(SCHEDULE_TTL_MS);

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distancia en km sobre la superficie terrestre (fórmula de haversine) */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function computeProgress(
  state: AircraftState,
  route: Omit<FlightRoute, 'verified'>,
): { progress: FlightProgress; verified: boolean } {
  const totalKm = distanceKm(route.origin, route.destination);
  const flownKm = distanceKm(route.origin, state);
  const remainingKm = distanceKm(state, route.destination);
  const verified = totalKm > 0 && (flownKm + remainingKm) / totalKm <= MAX_DETOUR;
  // ponytail: progreso y ETA en línea recta a velocidad actual; ignora vientos y aproximación
  const percent = totalKm > 0 ? Math.min(100, Math.max(0, (flownKm / (flownKm + remainingKm)) * 100)) : 0;
  const moving = !state.onGround && state.spd !== null && state.spd > 0;
  return {
    verified,
    progress: {
      totalKm: Math.round(totalKm),
      flownKm: Math.round(flownKm),
      remainingKm: Math.round(remainingKm),
      percent: Math.round(percent),
      etaMinutes: moving ? Math.round(remainingKm / ((state.spd as number) * 0.06)) : null,
    },
  };
}

export async function getDetails(icao24: string, log: Logger): Promise<AircraftDetails> {
  const state = await getAircraftByIcao24(icao24, log);
  const callsign = state.callsign;

  // En paralelo; si adsbdb falla, el panel igual muestra los datos en vivo
  const [aircraft, rawRoute] = await Promise.all([
    aircraftCache.getOrLoad(icao24, () => adsbdb.fetchAircraftInfo(icao24), log).catch((err: unknown) => {
      log.warn({ err }, 'aircraft info unavailable');
      return null;
    }),
    callsign
      ? routeCache.getOrLoad(callsign, () => adsbdb.fetchRoute(callsign), log).catch((err: unknown) => {
          log.warn({ err }, 'route unavailable');
          return null;
        })
      : null,
  ]);

  if (!rawRoute) return { state, aircraft, route: null, progress: null };
  const { progress, verified } = computeProgress(state, rawRoute);
  // Con una ruta que no encaja, el progreso y el ETA serían inventados: mejor no darlos
  return { state, aircraft, route: { ...rawRoute, verified }, progress: verified ? progress : null };
}

export async function getSchedule(icao24: string, log: Logger): Promise<FlightSchedule> {
  const { callsign } = await getAircraftByIcao24(icao24, log);
  if (!callsign) {
    throw new AppError(404, 'SCHEDULE_NOT_FOUND', `El avión ${icao24} no transmite indicativo`);
  }
  const schedule = await scheduleCache.getOrLoad(
    callsign,
    () => aeroDataBox.fetchScheduleByCallsign(callsign),
    log,
  );
  if (!schedule) {
    throw new AppError(404, 'SCHEDULE_NOT_FOUND', `No hay horarios para el vuelo ${callsign}`);
  }
  return schedule;
}
