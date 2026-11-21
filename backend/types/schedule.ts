// Contrato de GET /api/schedules (solo Staff y Admin; fechas en ISO, UTC)

/** Una salida programada real de la ruta */
export interface ScheduledDeparture {
  flightIata: string;
  flightIcao: string | null;
  airlineIata: string | null;
  scheduledDeparture: string;
  scheduledArrival: string | null;
  /** Estado según AirLabs: scheduled, active, landed, cancelled... */
  status: string | null;
  delayMinutes: number | null;
}

/**
 * De dónde salieron los datos:
 * - airlabs: se consultó la API en esta petición (gastó créditos)
 * - cache: se reutilizó una consulta anterior de la misma ruta
 * - fixture: datos de ejemplo (USE_FIXTURE=true)
 */
export type ScheduleSource = 'airlabs' | 'cache' | 'fixture';

export interface ScheduleResponse {
  origin: string;
  destination: string;
  windowMinutes: number;
  /** Momento en que se obtuvieron los datos de la fuente (con caché, es anterior a la petición) */
  generatedAt: string;
  source: ScheduleSource;
  /** Consultas reales hechas hoy a AirLabs (día UTC) */
  queriesToday: number;
  departures: ScheduledDeparture[];
}
