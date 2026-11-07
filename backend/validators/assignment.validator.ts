import { z } from 'zod';

export const createAssignmentBodySchema = z.object({
  shipmentId: z.uuid('shipmentId debe ser un UUID válido'),
  flightId: z.uuid('flightId debe ser un UUID válido'),
  expectedFlightVersion: z
    .number('expectedFlightVersion debe ser un número')
    .int('expectedFlightVersion debe ser un entero')
    .min(0, 'expectedFlightVersion no puede ser negativo'),
});

export type CreateAssignmentInput = z.infer<typeof createAssignmentBodySchema>;

export const assignmentShipmentParamsSchema = z.object({
  shipmentId: z.uuid('shipmentId debe ser un UUID válido'),
});
