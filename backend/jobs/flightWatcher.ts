import type { Logger } from 'pino';
import * as watcherRepository from '../repositories/flightWatcher.repository.ts';
import type { WatchedFlight } from '../repositories/flightWatcher.repository.ts';
import { peekUsAircraft } from '../services/aircraft.service.ts';
import type { AircraftState } from '../types/aircraft.ts';

const INTERVAL_MS = 60_000;
// Si el mapa dejó de refrescar la caché, la posición vieja no sirve para decidir
const MAX_POSITION_AGE_MS = 2 * 60_000;
// El avión asignado puede volar otro tramo antes o después: solo cuenta el despegue cerca de la hora programada
const TAKEOFF_EARLY_MS = 60 * 60_000;
const TAKEOFF_LATE_MS = 6 * 60 * 60_000;

export type Transition = 'takeoff' | 'landing' | null;

/** Qué cambio toca según la posición del avión; null si ninguno o si no hay posición reciente */
export function nextTransition(
  f: Pick<WatchedFlight, 'status' | 'scheduledDeparture'>,
  a: AircraftState | undefined,
  now: number,
): Transition {
  if (!a || now - a.ts * 1000 > MAX_POSITION_AGE_MS) return null;
  const departure = f.scheduledDeparture.getTime();
  const inWindow = now >= departure - TAKEOFF_EARLY_MS && now <= departure + TAKEOFF_LATE_MS;
  if (f.status === 'SCHEDULED' && !a.onGround && inWindow) return 'takeoff';
  if (f.status === 'DEPARTED' && a.onGround) return 'landing';
  return null;
}

/** Un ciclo: cruza los vuelos vigilados con la caché de OpenSky. Repetirlo no duplica nada */
export async function checkFlights(log: Logger, now = Date.now()): Promise<void> {
  // Solo la caché del mapa: el job nunca gasta créditos de OpenSky
  const snapshot = peekUsAircraft();
  if (!snapshot) return;
  const byIcao = new Map(snapshot.aircraft.map((a) => [a.icao24, a]));

  for (const f of await watcherRepository.findWatched()) {
    const a = f.aircraftIcao24 ? byIcao.get(f.aircraftIcao24) : undefined;
    const transition = nextTransition(f, a, now);
    if (!a || !transition) continue;
    try {
      const changed =
        transition === 'takeoff' ? await watcherRepository.markDeparted(f, a) : await watcherRepository.markLanded(f, a);
      // changed false: otro ciclo, proceso o el Staff cambió el vuelo antes; el siguiente ciclo lo vuelve a leer
      log.info({ flightId: f.id, flightNumber: f.flightNumber, transition, changed }, 'flight watcher');
    } catch (err) {
      log.error({ err, flightId: f.id, transition }, 'flight watcher update failed');
    }
  }
}

export function startFlightWatcher(log: Logger): void {
  const jobLog = log.child({ job: 'flightWatcher' });
  let running = false;
  // unref: el temporizador no impide que el proceso se cierre en el apagado ordenado
  setInterval(() => {
    // Si un ciclo tarda más de un minuto, el siguiente se salta en vez de solaparse
    if (running) return;
    running = true;
    checkFlights(jobLog)
      .catch((err: unknown) => jobLog.error({ err }, 'flight watcher cycle failed'))
      .finally(() => {
        running = false;
      });
  }, INTERVAL_MS).unref();
}
