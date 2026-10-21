import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { logger } from '../config/logger.ts';
import type { Airport } from '../types/flightDetails.ts';

// Aeropuertos de OurAirports (dominio público): https://ourairports.com/data/
const DB_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const DB_FILE = new URL('../data/airports.csv', import.meta.url);

let airports: Airport[] = [];

/** Separa una línea CSV respetando comillas ("a, b" y "" dentro de comillas) */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

/** Solo aeropuertos grandes y medianos con vuelos regulares: los que usan las aerolíneas */
export function parseAirports(csv: string): Airport[] {
  const [header, ...rows] = csv.split(/\r?\n/);
  // Por nombre de columna: OurAirports ya añadió columnas otras veces (icao_code)
  const col = new Map(splitCsvLine(header ?? '').map((name, i) => [name, i]));
  const out: Airport[] = [];
  for (const row of rows) {
    const f = splitCsvLine(row);
    const get = (name: string) => f[col.get(name) ?? -1] ?? '';
    const type = get('type');
    if ((type !== 'large_airport' && type !== 'medium_airport') || get('scheduled_service') !== 'yes') continue;
    const lat = Number(get('latitude_deg') || NaN);
    const lng = Number(get('longitude_deg') || NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      icao: get('icao_code') || get('ident'),
      iata: get('iata_code') || null,
      name: get('name'),
      city: get('municipality') || null,
      lat,
      lng,
    });
  }
  return out;
}

export function allAirports(): readonly Airport[] {
  return airports;
}

// Descarga la lista la primera vez (12 MB); si falla, no se muestra el aeropuerto de despegue
export async function loadAirportDb(): Promise<void> {
  try {
    if (!existsSync(DB_FILE)) {
      logger.info('downloading airport database');
      const res = await fetch(DB_URL, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mkdir(new URL('.', DB_FILE), { recursive: true });
      await writeFile(DB_FILE, await res.text());
    }
    airports = parseAirports(await readFile(DB_FILE, 'utf8'));
    logger.info({ airports: airports.length }, 'airport database loaded');
  } catch (err) {
    logger.warn({ err }, 'airport database unavailable');
  }
}
