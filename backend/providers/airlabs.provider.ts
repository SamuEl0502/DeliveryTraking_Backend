import { readFile } from 'node:fs/promises';
import axios from 'axios';
import type { Logger } from 'pino';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { AppError } from '../utils/AppError.ts';
import type { ScheduledDeparture } from '../types/schedule.ts';

// Fuente: https://airlabs.co/docs/schedules — cada consulta gasta créditos del plan gratis
// La llave va en la URL (api_key): nunca loguear la URL ni el error completo de Axios
const TIMEOUT_MS = 8_000;
const http = axios.create({ baseURL: 'https://airlabs.co/api/v9', timeout: TIMEOUT_MS });
const FIXTURE_URL = new URL('../fixtures/airlabs-sample.json', import.meta.url);
// En el fixture la primera salida queda a 5 minutos de la hora actual
const FIXTURE_FIRST_DEPARTURE_MS = 5 * 60_000;

export const isEnabled = Boolean(env.AIRLABS_API_KEY);

const str = z.string().nullish();
const num = z.number().nullish();

// Solo los campos que usamos, todos opcionales; el resto de la fila se ignora
const flightSchema = z.object({
  flight_iata: str,
  flight_icao: str,
  airline_iata: str,
  dep_iata: str,
  arr_iata: str,
  dep_time_ts: num,
  dep_time_utc: str,
  arr_time_ts: num,
  arr_time_utc: str,
  status: str,
  // En una fila de código compartido, el vuelo que opera de verdad
  cs_flight_iata: str,
  dep_delayed: num,
  delayed: num,
});

// Las filas se validan una por una: una fila rara no tumba toda la respuesta
const responseSchema = z.object({ response: z.array(z.unknown()) });

// AirLabs responde los errores como { error: { code, message } }
const errorSchema = z.object({ error: z.object({ code: z.string().nullish() }) });

type Row = z.infer<typeof flightSchema>;

// Prefiere el Unix en segundos; si no viene, la hora UTC en texto ("2026-01-01 12:00")
function toIso(ts: number | null | undefined, utc: string | null | undefined): string | null {
  const ms = typeof ts === 'number' ? ts * 1000 : utc ? Date.parse(`${utc.replace(' ', 'T')}Z`) : NaN;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDeparture(row: Row): ScheduledDeparture | null {
  const flightIata = row.flight_iata ?? row.flight_icao;
  const scheduledDeparture = toIso(row.dep_time_ts, row.dep_time_utc);
  // Sin número de vuelo o sin hora de salida la fila no sirve
  if (!flightIata || !scheduledDeparture) return null;
  return {
    flightIata,
    flightIcao: row.flight_icao ?? null,
    airlineIata: row.airline_iata ?? null,
    scheduledDeparture,
    scheduledArrival: toIso(row.arr_time_ts, row.arr_time_utc),
    status: row.status ?? null,
    delayMinutes: row.dep_delayed ?? row.delayed ?? null,
  };
}

/** Convierte la respuesta de AirLabs en las salidas de la ruta (sin filtrar por hora) */
export function toDepartures(raw: unknown, origin: string, destination: string): ScheduledDeparture[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(502, 'SCHEDULE_UPSTREAM_ERROR', 'AirLabs devolvió un formato inesperado');
  }
  const rows = parsed.data.response
    .map((r) => flightSchema.safeParse(r))
    .flatMap((r) => (r.success ? [r.data] : []))
    // Si la fila trae aeropuertos, deben ser los de la ruta pedida
    .filter((r) => (r.dep_iata ?? origin) === origin && (r.arr_iata ?? destination) === destination);

  // El mismo avión aparece varias veces con códigos compartidos: se deja solo el vuelo del operador
  const operated = new Set(rows.filter((r) => !r.cs_flight_iata).map((r) => r.flight_iata));
  return rows
    .filter((r) => !r.cs_flight_iata || !operated.has(r.cs_flight_iata))
    .map(toDeparture)
    .filter((d): d is ScheduledDeparture => d !== null);
}

function upstreamError(message: string): AppError {
  return new AppError(502, 'SCHEDULE_UPSTREAM_ERROR', message);
}

/** Salidas programadas de la ruta. UNA consulta a AirLabs (gasta créditos) */
export async function fetchDepartures(origin: string, destination: string, log: Logger): Promise<ScheduledDeparture[]> {
  try {
    const { data } = await http.get<unknown>('/schedules', {
      params: { dep_iata: origin, arr_iata: destination, api_key: env.AIRLABS_API_KEY },
      // timeout de Axios solo mide silencio; la señal corta el tiempo total
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const apiError = errorSchema.safeParse(data);
    if (apiError.success) {
      log.warn({ code: apiError.data.error.code }, 'AirLabs error');
      throw upstreamError('AirLabs rechazó la consulta');
    }
    return toDepartures(data, origin, destination);
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Solo estado y código: el error de Axios trae la URL con la llave
    if (axios.isAxiosError(err)) {
      log.error({ status: err.response?.status, code: err.code }, 'AirLabs request failed');
      const timedOut = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ERR_CANCELED';
      throw upstreamError(timedOut ? 'AirLabs no respondió a tiempo' : 'AirLabs no está disponible');
    }
    log.error('AirLabs unexpected error');
    throw upstreamError('AirLabs no está disponible');
  }
}

/** Datos de ejemplo (USE_FIXTURE=true): no llama a AirLabs */
export async function fetchFixture(origin: string, destination: string): Promise<ScheduledDeparture[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(FIXTURE_URL, 'utf8')) as unknown;
  } catch {
    throw new AppError(500, 'FIXTURE_MISSING', 'No se pudo leer fixtures/airlabs-sample.json');
  }
  const departures = toDepartures(raw, origin, destination);
  const first = Math.min(...departures.map((d) => Date.parse(d.scheduledDeparture)));
  // Las horas del archivo son fijas: se mueven todas para que la primera salga en 5 minutos
  const shiftMs = Date.now() + FIXTURE_FIRST_DEPARTURE_MS - first;
  const shift = (iso: string) => new Date(Date.parse(iso) + shiftMs).toISOString();
  return departures.map((d) => ({
    ...d,
    scheduledDeparture: shift(d.scheduledDeparture),
    scheduledArrival: d.scheduledArrival ? shift(d.scheduledArrival) : null,
  }));
}
