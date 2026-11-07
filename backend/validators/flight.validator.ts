import { z } from 'zod';

const iataCode = (field: string) =>
  z
    .string()
    .regex(/^[a-zA-Z]{3}$/, `${field} debe ser un código IATA de 3 letras`)
    .transform((v) => v.toUpperCase());

// Los números llegan como texto en la URL: coerce los convierte
export const flightListQuerySchema = z.object({
  origin: iataCode('origin').optional(),
  destination: iataCode('destination').optional(),
  // Día de salida en UTC
  date: z.iso.date('date debe ser una fecha válida con formato AAAA-MM-DD').optional(),
  minCapacityKg: z.coerce
    .number('minCapacityKg debe ser un número')
    .min(0, 'minCapacityKg no puede ser negativo')
    .optional(),
  page: z.coerce
    .number('page debe ser un número')
    .int('page debe ser un entero')
    .min(1, 'page debe ser 1 o mayor')
    .default(1),
  limit: z.coerce
    .number('limit debe ser un número')
    .int('limit debe ser un entero')
    .min(1, 'limit debe ser 1 o mayor')
    .max(100, 'limit no puede ser mayor que 100')
    .default(20),
});

export type FlightListQuery = z.infer<typeof flightListQuerySchema>;

export const flightIdParamsSchema = z.object({
  id: z.uuid('id debe ser un UUID válido'),
});
