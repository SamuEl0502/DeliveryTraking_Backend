import type { AircraftState } from './aircraft.ts';

// Contratos del panel del avión seleccionado (el frontend usa los mismos tipos)

export interface Airport {
  icao: string;
  iata: string | null;
  name: string;
  city: string | null;
  lat: number;
  lng: number;
}

/** Datos fijos del avión (adsbdb) */
export interface AircraftInfo {
  registration: string | null;
  /** Modelo, por ejemplo "Boeing 757 224/W" */
  model: string | null;
  /** Código ICAO del tipo, por ejemplo "B752" */
  icaoType: string | null;
  owner: string | null;
  photoUrl: string | null;
  photoThumbnailUrl: string | null;
}

/** Ruta asignada al indicativo (adsbdb) */
export interface FlightRoute {
  callsign: string;
  /** Número comercial, por ejemplo "UA1855" */
  flightNumber: string | null;
  airline: { name: string; icao: string | null; iata: string | null } | null;
  origin: Airport;
  destination: Airport;
  /** false si la posición del avión no encaja con esta ruta (ruta posiblemente equivocada) */
  verified: boolean;
}

/** Progreso calculado en el backend con las coordenadas (sin llamadas externas) */
export interface FlightProgress {
  totalKm: number;
  flownKm: number;
  remainingKm: number;
  /** 0 a 100 */
  percent: number;
  /** Minutos restantes a la velocidad actual; null si está en tierra o sin velocidad */
  etaMinutes: number | null;
}

/** Respuesta de GET /api/aircraft/:icao24/details */
export interface AircraftDetails {
  state: AircraftState;
  aircraft: AircraftInfo | null;
  route: FlightRoute | null;
  progress: FlightProgress | null;
}

/** Hora de un evento del vuelo; fechas en ISO 8601 UTC */
export interface FlightTimes {
  airportIcao: string | null;
  scheduled: string | null;
  /** Revisada: puede ser real o estimada */
  revised: string | null;
  terminal: string | null;
  gate: string | null;
}

/** Respuesta de GET /api/aircraft/:icao24/schedule (AeroDataBox) */
export interface FlightSchedule {
  flightNumber: string;
  /** Estado según AeroDataBox: Expected, EnRoute, Landed, Delayed, Canceled... */
  status: string;
  departure: FlightTimes;
  arrival: FlightTimes;
  source: 'AeroDataBox';
}
