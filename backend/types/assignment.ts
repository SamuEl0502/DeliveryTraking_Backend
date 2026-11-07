// Contrato de POST /api/assignments. La respuesta tiene el formato de GET /api/shipments/:trackingCode
export interface CreateAssignmentRequest {
  shipmentId: string;
  flightId: string;
  /** La version que se leyó de GET /api/flights; si cambió, responde 409 VERSION_CONFLICT */
  expectedFlightVersion: number;
}
