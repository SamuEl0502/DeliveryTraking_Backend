import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { AppError } from '../utils/AppError.ts';
import type { FlightTimes } from '../types/flightDetails.ts';

// Fuente: https://aviationstack.com — plan gratis: 100 peticiones al mes, sin uso comercial
// La llave va en la URL (access_key): nunca loguear la URL ni el error completo de Axios
const http = axios.create({ baseURL: 'https://api.aviationstack.com/v1', timeout: 10_000 });

export const isEnabled = Boolean(env.AVIATIONSTACK_API_KEY);

const str = z.string().nullish();

const movementSchema = z.object({
  airport: str,
  timezone: str,
  iata: str,
  icao: str,
  terminal: str,
  gate: str,
  delay: z.number().nullish(),
  scheduled: str,
  estimated: str,
  actual: str,
});

// Solo los campos que usamos; el resto de la respuesta se ignora
const flightSchema = z.object({
  flight_status: z.string().nullish(),
  departure: movementSchema,
  arrival: movementSchema,
  airline: z.object({ name: str }).nullish(),
  flight: z.object({ iata: str, icao: str, codeshared: z.unknown().nullish() }),
  aircraft: z.object({ icao24: str }).nullish(),
});

const responseSchema = z.object({ data: z.array(flightSchema) });

// Aviationstack responde los errores como { error: { code, message } }
const errorSchema = z.object({ error: z.object({ code: z.string() }) });

type Flight = z.infer<typeof flightSchema>;

/** Vuelo activo sin las coordenadas de los aeropuertos (las agrega el service) */
export interface ActiveFlight {
  flightNumber: string;
  airline: string | null;
  status: string;
  departure: FlightTimes;
  arrival: FlightTimes;
}

/** Milisegundos que la zona horaria tz está por delante de UTC en ese instante */
function tzOffsetMs(utcMs: number, tz: string): number {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(utcMs)
      .map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

// Aviationstack manda la hora LOCAL del aeropuerto marcada como "+00:00" (ej. MIA 17:40 = 21:40 UTC):
// se toma la hora de reloj y se convierte con la zona horaria del aeropuerto
export function localToIso(t: string | null | undefined, tz: string | null | undefined): string | null {
  const m = t?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!, s ?? 0);
  if (!tz) return new Date(wall).toISOString();
  try {
    // Dos pasadas para acertar en los cambios de horario de verano
    let utc = wall - tzOffsetMs(wall, tz);
    utc = wall - tzOffsetMs(utc, tz);
    return new Date(utc).toISOString();
  } catch {
    return new Date(wall).toISOString(); // zona horaria desconocida
  }
}

function toTimes(m: z.infer<typeof movementSchema>): FlightTimes {
  const toIso = (t: string | null | undefined) => localToIso(t, m.timezone);
  return {
    airport: m.icao ? { icao: m.icao, iata: m.iata ?? null, name: m.airport ?? m.icao } : null,
    scheduled: toIso(m.scheduled),
    estimated: toIso(m.estimated),
    actual: toIso(m.actual),
    delayMinutes: m.delay ?? null,
    terminal: m.terminal ?? null,
    gate: m.gate ?? null,
  };
}

// La respuesta trae el vuelo del operador y sus códigos compartidos (Aer Lingus, Finnair...)
// sobre el mismo avión: preferimos el del operador (codeshared null) y el mismo icao24
export function pickFlight(flights: Flight[], icao24: string): Flight | undefined {
  const own = flights.filter((f) => !f.flight.codeshared);
  const sameAircraft = (f: Flight) => f.aircraft?.icao24?.toLowerCase() === icao24;
  return own.find(sameAircraft) ?? own[0] ?? flights.find(sameAircraft) ?? flights[0];
}

export function toActiveFlight(raw: unknown, icao24: string, callsign: string): ActiveFlight | null {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(502, 'AVIATIONSTACK_BAD_RESPONSE', 'Aviationstack devolvió un formato inesperado');
  }
  const f = pickFlight(parsed.data.data, icao24);
  if (!f) return null;
  return {
    flightNumber: f.flight.iata ?? f.flight.icao ?? callsign,
    airline: f.airline?.name ?? null,
    status: f.flight_status ?? 'unknown',
    departure: toTimes(f.departure),
    arrival: toTimes(f.arrival),
  };
}

function toAppError(code: string): AppError {
  logger.warn({ code }, 'Aviationstack error');
  if (code === 'usage_limit_reached' || code === 'rate_limit_reached') {
    return new AppError(503, 'AVIATIONSTACK_QUOTA_EXCEEDED', 'Se agotaron las peticiones del mes de Aviationstack');
  }
  if (code === 'invalid_access_key' || code === 'missing_access_key' || code === 'inactive_user') {
    return new AppError(502, 'AVIATIONSTACK_AUTH_FAILED', 'La llave de Aviationstack no es válida');
  }
  return new AppError(502, 'AVIATIONSTACK_UNAVAILABLE', 'Aviationstack no está disponible');
}

/** Tramo que el avión está volando ahora (1 petición del cupo mensual) */
export async function fetchActiveFlight(callsign: string, icao24: string): Promise<ActiveFlight | null> {
  if (!isEnabled) {
    throw new AppError(503, 'AVIATIONSTACK_DISABLED', 'Los horarios no están configurados (falta AVIATIONSTACK_API_KEY)');
  }
  try {
    const { data } = await http.get('/flights', {
      params: { access_key: env.AVIATIONSTACK_API_KEY, flight_icao: callsign, flight_status: 'active' },
    });
    const apiError = errorSchema.safeParse(data);
    if (apiError.success) throw toAppError(apiError.data.error.code);
    return toActiveFlight(data, icao24, callsign);
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (!axios.isAxiosError(err)) throw err;
    // Algunos errores llegan con estado HTTP y el mismo cuerpo { error: { code } }
    const body = errorSchema.safeParse(err.response?.data);
    if (body.success) throw toAppError(body.data.error.code);
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new AppError(504, 'AVIATIONSTACK_TIMEOUT', 'Aviationstack no respondió a tiempo');
    }
    logger.error({ status: err.response?.status, code: err.code }, 'Aviationstack request failed');
    throw new AppError(502, 'AVIATIONSTACK_UNAVAILABLE', 'Aviationstack no está disponible');
  }
}
