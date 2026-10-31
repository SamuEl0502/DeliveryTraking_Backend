import { argon2id, hash, verify } from 'argon2';
import { Prisma } from '@prisma/client';
import type { Role } from '@prisma/client';
import * as userRepository from '../repositories/user.repository.ts';
import type { UserRecord } from '../repositories/user.repository.ts';
import * as tokenService from './token.service.ts';
import { AppError } from '../utils/AppError.ts';
import type { LoginInput, RegisterInput } from '../validators/auth.validator.ts';

// Usuario que se puede mostrar al frontend (sin passwordHash)
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  airportId: string | null;
}

// Respuesta de register, login y refresh. El refresh token no va aquí: viaja en la cookie
export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}

// Lo que recibe el controller: la respuesta y el refresh token para ponerlo en la cookie
export interface AuthSession {
  body: AuthResponse;
  refreshToken: string;
}

// Mismo error para email inexistente y clave mala: así no se puede averiguar qué emails existen
function invalidCredentials(): AppError {
  return new AppError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
}

// Hash de relleno: si el email no existe igual se verifica algo, para tardar lo mismo que con clave mala
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hash('clave-de-relleno-para-tiempos', { type: argon2id });
  return dummyHash;
}

export async function register(input: RegisterInput): Promise<AuthSession> {
  if (await userRepository.findByEmail(input.email)) {
    throw emailTaken();
  }

  const passwordHash = await hash(input.password, { type: argon2id });
  try {
    // El rol se fija aquí: nadie puede registrarse como STAFF
    const user = await userRepository.create({ email: input.email, name: input.name, passwordHash, role: 'CLIENT' });
    return createSession(user);
  } catch (err) {
    // Dos registros con el mismo email al mismo tiempo: lo frena el @unique de la BD
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw emailTaken();
    }
    throw err;
  }
}

export async function login(input: LoginInput): Promise<AuthSession> {
  const user = await userRepository.findByEmail(input.email);
  if (!user) {
    await verify(await getDummyHash(), input.password);
    throw invalidCredentials();
  }

  if (!(await verify(user.passwordHash, input.password))) {
    throw invalidCredentials();
  }

  // Se arma el usuario público a mano para que el hash no se cuele en la respuesta
  return createSession(toPublicUser(user));
}

export async function refresh(refreshToken: string): Promise<AuthSession> {
  const { userId, refreshToken: newRefreshToken } = await tokenService.rotateRefreshToken(refreshToken);

  const user = await userRepository.findById(userId);
  if (!user) {
    await tokenService.revokeRefreshToken(newRefreshToken);
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'La sesión no es válida o ya venció');
  }

  return { body: { accessToken: tokenService.signAccessToken(user), user: toPublicUser(user) }, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string): Promise<void> {
  await tokenService.revokeRefreshToken(refreshToken);
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await userRepository.findById(userId);
  // El token es válido pero el usuario ya no existe
  if (!user) {
    throw new AppError(401, 'INVALID_TOKEN', 'Token de acceso inválido');
  }
  return toPublicUser(user);
}

async function createSession(user: UserRecord): Promise<AuthSession> {
  return {
    body: { accessToken: tokenService.signAccessToken(user), user: toPublicUser(user) },
    refreshToken: await tokenService.issueRefreshToken(user.id),
  };
}

function toPublicUser(u: UserRecord): PublicUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, airportId: u.airportId };
}

function emailTaken(): AppError {
  return new AppError(409, 'EMAIL_TAKEN', 'Ya existe una cuenta con ese email');
}
