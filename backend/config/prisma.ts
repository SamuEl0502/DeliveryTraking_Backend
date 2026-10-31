import { PrismaClient } from '@prisma/client';
import { env } from './env.ts';

// Un solo cliente para toda la app: cada PrismaClient abre su propio grupo de conexiones
export const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
