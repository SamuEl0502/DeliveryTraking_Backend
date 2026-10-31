import type { CookieOptions, Request, Response } from 'express';
import type { z } from 'zod';
import { env } from '../config/env.ts';
import * as authService from '../services/auth.service.ts';
import type { AuthResponse, PublicUser } from '../services/auth.service.ts';
import { REFRESH_TOKEN_MAX_AGE_MS } from '../services/token.service.ts';
import { AppError } from '../utils/AppError.ts';
import { loginBodySchema, registerBodySchema } from '../validators/auth.validator.ts';

const REFRESH_COOKIE = 'refreshToken';

// HttpOnly: JavaScript no la puede leer. Path: el navegador solo la manda a /api/auth
const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth',
};

// Mismo formato de error que validateParams
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE_MS });
}

function readRefreshCookie(req: Request): string | null {
  const token: unknown = req.cookies[REFRESH_COOKIE];
  return typeof token === 'string' && token !== '' ? token : null;
}

export async function register(req: Request, res: Response<AuthResponse>): Promise<void> {
  const session = await authService.register(parseBody(registerBodySchema, req.body));
  setRefreshCookie(res, session.refreshToken);
  res.status(201).json(session.body);
}

export async function login(req: Request, res: Response<AuthResponse>): Promise<void> {
  const session = await authService.login(parseBody(loginBodySchema, req.body));
  setRefreshCookie(res, session.refreshToken);
  res.json(session.body);
}

// Entrega un access token nuevo y cambia la cookie por un refresh nuevo
export async function refresh(req: Request, res: Response<AuthResponse>): Promise<void> {
  const token = readRefreshCookie(req);
  if (!token) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'No hay una sesión activa');
  }

  try {
    const session = await authService.refresh(token);
    setRefreshCookie(res, session.refreshToken);
    res.json(session.body);
  } catch (err) {
    // Si el refresh no sirve se borra la cookie para que el navegador no lo siga mandando
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
    throw err;
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = readRefreshCookie(req);
  if (token) await authService.logout(token);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
  res.status(204).end();
}

export async function me(req: Request, res: Response<PublicUser>): Promise<void> {
  // requireAuth ya lo garantiza; se revisa para que TypeScript lo sepa
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Debes iniciar sesión');
  }
  res.json(await authService.getMe(req.user.id));
}
