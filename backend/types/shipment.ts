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
