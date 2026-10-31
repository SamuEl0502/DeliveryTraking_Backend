import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../services/token.service.ts';
import { AppError } from '../utils/AppError.ts';

// Exige "Authorization: Bearer <access token>" y deja en req.user el id y el rol
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const [scheme, token] = req.get('authorization')?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) {
    next(new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión'));
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

// Se usa después de requireAuth, por ejemplo: requireAuth, requireRole('STAFF')
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError(403, 'FORBIDDEN', 'No tienes permiso para esta acción'));
      return;
    }
    next();
  };
}
