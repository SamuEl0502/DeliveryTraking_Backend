// Contrato de GET /api/tracking/:trackingCode (público; fechas en ISO, UTC)
import type { FlightAirport, FlightStatus } from './flight.ts';
import type { ShipmentStatus } from './shipment.ts';

/** Posición del avión del envío según la caché de OpenSky. Mismas unidades que AircraftState */
export interface LivePosition {
  lat: number;
  lng: number;
  /** Rumbo en grados desde el norte, sentido horario */
  hdg: number | null;
  /** Velocidad en m/s */
  spd: number | null;
  /** Altitud en metros */
  alt: number | null;
  onGround: boolean;
  /** Momento de la posición, Unix en segundos */
  ts: number;
}

/**
 * Por qué no hay posición. Es un caso normal, no un error:
 * - no_flight: el envío no tiene vuelo
 * - no_aircraft: el vuelo no tiene avión asignado
 * - no_position: el avión no aparece ahora en OpenSky (en tierra sin transpondedor, fuera de EE. UU....)
 * - source_unavailable: OpenSky no respondió y no había datos en caché
 */
export type NoLiveReason = 'no_flight' | 'no_aircraft' | 'no_position' | 'source_unavailable';

export type LiveResult = { live: LivePosition; reason: null } | { live: null; reason: NoLiveReason };

export interface TrackingFlight {
  flightNumber: string;
  callsign: string | null;
  status: FlightStatus;
  scheduledDeparture: string;
  scheduledArrival: string;
  origin: FlightAirport;
  destination: FlightAirport;
}

export type ShipmentTracking = {
  trackingCode: string;
  status: ShipmentStatus;
  flight: TrackingFlight | null;
} & LiveResult;
