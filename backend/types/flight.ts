// Contrato de GET /api/flights y GET /api/flights/:id (fechas en ISO, UTC; pesos en kg)

export type FlightStatus = 'SCHEDULED' | 'DEPARTED' | 'LANDED' | 'CANCELLED';

export interface FlightAirport {
  iataCode: string;
  icaoCode: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  timezone: string;
}

export interface Flight {
  id: string;
  flightNumber: string;
  callsign: string | null;
  aircraftIcao24: string | null;
  status: FlightStatus;
  scheduledDeparture: string;
  scheduledArrival: string;
  origin: FlightAirport;
  destination: FlightAirport;
  capacityKg: number;
  /** Suma de los pesos de los envíos asignados al vuelo */
  assignedKg: number;
  /** capacityKg - assignedKg */
  remainingCapacityKg: number;
  /** Bloqueo optimista: se envía de vuelta al asignar un envío */
  version: number;
}

export interface FlightList {
  flights: Flight[];
  pagination: {
    page: number;
    limit: number;
    /** Vuelos que cumplen los filtros, sumando todas las páginas */
    total: number;
    totalPages: number;
  };
}
