// Almacén temporal de refresh tokens en memoria: se pierde al reiniciar el servidor.
// Devuelve promesas para poder cambiarlo luego por una tabla en la BD sin tocar el service.

export interface RefreshTokenRecord {
  userId: string;
  expiresAt: number;
  // true cuando ya se cambió por uno nuevo; se guarda para detectar si alguien lo reutiliza
  used: boolean;
}

// La llave es el hash del token, nunca el token en claro
const tokens = new Map<string, RefreshTokenRecord>();

// Limpieza simple: cada vez que se guarda uno, se borran los vencidos
function removeExpired(): void {
  const now = Date.now();
  for (const [hash, record] of tokens) {
    if (record.expiresAt <= now) tokens.delete(hash);
  }
}

export async function save(hash: string, record: RefreshTokenRecord): Promise<void> {
  removeExpired();
  tokens.set(hash, record);
}

// Devuelve cómo estaba el token y lo marca como usado en el mismo paso,
// así dos refresh simultáneos con el mismo token no pueden pasar los dos
export async function consume(hash: string): Promise<RefreshTokenRecord | null> {
  const record = tokens.get(hash);
  if (!record) return null;
  const before = { ...record };
  record.used = true;
  return before;
}

export async function remove(hash: string): Promise<void> {
  tokens.delete(hash);
}

export async function removeAllForUser(userId: string): Promise<void> {
  for (const [hash, record] of tokens) {
    if (record.userId === userId) tokens.delete(hash);
  }
}
