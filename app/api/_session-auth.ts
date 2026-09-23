// Anonymous-but-isolated session ownership — NOT user accounts/login.
// Each browser gets an opaque random token in an httpOnly cookie. A session
// row remembers which token created it; mutating a session (or a row that
// belongs to one) is only allowed by the token that owns it. Sessions with
// no owner (pre-Phase-3 rows, or the single-session local-dev fallback) stay
// open to anyone, so existing anonymous/local-dev workflows keep working.

import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { sessions } from "../../db/schema";

const COOKIE_NAME = "mc_owner";

export function getOwnerToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Returns the request's existing owner token, or a freshly generated one
// plus the Set-Cookie header needed to persist it (null if none is needed).
export function ensureOwnerToken(request: Request): { token: string; setCookie: string | null } {
  const existing = getOwnerToken(request);
  if (existing) return { token: existing, setCookie: null };
  const token = crypto.randomUUID();
  const setCookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
  return { token, setCookie };
}

// 404s (rather than 401/403, so an unowned session ID can't be probed) if
// the session exists but belongs to a different token. A session with no
// owner is treated as shared/anonymous and left open. Returns null when the
// caller may proceed.
export async function requireOwnedSession(request: Request, sessionId: number): Promise<Response | null> {
  const db = getDb();
  const rows = await db
    .select({ id: sessions.id, ownerToken: sessions.ownerToken })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const session = rows[0];
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
  if (!session.ownerToken) return null;

  const token = getOwnerToken(request);
  if (token !== session.ownerToken) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  return null;
}
