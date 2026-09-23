import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { sessions } from "../../../db/schema";
import { blankStringField, invalidNumberField } from "../_validate";
import { ensureOwnerToken, getOwnerToken, requireOwnedSession } from "../_session-auth";

function toError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const full = `${message}\n${cause}`;
  if (full.includes("no such table") || full.includes('"sessions"')) {
    return "Database not initialised. Run `npm run db:generate` then deploy the migration.";
  }
  return message;
}

// GET /api/session — return this browser's own session, isolating it from
// other visitors. A request with no owner cookie yet falls back to the
// pre-Phase-3 behavior (single shared/latest session, created if none
// exists) so local dev and non-browser callers keep working unchanged.
export async function GET(request: Request) {
  try {
    const db = getDb();
    const { token, setCookie } = ensureOwnerToken(request);

    const owned = await db
      .select()
      .from(sessions)
      .where(eq(sessions.ownerToken, token))
      .orderBy(desc(sessions.updatedAt), desc(sessions.id))
      .limit(1);

    let session = owned[0];

    if (!session && setCookie) {
      // Freshly issued token (no cookie was present) — fall back to the
      // single shared/latest session for backward compatibility, claiming
      // it for this token if nobody already has.
      const [latest] = await db
        .select()
        .from(sessions)
        .orderBy(desc(sessions.updatedAt), desc(sessions.id))
        .limit(1);

      if (latest && !latest.ownerToken) {
        [session] = await db.update(sessions).set({ ownerToken: token }).where(eq(sessions.id, latest.id)).returning();
      } else {
        session = latest;
      }
    }

    if (!session) {
      [session] = await db
        .insert(sessions)
        .values({ districtName: "Varuna River Ward", population: 2000, activeScenario: "sewer", layers: "{}", label: "", ownerToken: token })
        .returning();
    }

    const response = Response.json({ session });
    if (setCookie) response.headers.append("Set-Cookie", setCookie);
    return response;
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}

// PUT /api/session — update fields on the latest session
export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as {
      districtName?: string;
      population?: number;
      activeScenario?: string;
      layers?: string;
    };

    const numberError = invalidNumberField({ population: payload.population });
    if (numberError) return numberError;
    const stringError = blankStringField({
      districtName: payload.districtName,
      activeScenario: payload.activeScenario,
      layers: payload.layers,
    });
    if (stringError) return stringError;

    const db = getDb();
    const token = getOwnerToken(request);
    const rows = token
      ? await db.select().from(sessions).where(eq(sessions.ownerToken, token)).orderBy(desc(sessions.updatedAt), desc(sessions.id)).limit(1)
      : await db.select().from(sessions).orderBy(desc(sessions.updatedAt), desc(sessions.id)).limit(1);

    if (rows.length === 0) {
      return Response.json({ error: "No active session" }, { status: 404 });
    }

    const current = rows[0];
    const authError = await requireOwnedSession(request, current.id);
    if (authError) return authError;

    const updates: Partial<typeof current> = { updatedAt: new Date().toISOString() };

    if (payload.districtName !== undefined) updates.districtName = payload.districtName;
    if (payload.population !== undefined) updates.population = payload.population;
    if (payload.activeScenario !== undefined) updates.activeScenario = payload.activeScenario;
    if (payload.layers !== undefined) updates.layers = payload.layers;

    const [updated] = await db
      .update(sessions)
      .set(updates)
      .where(eq(sessions.id, current.id))
      .returning();

    return Response.json({ session: updated });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}
