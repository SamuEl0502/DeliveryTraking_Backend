import { createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { env } from '../config/env.ts';
import * as refreshTokenStore from '../repositories/refreshToken.store.ts';
import { AppError } from '../utils/AppError.ts';

// Lo que viaja dentro del access token y queda en req.user
export interface AuthUser {
  id: string;
  role: Role;
}

export const REFRESH_TOKEN_MAX_AGE_MS = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

// Se revisa el contenido del JWT aunque la firma sea válida, para no confiar en su forma
const accessPayloadSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(['CLIENT', 'STAFF']),
});

// ---------- Access token (JWT) ----------

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
  });
}

export function verifyAccessToken(token: string): AuthUser {
  try {
    // algorithms fijo: evita que acepten un token con otro algoritmo (por ejemplo "none")
    const payload = accessPayloadSchema.parse(jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }));
    return { id: payload.sub, role: payload.role };
  } catch (err) {
    // Código aparte para que el frontend sepa que debe llamar a /refresh
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'El token de acceso venció');
    }
    throw new AppError(401, 'INVALID_TOKEN', 'Token de acceso inválido');
  }
}

// ---------- Refresh token (opaco) ----------

// HMAC con secreto: aunque se filtre el almacén, sin el secreto no sirven los hashes
function hashRefreshToken(token: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await refreshTokenStore.save(hashRefreshToken(token), {
    userId,
    expiresAt: Date.now() + REFRESH_TOKEN_MAX_AGE_MS,
    used: false,
  });
  return token;
}

// Cambia un refresh válido por uno nuevo; el anterior ya no sirve
export async function rotateRefreshToken(token: string): Promise<{ userId: string; refreshToken: string }> {
  const record = await refreshTokenStore.consume(hashRefreshToken(token));

  if (!record || record.expiresAt <= Date.now()) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'La sesión no es válida o ya venció');
  }

  // Un token ya usado que vuelve a llegar indica que alguien lo copió: se cierran todas las sesiones
  if (record.used) {
    await refreshTokenStore.removeAllForUser(record.userId);
    throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'La sesión fue cerrada por seguridad, inicia sesión de nuevo');
  }

  return { userId: record.userId, refreshToken: await issueRefreshToken(record.userId) };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await refreshTokenStore.remove(hashRefreshToken(token));
}
