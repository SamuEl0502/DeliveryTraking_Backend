import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Con este archivo Prisma no carga .env solo: por eso el import de dotenv
export default defineConfig({
  schema: path.join('models', 'schema.prisma'),
  migrations: {
    path: 'migrations',
    seed: 'tsx scripts/seed.ts',
  },
});
