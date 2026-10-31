import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

// Campos que se pueden mostrar; passwordHash queda fuera a propósito
const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  airportId: true,
} satisfies Prisma.UserSelect;

export type UserRecord = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;
export type UserWithPassword = UserRecord & { passwordHash: string };

// Solo para login y registro: es la única consulta que trae el hash
export function findByEmail(email: string): Promise<UserWithPassword | null> {
  return prisma.user.findUnique({ where: { email }, select: { ...publicUserSelect, passwordHash: true } });
}

export function findById(id: string): Promise<UserRecord | null> {
  return prisma.user.findUnique({ where: { id }, select: publicUserSelect });
}

export function create(data: { email: string; name: string; passwordHash: string; role: Role }): Promise<UserRecord> {
  return prisma.user.create({ data, select: publicUserSelect });
}
