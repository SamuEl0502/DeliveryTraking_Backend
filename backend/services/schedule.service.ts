import type { Logger } from 'pino';
import { env } from '../config/env.ts';
import * as airlabs from '../providers/airlabs.provider.ts';
import * as scheduleFlightRepository from '../repositories/scheduleFlight.repository.ts';
import * as userRepository from '../repositories/user.repository.ts';
import type { ImportedFlight, ScheduledDeparture, ScheduleFlight, ScheduleResponse } from '../types/schedule.ts';
import { AppError } from '../utils/AppError.ts';
import { TtlCache } from '../utils/ttlCache.ts';
import type { ScheduleQuery } from '../validators/schedule.validator.ts';
import type { AuthUser } from './token.service.ts';

const HOUR_MS = 60 * 60 * 1000;
// Dos salidas con el mismo número a menos de 6 horas se consideran el mismo vuelo
const SAME_FLIGHT_MS = 6 * HOUR_MS;
// Si la fuente no trae la llegada, se supone una duración de 2 horas
const DEFAULT_DURATION_MS = 2 * HOUR_MS;

// Se guarda la lista completa de la ruta; la ventana de minutos se filtra en cada petición
interface CachedRoute {
  departures: ScheduledDeparture[];
  fetchedAt: string;
}

// Todo en memoria: la caché y el contador se pierden al reiniciar el servidor
const cache = new TtlCache<CachedRoute>(env.SCHEDULE_CACHE_TTL_MS);
let counter = { day: '', count: 0 };

// El día se cuenta en UTC; al cambiar de día el contador vuelve a 0
function queriesToday(): number {
  const today = new Date().toISOString().slice(0, 10);
  if (counter.day !== today) counter = { day: today, count: 0 };
  return counter.count;
}

/** Salidas entre nowMs y nowMs + minutes, ordenadas por hora de salida */
export function inWindow(departures: ScheduledDeparture[], nowMs: number, minutes: number): ScheduledDeparture[] {
  const untilMs = nowMs + minutes * 60_000;
  return departures
    .filter((d) => {
      const t = Date.parse(d.scheduledDeparture);
      return t >= nowMs && t <= untilMs;
    })
    .sort((a, b) => Date.parse(a.scheduledDeparture) - Date.parse(b.scheduledDeparture));
}

// Única función que trae datos de la fuente; solo se ejecuta cuando la caché no sirve
async function load(origin: string, destination: string, log: Logger): Promise<CachedRoute> {
  if (env.USE_FIXTURE) {
    return { departures: await airlabs.fetchFixture(origin, destination), fetchedAt: new Date().toISOString() };
  }
  if (queriesToday() >= env.SCHEDULE_DAILY_LIMIT) {
    throw new AppError(429, 'SCHEDULE_QUOTA', 'Se alcanzó el tope diario de consultas de horarios; intenta mañana');
  }
  // Se cuenta antes de llamar: un intento fallido también puede gastar créditos
  counter.count += 1;
  log.info({ origin, destination, queriesToday: counter.count }, 'AirLabs query');
  return { departures: await airlabs.fetchDepartures(origin, destination, log), fetchedAt: new Date().toISOString() };
}

export async function getDepartures(query: ScheduleQuery, log: Logger): Promise<ScheduleResponse> {
  const { origin, destination, minutes } = query;
  if (!env.USE_FIXTURE && !airlabs.isEnabled) {
    throw new AppError(503, 'SCHEDULE_NOT_CONFIGURED', 'Los horarios programados no están configurados (falta AIRLABS_API_KEY)');
  }

  // fresh queda en true solo si ESTA petición trajo los datos de la fuente
  let fresh = false;
  // Si load falla (tope diario o AirLabs caído) y hay un dato anterior, la caché responde con ese
  const route = await cache.getOrLoad(
    `${origin}-${destination}`,
    async () => {
      const loaded = await load(origin, destination, log);
      fresh = true;
      return loaded;
    },
    log,
  );

  return {
    origin,
    destination,
    windowMinutes: minutes,
    generatedAt: route.fetchedAt,
    source: !fresh ? 'cache' : env.USE_FIXTURE ? 'fixture' : 'airlabs',
    queriesToday: queriesToday(),
    departures: inWindow(route.departures, Date.now(), minutes),
  };
}

// Busca el id de un aeropuerto por su código; si no está en la base, avisa cuál falta
async function findAirportIds(origin: string, destination: string): Promise<{ originId: string; destinationId: string }> {
  const airports = await scheduleFlightRepository.coincidesAirports([origin, destination]);
  const originAirport = airports.find((a) => a.iataCode === origin);
  const destinationAirport = airports.find((a) => a.iataCode === destination);
  if (!originAirport) {
    throw new AppError(400, 'AIRPORT_NOT_SUPPORTED', `El aeropuerto ${origin} no está registrado en el sistema`);
  }
  if (!destinationAirport) {
    throw new AppError(400, 'AIRPORT_NOT_SUPPORTED', `El aeropuerto ${destination} no está registrado en el sistema`);
  }
  return { originId: originAirport.id, destinationId: destinationAirport.id };
}

// Guarda como vuelos las salidas reales de la ruta. Solo inserta: un vuelo que ya existe no se toca
export async function importDepartures(user: AuthUser, body: ScheduleQuery, log: Logger): Promise<ScheduleFlight> {
  if (env.USE_FIXTURE) {
    throw new AppError(400, 'IMPORT_NOT_AVAILABLE', 'Solo se importan salidas reales; el modo de ejemplo está activo');
  }

  const { originId, destinationId } = await findAirportIds(body.origin, body.destination);

  // El aeropuerto del Staff se lee de la base porque no viaja en el token
  if (user.role === 'STAFF') {
    const staff = await userRepository.findById(user.id);
    if (staff?.airportId !== originId) {
      throw new AppError(403, 'FORBIDDEN_AIRPORT', 'Solo puedes importar vuelos que salen de tu aeropuerto');
    }
  }

  // Reutiliza la caché: si la ruta ya se consultó, no se gasta otra consulta
  const schedule = await getDepartures(body, log);

  const flights: ImportedFlight[] = [];
  let existFlight = 0;
  let newFlight = 0;

  for (const departure of schedule.departures) {
    const departureDate = new Date(departure.scheduledDeparture);
    const near = await scheduleFlightRepository.findFlightBetween(
      departure.flightIata,
      new Date(departureDate.getTime() - SAME_FLIGHT_MS),
      new Date(departureDate.getTime() + SAME_FLIGHT_MS),
    );

    if (near) {
      existFlight += 1;
      flights.push({
        flightId: near.id,
        flightNumber: near.flightNumber,
        departure: near.scheduledDeparture.toISOString(),
        result: 'exist',
      });
      continue;
    }

    const created = await scheduleFlightRepository.createFlight({
      flightNumber: departure.flightIata,
      callsign: departure.flightIcao ?? departure.flightIata,
      originId,
      destinationId,
      scheduledDeparture: departureDate,
      scheduledArrival: departure.scheduledArrival
        ? new Date(departure.scheduledArrival)
        : new Date(departureDate.getTime() + DEFAULT_DURATION_MS),
      capacityKg: env.DEFAULT_FLIGHT_CAPACITY_KG,
    });
    newFlight += 1;
    flights.push({
      flightId: created.id,
      flightNumber: created.flightNumber,
      departure: created.scheduledDeparture.toISOString(),
      result: 'new',
    });
  }

  log.info({ origin: body.origin, destination: body.destination, existFlight, newFlight }, 'Schedule import');
  return {
    origin: body.origin,
    destination: body.destination,
    source: schedule.source,
    totalFlight: flights.length,
    existFlight,
    newFlight,
    flights,
  };
}
