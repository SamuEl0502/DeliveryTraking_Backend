import type { FlightAirport, FlightList } from './flight.ts';

// Contrato de POST /api/shipments. El dueño sale del token, nunca del body
export interface CreateShipmentRequest {
  description: string;
  weightKg: number;
  flightId: string;
}

// Vuelo que puede elegir un cliente: sin datos de capacidad ni de operación
export interface AvailableFlight {
  id: string;
  flightNumber: string;
  scheduledDeparture: string;
  scheduledArrival: string;
  origin: FlightAirport;
  destination: FlightAirport;
}

// Contrato de GET /api/shipments/available-flights
export interface AvailableFlightList {
  flights: AvailableFlight[];
  pagination: FlightList['pagination'];
}

export type ShipmentStatus = 'RECEIVED' | 'LOADED' | 'IN_FLIGHT' | 'UNLOADED' | 'DELIVERED';

// Fila de un listado de envíos. origin y destination son la ruta del envío, no la de su vuelo
export interface ShipmentSummary {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  weightKg: number;
  createdAt: string;
  origin: FlightAirport;
  destination: FlightAirport;
  hasFlight: boolean;
}

// Contrato de GET /api/shipments/mine y GET /api/shipments (del más reciente al más antiguo)
export interface ShipmentList {
  shipments: ShipmentSummary[];
  pagination: FlightList['pagination'];
}
