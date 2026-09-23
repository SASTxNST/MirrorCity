import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { uploads } from "../../../db/schema";
import { blankStringField } from "../_validate";

function toError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const full = `${message}\n${cause}`;
  if (full.includes("no such table") || full.includes('"uploads"')) {
    return "Database not initialised. Run `npm run db:generate` then deploy the migration.";
  }
  return message;
}

// GET /api/uploads?sessionId=N
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = Number(url.searchParams.get("sessionId"));
    if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });

    const db = getDb();
    const rows = await db
      .select()
      .from(uploads)
      .where(eq(uploads.sessionId, sessionId));

    return Response.json(rows);
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}

// POST /api/uploads — accept multipart form-data, record metadata, respond immediately
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const sessionId = Number(form.get("sessionId"));

    if (!file || !(file instanceof File)) {
      return Response.json({ error: "file required" }, { status: 400 });
    }
    if (!sessionId) {
      return Response.json({ error: "sessionId required" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "unknown";
    const allowedTypes = ["las", "laz", "tif", "tiff", "obj", "ply", "glb", "gltf", "fbx", "png", "jpg", "jpeg"];

    if (!allowedTypes.includes(ext)) {
      return Response.json({ error: `Unsupported file type: .${ext}` }, { status: 400 });
    }

    const stringError = blankStringField({ filename: file.name });
    if (stringError) return stringError;

    const db = getDb();
    const [row] = await db
      .insert(uploads)
      .values({
        sessionId,
        filename: file.name,
        fileType: ext,
        sizeBytes: file.size,
        status: "registered",
        message: "File metadata recorded. Processing pipeline not yet implemented (see roadmap Phase 1).",
      })
      .returning();

    return Response.json(row, { status: 201 });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}
