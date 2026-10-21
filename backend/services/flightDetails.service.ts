import type { Logger } from 'pino';
import * as adsbdb from '../providers/adsbdb.provider.ts';
import * as aviationStack from '../providers/aviationStack.provider.ts';
import * as hexdb from '../providers/hexdb.provider.ts';
import type { AircraftState, FlightTrack } from '../types/aircraft.ts';
import type {
  AircraftDetails,
  AircraftInfo,
  Airport,
  FlightProgress,
  FlightRoute,
  FlightSchedule,
} from '../types/flightDetails.ts';
import { AppError } from '../utils/AppError.ts';
import { TtlCache } from '../utils/ttlCache.ts';
import { findTrack, getAircraftByIcao24 } from './aircraft.service.ts';

// Quién responde qué en el panel del avión seleccionado:
//   OpenSky     -> posición, altitud, velocidad, rumbo (ya en caché por el mapa)
//   adsbdb      -> modelo, matrícula, foto, aerolínea, origen y destino (gratis)
//   este archivo -> progreso y ETA, calculados con las coordenadas (sin llamadas)
//   Aviationstack -> ruta real del tramo activo, horarios, terminal, puerta, retraso
//                    (1 de 100 peticiones al mes; solo si se piden)
//   hexdb       -> coordenadas de los aeropuertos de Aviationstack (gratis)

// Avión y ruta cambian poco: 6 h. Horarios cambian con retrasos: 30 min. Aeropuertos no cambian: 30 días
const STATIC_TTL_MS = 6 * 60 * 60 * 1000;
const SCHEDULE_TTL_MS = 30 * 60 * 1000;
const AIRPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// La ruta encaja si pasar por el avión no la alarga más de un 20 %...
const MAX_DETOUR = 1.2;
// ...y el avión apunta hacia el destino (no se exige cerca de llegar: en la aproximación da vueltas)
const MAX_HEADING_OFF_DEG = 90;
const HEADING_CHECK_MIN_KM = 100;
// Si el recorrido empieza en tierra o bajo, ese punto es el despegue: el origen debe estar a menos de 30 km
const TAKEOFF_MAX_ALT_M = 1_500;
const TAKEOFF_MATCH_KM = 30;

const aircraftCache = new TtlCache<AircraftInfo | null>(STATIC_TTL_MS);
const routeCache = new TtlCache<Omit<FlightRoute, 'verified'> | null>(STATIC_TTL_MS);
const scheduleCache = new TtlCache<aviationStack.ActiveFlight | null>(SCHEDULE_TTL_MS);
const airportCache = new TtlCache<Airport | null>(AIRPORT_TTL_MS);

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distancia en km sobre la superficie terrestre (fórmula de haversine) */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Rumbo inicial de a hacia b, en grados desde el norte (0 a 360) */
export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function headsToDestination(state: AircraftState, destination: { lat: number; lng: number }, remainingKm: number): boolean {
  if (state.hdg === null || state.onGround || remainingKm < HEADING_CHECK_MIN_KM) return true;
  const off = Math.abs(bearingDeg(state, destination) - state.hdg) % 360;
  return Math.min(off, 360 - off) <= MAX_HEADING_OFF_DEG;
}

/** Punto de despegue según el recorrido, o null si OpenSky empezó a verlo ya en vuelo */
export function takeoffOf(track: FlightTrack | null): { lat: number; lng: number } | null {
  const first = track?.path[0];
  if (!first || (!first.onGround && (first.alt === null || first.alt > TAKEOFF_MAX_ALT_M))) return null;
  return first;
}

export function computeProgress(
  state: AircraftState,
  route: Omit<FlightRoute, 'verified'>,
  takeoff: { lat: number; lng: number } | null = null,
): { progress: FlightProgress; verified: boolean } {
  const directKm = distanceKm(route.origin, route.destination);
  const flownKm = distanceKm(route.origin, state);
  const remainingKm = distanceKm(state, route.destination);
  // Trayecto pasando por el avión: así recorrido + restante = total y el % cuadra
  const totalKm = flownKm + remainingKm;
  const heads = headsToDestination(state, route.destination, remainingKm);
  // Con el despegue visto, el origen manda: un desvío por clima no invalida la ruta y otro origen sí
  const verified = takeoff
    ? distanceKm(takeoff, route.origin) <= TAKEOFF_MATCH_KM && heads
    : directKm > 0 && totalKm / directKm <= MAX_DETOUR && heads;
  // ponytail: progreso y ETA en línea recta a velocidad actual; ignora vientos y aproximación
  const percent = totalKm > 0 ? (flownKm / totalKm) * 100 : 0;
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
  const [aircraft, rawRoute, track] = await Promise.all([
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
    findTrack(icao24, log),
  ]);

  if (!rawRoute) return { state, aircraft, route: null, progress: null };
  const { progress, verified } = computeProgress(state, rawRoute, takeoffOf(track));
  // Con una ruta que no encaja, el progreso y el ETA serían inventados: mejor no darlos
  return { state, aircraft, route: { ...rawRoute, verified }, progress: verified ? progress : null };
}

async function getAirport(icao: string, log: Logger): Promise<Airport | null> {
  return airportCache.getOrLoad(icao, () => hexdb.fetchAirport(icao), log).catch((err: unknown) => {
    log.warn({ err }, 'airport coordinates unavailable');
    return null;
  });
}

export async function getSchedule(icao24: string, log: Logger): Promise<FlightSchedule> {
  const state = await getAircraftByIcao24(icao24, log);
  const callsign = state.callsign;
  if (!callsign) {
    throw new AppError(404, 'SCHEDULE_NOT_FOUND', `El avión ${icao24} no transmite indicativo`);
  }
  const flight = await scheduleCache.getOrLoad(
    callsign,
    () => aviationStack.fetchActiveFlight(callsign, icao24),
    log,
  );
  if (!flight) {
    throw new AppError(404, 'SCHEDULE_NOT_FOUND', `No hay un vuelo activo con el indicativo ${callsign}`);
  }

  // Ruta real con coordenadas (hexdb); el progreso se recalcula con la posición de este momento
  const [origin, destination] = await Promise.all([
    flight.departure.airport ? getAirport(flight.departure.airport.icao, log) : null,
    flight.arrival.airport ? getAirport(flight.arrival.airport.icao, log) : null,
  ]);
  let route: FlightRoute | null = null;
  let progress: FlightProgress | null = null;
  if (origin && destination) {
    const raw = { callsign, flightNumber: flight.flightNumber, airline: null, origin, destination };
    const computed = computeProgress(state, raw);
    route = {
      ...raw,
      airline: flight.airline ? { name: flight.airline, icao: callsign.slice(0, 3), iata: null } : null,
      verified: computed.verified,
    };
    progress = computed.verified ? computed.progress : null;
  }
  return { ...flight, route, progress, source: 'Aviationstack' };
}
