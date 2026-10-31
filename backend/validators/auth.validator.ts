import { z } from 'zod';

// Email en minúsculas para que "Ana@x.com" y "ana@x.com" sean la misma cuenta
const emailSchema = z.string().trim().toLowerCase().pipe(z.email('email no es válido'));

// 72 es el límite clásico de bcrypt; lo dejamos igual para no aceptar claves gigantes
const passwordSchema = z
  .string()
  .min(8, 'la contraseña debe tener al menos 8 caracteres')
  .max(72, 'la contraseña no puede tener más de 72 caracteres');

// No hay campo role: todo registro es CLIENT
export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z
    .string()
    .trim()
    .min(1, 'name no puede estar vacío')
    .max(100, 'name no puede tener más de 100 caracteres'),
});

// En login no se revisa el largo de la clave: una mala solo debe dar INVALID_CREDENTIALS
export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'password es obligatoria').max(72, 'password no puede tener más de 72 caracteres'),
});

export type RegisterInput = z.infer<typeof registerBodySchema>;
export type LoginInput = z.infer<typeof loginBodySchema>;
