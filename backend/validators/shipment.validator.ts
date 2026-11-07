import { z } from 'zod';

// trackingCode: código que ve el cliente, por ejemplo "DT-A1B2C3"
export const trackingCodeParamsSchema = z.object({
  trackingCode: z
    .string()
    .trim()
    .min(1, 'trackingCode no puede estar vacío')
    .max(32, 'trackingCode no puede tener más de 32 caracteres'),
});

// Los campos que no están aquí, como ownerId, se descartan
export const createShipmentBodySchema = z.object({
  description: z
    .string('description es obligatoria')
    .trim()
    .min(1, 'description no puede estar vacía')
    .max(200, 'description no puede tener más de 200 caracteres'),
  // Límites de la columna Decimal(8, 2)
  weightKg: z
    .number('weightKg debe ser un número')
    .positive('weightKg debe ser mayor que 0')
    .max(999999.99, 'weightKg no puede ser mayor que 999999.99')
    .multipleOf(0.01, 'weightKg admite hasta 2 decimales'),
  flightId: z.uuid('flightId debe ser un UUID válido'),
});

export type CreateShipmentInput = z.infer<typeof createShipmentBodySchema>;
