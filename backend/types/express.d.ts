import type { Logger } from 'pino';
import type { AuthUser } from '../services/token.service.ts';

// Amplía el tipo Request de Express con lo que agregan los middlewares
declare global {
  namespace Express {
    interface Request {
      // correlationId
      correlationId: string;
      log: Logger;
      // requireAuth: solo existe en rutas protegidas
      user?: AuthUser;
    }
  }
}

export {};
