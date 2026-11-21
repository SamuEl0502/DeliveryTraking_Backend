import { z } from 'zod';

// error: mensaje cuando el campo no viene en la URL
const iataCode = (field: string) =>
  z
    .string(`${field} es obligatorio`)
    .regex(/^[a-zA-Z]{3}$/, `${field} debe ser un código IATA de 3 letras`)
    .transform((v) => v.toUpperCase());

// Los números llegan como texto en la URL: coerce los convierte
export const scheduleQuerySchema = z
  .object({
    origin: iataCode('origin'),
    destination: iataCode('destination'),
    minutes: z.coerce
      .number('minutes debe ser un número')
      .int('minutes debe ser un entero')
      .min(10, 'minutes debe ser 10 o mayor')
      .max(120, 'minutes no puede ser mayor que 120')
      .default(40),
  })
  .refine((q) => q.origin !== q.destination, 'origin y destination deben ser distintos');

export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;
