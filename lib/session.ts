import { SignJWT, jwtVerify } from "jose";

/**
 * Gestion de la session signée. Ce module n'utilise que `jose`, il est donc
 * utilisable depuis le middleware (runtime edge) autant que depuis les routes.
 */

export const SESSION_COOKIE = "tc_session";

export type SessionPayload = { sub: string };

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 24) {
    throw new Error("SESSION_SECRET manquant ou trop court (32+ caractères).");
  }
  return new TextEncoder().encode(value);
}

function ttlHours(): number {
  const parsed = Number(process.env.SESSION_TTL_HOURS ?? 72);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 72;
}

export async function createSession(username: string): Promise<{ token: string; maxAge: number }> {
  const maxAge = ttlHours() * 3600;
  const token = await new SignJWT({ sub: username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(secret());
  return { token, maxAge };
}

export async function readSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sub === "string" ? { sub: payload.sub } : null;
  } catch {
    return null;
  }
}
