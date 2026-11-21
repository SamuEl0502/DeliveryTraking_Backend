import { readFile } from 'node:fs/promises';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.ts';
import { splitCsvLine } from '../providers/airportDb.provider.ts';

// Carga una vez los aeropuertos comerciales de EE. UU. desde data/airports.csv (OurAirports).
// No modifica los que ya existen (como los del seed) y se puede repetir sin duplicar.

const CSV_FILE = new URL('../data/airports.csv', import.meta.url);

// Zona horaria por estado; en los estados con varias zonas va la mayoritaria
const TIMEZONE_BY_STATE: Record<string, string> = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DE: 'America/New_York',
  DC: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  ID: 'America/Boise',
  IL: 'America/Chicago',
  IN: 'America/New_York',
  IA: 'America/Chicago',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  ME: 'America/New_York',
  MD: 'America/New_York',
  MA: 'America/New_York',
  MI: 'America/New_York',
  MN: 'America/Chicago',
  MS: 'America/Chicago',
  MO: 'America/Chicago',
  MT: 'America/Denver',
  NE: 'America/Chicago',
  NV: 'America/Los_Angeles',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NY: 'America/New_York',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VT: 'America/New_York',
  VA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WV: 'America/New_York',
  WI: 'America/Chicago',
  WY: 'America/Denver',
  // Territorios
  PR: 'America/Puerto_Rico',
  VI: 'America/St_Thomas',
  GU: 'Pacific/Guam',
  AS: 'Pacific/Pago_Pago',
  MP: 'Pacific/Saipan',
};

/** Revisa que el nombre sea una zona horaria que Node reconoce */
function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

try {
  const [header, ...lines] = (await readFile(CSV_FILE, 'utf8')).split(/\r?\n/);
  // Por nombre de columna, no por posición
  const col = new Map(splitCsvLine(header ?? '').map((name, i) => [name, i]));

  const data: Prisma.AirportCreateManyInput[] = [];
  let passedFilter = 0;
  let skippedNoRegion = 0;
  let skippedBadZone = 0;

  for (const line of lines) {
    if (line === '') continue;
    const f = splitCsvLine(line);
    const get = (name: string): string => f[col.get(name) ?? -1] ?? '';

    const type = get('type');
    if (get('iso_country') !== 'US') continue;
    if (type !== 'large_airport' && type !== 'medium_airport') continue;
    if (get('scheduled_service') !== 'yes') continue;

    const iataCode = get('iata_code').toUpperCase();
    const icaoCode = get('icao_code').toUpperCase();
    if (!/^[A-Z]{3}$/.test(iataCode) || !/^[A-Z]{4}$/.test(icaoCode)) continue;

    const lat = Number(get('latitude_deg') || NaN);
    const lng = Number(get('longitude_deg') || NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    passedFilter++;

    // "US-CA" -> "CA"
    const timezone = TIMEZONE_BY_STATE[get('iso_region').replace(/^US-/, '')];
    if (!timezone) {
      skippedNoRegion++;
      continue;
    }
    if (!isValidTimeZone(timezone)) {
      skippedBadZone++;
      continue;
    }

    const name = get('name');
    data.push({ iataCode, icaoCode, name, city: get('municipality') || name, lat, lng, timezone });
  }

  const before = await prisma.airport.count();
  await prisma.airport.createMany({ data, skipDuplicates: true });
  const after = await prisma.airport.count();

  console.log(`filas del CSV que pasaron el filtro: ${passedFilter}`);
  console.log(`omitidas por estado sin zona horaria en la tabla: ${skippedNoRegion}`);
  console.log(`omitidas por zona horaria inválida: ${skippedBadZone}`);
  console.log(`aeropuertos enviados a guardar: ${data.length}`);
  console.log(`aeropuertos nuevos guardados: ${after - before} (antes: ${before}, ahora: ${after})`);
} catch (err) {
  console.error('importAirports falló:', err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
