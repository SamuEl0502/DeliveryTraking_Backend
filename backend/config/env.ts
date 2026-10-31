import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const envSchema = z.object({
  // coerce: en .env todo es texto, Zod lo convierte a número
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGIN: z.string().min(1),
  // Opcional: la API de aviones no usa la BD; si viene, debe ser una URL de PostgreSQL
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/, error: 'debe ser una URL que empiece por postgresql:// o postgres://' })
    .optional(),
  // Opcionales: sin credenciales OpenSky se usa en modo anónimo (Bloque 2)
  OPENSKY_CLIENT_ID: z.string().optional(),
  OPENSKY_CLIENT_SECRET: z.string().optional(),
  OPENSKY_CACHE_TTL_MS: z.coerce.number().int().min(10_000).default(10_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Opcional: sin llave, GET /api/aircraft/:icao24/schedule responde 503
  AVIATIONSTACK_API_KEY: z.string().optional(),
  // Plan B de demo: servir fixtures/opensky-sample.json en vez de llamar a OpenSky
  USE_FIXTURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Secretos distintos: el de access firma el JWT y el de refresh se usa para hashear el refresh token
  JWT_ACCESS_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

// "PORT=" en el .env llega como texto vacío: lo tratamos como no definido para usar el default
const rawEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  // Fallar al arrancar es mejor que fallar a mitad de una petición
  console.error('Variables de entorno inválidas:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
