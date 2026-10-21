import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { logger } from '../config/logger.ts';

// Base de aeronaves de Mictronics vía tar1090-db: icao24 -> tipo ICAO (B738, A321, C172...)
// Licencia ODC-By 1.0 (atribución): se cita en el README y en el mapa
const DB_URL = 'https://github.com/wiedehopf/tar1090-db/raw/refs/heads/csv/aircraft.csv.gz';
const DB_FILE = new URL('../data/aircraft.csv.gz', import.meta.url);

const types = new Map<string, string>();

/** Filas "A0F1BB;N160AN;A321;00;AIRBUS A-321;..." -> mapa icao24 en minúsculas -> tipo */
export function parseAircraftDb(csv: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of csv.split('\n')) {
    const [icao24, , type] = line.split(';', 3);
    if (icao24 && type) out.set(icao24.toLowerCase(), type);
  }
  return out;
}

/** Tipo ICAO del avión, o null si no está en la base (o aún no cargó) */
export function typeOf(icao24: string): string | null {
  return types.get(icao24) ?? null;
}

// Descarga la base la primera vez; si falla, los aviones salen con type null y el mapa usa el icono genérico
export async function loadAircraftDb(): Promise<void> {
  try {
    if (!existsSync(DB_FILE)) {
      logger.info('downloading aircraft database');
      const res = await fetch(DB_URL, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mkdir(new URL('.', DB_FILE), { recursive: true });
      await writeFile(DB_FILE, Buffer.from(await res.arrayBuffer()));
    }
    const parsed = parseAircraftDb(gunzipSync(await readFile(DB_FILE)).toString('utf8'));
    for (const [k, v] of parsed) types.set(k, v);
    logger.info({ aircraft: types.size }, 'aircraft database loaded');
  } catch (err) {
    logger.warn({ err }, 'aircraft database unavailable');
  }
}
