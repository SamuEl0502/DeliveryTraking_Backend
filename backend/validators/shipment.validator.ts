import { z } from 'zod';

// trackingCode: código que ve el cliente, por ejemplo "DT-A1B2C3"
export const trackingCodeParamsSchema = z.object({
  trackingCode: z
    .string()
    .trim()
    .min(1, 'trackingCode no puede estar vacío')
    .max(32, 'trackingCode no puede tener más de 32 caracteres'),
});
