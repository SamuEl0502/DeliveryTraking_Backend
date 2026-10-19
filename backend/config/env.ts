import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const envSchema = z.object({
  // coerce: en .env todo es texto, Zod lo convierte a número
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGIN: z.string().min(1),
  // Opcional hasta el Bloque 5 (Prisma)
  DATABASE_URL: z.string().optional(),
  // Opcionales: sin credenciales OpenSky se usa en modo anónimo (Bloque 2)
  OPENSKY_CLIENT_ID: z.string().optional(),
  OPENSKY_CLIENT_SECRET: z.string().optional(),
  OPENSKY_CACHE_TTL_MS: z.coerce.number().int().min(10_000).default(10_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Opcional: sin llave, GET /api/aircraft/:icao24/schedule responde 503
  AERODATABOX_API_KEY: z.string().optional(),
  // Dónde se contrató la llave: acceso directo (aerodatabox.com) o RapidAPI (plan gratis Basic)
  AERODATABOX_MARKET: z.enum(['direct', 'rapidapi']).default('direct'),
  // Plan B de demo: servir fixtures/opensky-sample.json en vez de llamar a OpenSky
  USE_FIXTURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
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
