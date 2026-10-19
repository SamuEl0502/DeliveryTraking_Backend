import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { AppError } from '../utils/AppError.ts';
import type { FlightSchedule, FlightTimes } from '../types/flightDetails.ts';

// Fuente: https://doc.aerodatabox.com/ — GET /flights/callsign/{callsign} cuesta 2 unidades (Tier 2)
// El plan gratis (Basic, 400 unidades/mes) exige citar a AeroDataBox como fuente
const MARKETS = {
  direct: { baseURL: 'https://api.aerodatabox.com', keyHeader: 'x-api-key' },
  rapidapi: { baseURL: 'https://aerodatabox.p.rapidapi.com', keyHeader: 'X-RapidAPI-Key' },
} as const;

const market = MARKETS[env.AERODATABOX_MARKET];
export const isEnabled = Boolean(env.AERODATABOX_API_KEY);

const http = axios.create({
  baseURL: market.baseURL,
  timeout: 10_000,
  headers: {
    [market.keyHeader]: env.AERODATABOX_API_KEY ?? '',
    ...(env.AERODATABOX_MARKET === 'rapidapi' && { 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' }),
  },
});

// Hora de AeroDataBox: { utc: "2026-10-19 22:30Z", local: "..." }
const timeSchema = z.object({ utc: z.string() }).nullish();

const movementSchema = z.object({
  airport: z.object({ icao: z.string().nullish() }).nullish(),
  scheduledTime: timeSchema,
  revisedTime: timeSchema,
  terminal: z.string().nullish(),
  gate: z.string().nullish(),
});

// Solo los campos que usamos; el resto de la respuesta se ignora
const flightsSchema = z.array(
  z.object({
    number: z.string(),
    status: z.string().default('Unknown'),
    departure: movementSchema,
    arrival: movementSchema,
  }),
);

type Flight = z.infer<typeof flightsSchema>[number];

// "2026-10-19 22:30Z" -> "2026-10-19T22:30:00.000Z"
function toIso(t: { utc: string } | null | undefined): string | null {
  if (!t) return null;
  const date = new Date(t.utc.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toTimes(m: z.infer<typeof movementSchema>): FlightTimes {
  return {
    airportIcao: m.airport?.icao ?? null,
    scheduled: toIso(m.scheduledTime),
    revised: toIso(m.revisedTime),
    terminal: m.terminal ?? null,
    gate: m.gate ?? null,
  };
}

// Un indicativo puede traer varios tramos del día: preferimos el que está en el aire
const AIRBORNE = new Set(['Departed', 'EnRoute', 'Approaching']);

function pickLeg(flights: Flight[]): Flight | undefined {
  return flights.find((f) => AIRBORNE.has(f.status)) ?? flights[0];
}

export async function fetchScheduleByCallsign(callsign: string): Promise<FlightSchedule | null> {
  if (!isEnabled) {
    throw new AppError(503, 'AERODATABOX_DISABLED', 'Los horarios no están configurados (falta AERODATABOX_API_KEY)');
  }
  try {
    const res = await http.get(`/flights/callsign/${encodeURIComponent(callsign)}`, {
      params: { withAircraftImage: false, withLocation: false },
    });
    // 204 = sin vuelos para ese indicativo
    if (res.status === 204 || !res.data) return null;
    const parsed = flightsSchema.safeParse(res.data);
    if (!parsed.success) {
      logger.warn({ callsign }, 'AeroDataBox unexpected format');
      throw new AppError(502, 'AERODATABOX_BAD_RESPONSE', 'AeroDataBox devolvió un formato inesperado');
    }
    const leg = pickLeg(parsed.data);
    if (!leg) return null;
    return {
      flightNumber: leg.number,
      status: leg.status,
      departure: toTimes(leg.departure),
      arrival: toTimes(leg.arrival),
      source: 'AeroDataBox',
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (!axios.isAxiosError(err)) throw err;
    const status = err.response?.status;
    if (status === 404) return null;
    // 402 = plan vencido o unidades agotadas; 429 = demasiadas peticiones
    if (status === 402 || status === 429) {
      logger.warn({ status }, 'AeroDataBox quota exhausted');
      throw new AppError(503, 'AERODATABOX_QUOTA_EXCEEDED', 'Se agotaron las unidades de AeroDataBox o el plan venció');
    }
    if (status === 401 || status === 403) {
      logger.error({ status }, 'AeroDataBox authentication failed');
      throw new AppError(502, 'AERODATABOX_AUTH_FAILED', 'La llave de AeroDataBox no es válida para este plan');
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new AppError(504, 'AERODATABOX_TIMEOUT', 'AeroDataBox no respondió a tiempo');
    }
    logger.error({ status, code: err.code }, 'AeroDataBox request failed');
    throw new AppError(502, 'AERODATABOX_UNAVAILABLE', 'AeroDataBox no está disponible');
  }
}
