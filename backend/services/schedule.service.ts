import type { Logger } from 'pino';
import { env } from '../config/env.ts';
import * as airlabs from '../providers/airlabs.provider.ts';
import type { ScheduledDeparture, ScheduleResponse } from '../types/schedule.ts';
import { AppError } from '../utils/AppError.ts';
import { TtlCache } from '../utils/ttlCache.ts';
import type { ScheduleQuery } from '../validators/schedule.validator.ts';

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
