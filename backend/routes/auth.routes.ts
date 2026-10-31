import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { login, logout, me, refresh, register } from '../controllers/auth.controller.ts';
import { requireAuth } from '../middlewares/auth.ts';
import { AppError } from '../utils/AppError.ts';

// Más estricto que el general: 10 intentos de login/registro por IP cada 15 min (frena fuerza bruta)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError(429, 'TOO_MANY_REQUESTS', 'Demasiados intentos, espera unos minutos'));
  },
});

export const authRouter = Router();

authRouter.post('/register', authLimiter, register);
authRouter.post('/login', authLimiter, login);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', logout);
authRouter.get('/me', requireAuth, me);
