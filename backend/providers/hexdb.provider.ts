import axios from 'axios';
import { z } from 'zod';
import { logger } from '../config/logger.ts';
import type { Airport } from '../types/flightDetails.ts';
import { AppError } from '../utils/AppError.ts';

// Fuente: https://hexdb.io — gratis, sin llave; pide no pasar de 1000 peticiones cada 5 min
// Solo se usa para las coordenadas de los aeropuertos que da Aviationstack (no cambian)
const http = axios.create({ baseURL: 'https://hexdb.io/api/v1', timeout: 5_000 });

const airportSchema = z.object({
  icao: z.string(),
  iata: z.string().nullish(),
  airport: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});

/** Aeropuerto con coordenadas, o null si hexdb no lo conoce. Si falla, lanza (para no guardar el null en caché) */
export async function fetchAirport(icao: string): Promise<Airport | null> {
  try {
    const { data } = await http.get(`/airport/icao/${encodeURIComponent(icao)}`);
    const parsed = airportSchema.safeParse(data);
    if (!parsed.success) return null;
    const a = parsed.data;
    // hexdb no trae la ciudad; el frontend muestra el nombre del aeropuerto
    return { icao: a.icao, iata: a.iata ?? null, name: a.airport, city: null, lat: a.latitude, lng: a.longitude };
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status === 404) return null;
    logger.warn({ icao, status }, 'hexdb airport failed');
    throw new AppError(502, 'HEXDB_UNAVAILABLE', 'hexdb no está disponible');
  }
}
