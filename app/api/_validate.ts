// Shared request-body validation for mutating (POST/PUT) API routes.
// Only adds rejection paths — success-path response shapes are untouched.

// Returns a 400 Response naming the first non-finite (NaN/Infinity) field,
// or null if every provided value is a finite number. `undefined`/`null`
// values are skipped so optional fields stay optional.
export function invalidNumberField(fields: Record<string, unknown>): Response | null {
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return Response.json({ error: `${name} must be a finite number` }, { status: 400 });
    }
  }
  return null;
}

// Returns a 400 Response naming the first empty/whitespace-only string
// field, or null if every provided value is non-blank. `undefined`/`null`
// values are skipped so optional fields stay optional.
export function blankStringField(fields: Record<string, unknown>): Response | null {
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      return Response.json({ error: `${name} must not be empty` }, { status: 400 });
    }
  }
  return null;
}
