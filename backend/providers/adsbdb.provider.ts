import axios from 'axios';
import { z } from 'zod';
import { logger } from '../config/logger.ts';
import { AppError } from '../utils/AppError.ts';
import type { AircraftInfo, Airport, RawRoute } from '../types/flightDetails.ts';

// Fuente: https://github.com/mrjackwills/adsbdb (gratis, sin llave)
// Licencia: los datos de rutas no se pueden copiar a otra base de datos; solo caché en memoria
const http = axios.create({ baseURL: 'https://api.adsbdb.com/v0', timeout: 5_000 });

const airportSchema = z.object({
  icao_code: z.string(),
  iata_code: z.string().nullish(),
  name: z.string(),
  municipality: z.string().nullish(),
  latitude: z.number(),
  longitude: z.number(),
});

const aircraftSchema = z.object({
  response: z.object({
    aircraft: z.object({
      registration: z.string().nullish(),
      manufacturer: z.string().nullish(),
      type: z.string().nullish(),
      icao_type: z.string().nullish(),
      registered_owner: z.string().nullish(),
      url_photo: z.string().nullish(),
      url_photo_thumbnail: z.string().nullish(),
    }),
  }),
});

const routeSchema = z.object({
  response: z.object({
    flightroute: z.object({
      callsign: z.string(),
      callsign_iata: z.string().nullish(),
      airline: z
        .object({ name: z.string(), icao: z.string().nullish(), iata: z.string().nullish() })
        .nullish(),
      origin: airportSchema,
      destination: airportSchema,
    }),
  }),
});

function toAirport(a: z.infer<typeof airportSchema>): Airport {
  return {
    icao: a.icao_code,
    iata: a.iata_code ?? null,
    name: a.name,
    city: a.municipality ?? null,
    lat: a.latitude,
    lng: a.longitude,
  };
}

// 404 de adsbdb = "unknown aircraft/callsign": no es un error, solo no hay dato
async function get<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const { data } = await http.get(path);
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      logger.warn({ path }, 'adsbdb unexpected format');
      throw new AppError(502, 'ADSBDB_BAD_RESPONSE', 'adsbdb devolvió un formato inesperado');
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    logger.error({ path, status: axios.isAxiosError(err) ? err.response?.status : undefined }, 'adsbdb failed');
    throw new AppError(502, 'ADSBDB_UNAVAILABLE', 'adsbdb no está disponible');
  }
}

export async function fetchAircraftInfo(icao24: string): Promise<AircraftInfo | null> {
  const data = await get(`/aircraft/${encodeURIComponent(icao24)}`, aircraftSchema);
  if (!data) return null;
  const a = data.response.aircraft;
  const model = [a.manufacturer, a.type].filter(Boolean).join(' ');
  return {
    registration: a.registration ?? null,
    model: model || null,
    icaoType: a.icao_type ?? null,
    owner: a.registered_owner ?? null,
    photoUrl: a.url_photo ?? null,
    photoThumbnailUrl: a.url_photo_thumbnail ?? null,
    photoLink: null,
    photographer: null,
  };
}

/** Ruta sin verificar (verified la decide el service con la posición del avión) */
export async function fetchRoute(callsign: string): Promise<RawRoute | null> {
  const data = await get(`/callsign/${encodeURIComponent(callsign)}`, routeSchema);
  if (!data) return null;
  const r = data.response.flightroute;
  return {
    callsign: r.callsign,
    flightNumber: r.callsign_iata ?? null,
    airline: r.airline
      ? { name: r.airline.name, icao: r.airline.icao ?? null, iata: r.airline.iata ?? null }
      : null,
    origin: toAirport(r.origin),
    destination: toAirport(r.destination),
  };
}
