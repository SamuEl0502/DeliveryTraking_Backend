import { readFile } from 'node:fs/promises';
import axios, { type AxiosRequestConfig } from 'axios';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { AppError } from '../utils/AppError.ts';
import type { AircraftSnapshot, AircraftState } from '../types/aircraft.ts';
import { typeOf } from './aircraftDb.provider.ts';

// Fuente: https://openskynetwork.github.io/opensky-api/rest.html
const API_URL = 'https://opensky-network.org/api';
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const TIMEOUT_MS = 10_000;
// Tope total de la descarga; el cliente no lo espera porque la caché sirve el dato viejo mientras tanto
const STATES_DEADLINE_MS = 45_000;
export const FIXTURE_URL = new URL('../fixtures/opensky-sample.json', import.meta.url);

export interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

// Índices del arreglo "state vector" según la documentación de OpenSky
const F = {
  icao24: 0,
  callsign: 1,
  timePosition: 3,
  lastContact: 4,
  lng: 5,
  lat: 6,
  baroAltitude: 7,
  onGround: 8,
  velocity: 9,
  trueTrack: 10,
  geoAltitude: 13,
} as const;

// "states" puede venir null cuando no hay aviones
const statesResponseSchema = z.object({
  time: z.number(),
  states: z.array(z.array(z.unknown())).nullable(),
});

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

const hasCredentials = Boolean(env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET);
logger.info(
  { mode: env.USE_FIXTURE ? 'fixture' : hasCredentials ? 'oauth2' : 'anonymous' },
  'OpenSky provider mode',
);

const http = axios.create({ baseURL: API_URL, timeout: TIMEOUT_MS });

let token: { value: string; expiresAt: number } | null = null;

async function getToken(forceRefresh = false): Promise<string | null> {
  if (!hasCredentials) return null;
  // Renovamos 60 s antes de que venza para no usar un token a punto de expirar
  if (!forceRefresh && token && token.expiresAt - 60_000 > Date.now()) return token.value;

  try {
    const { data } = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.OPENSKY_CLIENT_ID ?? '',
        client_secret: env.OPENSKY_CLIENT_SECRET ?? '',
      }),
      { timeout: TIMEOUT_MS },
    );
    const parsed = tokenResponseSchema.parse(data);
    token = { value: parsed.access_token, expiresAt: Date.now() + parsed.expires_in * 1000 };
    return token.value;
  } catch (err) {
    throw toAppError(err, 'token');
  }
}

async function requestStates(params: Record<string, string | number>): Promise<unknown> {
  const call = async (forceRefresh: boolean) => {
    const accessToken = await getToken(forceRefresh);
    // timeout de Axios solo mide silencio: si OpenSky envía la respuesta a goteo, la señal corta el total
    const config: AxiosRequestConfig = { params, signal: AbortSignal.timeout(STATES_DEADLINE_MS) };
    if (accessToken) config.headers = { Authorization: `Bearer ${accessToken}` };
    const res = await http.get('/states/all', config);
    const remaining = res.headers['x-rate-limit-remaining'];
    if (remaining !== undefined) logger.debug({ remaining }, 'OpenSky credits remaining');
    return res.data as unknown;
  };

  try {
    return await call(false);
  } catch (err) {
    // 401 = token vencido: se pide uno nuevo y se reintenta una sola vez
    if (axios.isAxiosError(err) && err.response?.status === 401 && hasCredentials) {
      try {
        return await call(true);
      } catch (retryErr) {
        throw toAppError(retryErr, 'states');
      }
    }
    throw toAppError(err, 'states');
  }
}

function toAppError(err: unknown, step: 'token' | 'states'): AppError {
  if (err instanceof AppError) return err;
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 429) {
      const retry = err.response?.headers['x-rate-limit-retry-after-seconds'];
      logger.warn({ retryAfterSeconds: retry }, 'OpenSky quota exhausted');
      return new AppError(
        503,
        'OPENSKY_QUOTA_EXCEEDED',
        `Se agotó la cuota diaria de OpenSky${retry ? `, reintenta en ${retry} s` : ''}`,
      );
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ERR_CANCELED') {
      return new AppError(504, 'OPENSKY_TIMEOUT', 'OpenSky no respondió a tiempo');
    }
    if (step === 'token' || status === 401 || status === 403) {
      logger.error({ status }, 'OpenSky authentication failed');
      return new AppError(502, 'OPENSKY_AUTH_FAILED', 'No se pudo autenticar con OpenSky');
    }
    logger.error({ status, code: err.code }, 'OpenSky request failed');
    return new AppError(502, 'OPENSKY_UNAVAILABLE', 'OpenSky no está disponible');
  }
  logger.error({ err }, 'OpenSky unexpected error');
  return new AppError(502, 'OPENSKY_UNAVAILABLE', 'Respuesta inesperada de OpenSky');
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Convierte una fila de OpenSky en AircraftState; null si no tiene posición
function toAircraftState(row: unknown[]): AircraftState | null {
  const icao24 = row[F.icao24];
  const lat = num(row[F.lat]);
  const lng = num(row[F.lng]);
  if (typeof icao24 !== 'string' || lat === null || lng === null) return null;

  const callsign = typeof row[F.callsign] === 'string' ? (row[F.callsign] as string).trim() : '';
  return {
    icao24,
    callsign: callsign || null,
    lat,
    lng,
    hdg: num(row[F.trueTrack]),
    spd: num(row[F.velocity]),
    alt: num(row[F.baroAltitude]) ?? num(row[F.geoAltitude]),
    onGround: row[F.onGround] === true,
    type: typeOf(icao24),
    ts: num(row[F.timePosition]) ?? num(row[F.lastContact]) ?? 0,
  };
}

function toSnapshot(raw: unknown): AircraftSnapshot {
  const parsed = statesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(502, 'OPENSKY_BAD_RESPONSE', 'OpenSky devolvió un formato inesperado');
  }
  const aircraft = (parsed.data.states ?? [])
    .map(toAircraftState)
    .filter((a): a is AircraftState => a !== null);
  return { time: parsed.data.time, aircraft };
}

async function readFixture(): Promise<unknown> {
  try {
    return JSON.parse(await readFile(FIXTURE_URL, 'utf8')) as unknown;
  } catch {
    throw new AppError(500, 'FIXTURE_MISSING', 'No se pudo leer fixtures/opensky-sample.json');
  }
}

/** Respuesta cruda de OpenSky para una caja (se usa para grabar el fixture) */
export function fetchRawByBox(box: BoundingBox): Promise<unknown> {
  return requestStates({ ...box });
}

export async function fetchByBox(box: BoundingBox): Promise<AircraftSnapshot> {
  const raw = env.USE_FIXTURE ? await readFixture() : await fetchRawByBox(box);
  return toSnapshot(raw);
}

export async function fetchByIcao24(icao24: string): Promise<AircraftState | null> {
  if (env.USE_FIXTURE) {
    const snapshot = toSnapshot(await readFixture());
    return snapshot.aircraft.find((a) => a.icao24 === icao24) ?? null;
  }
  const snapshot = toSnapshot(await requestStates({ icao24 }));
  return snapshot.aircraft[0] ?? null;
}
