import { drizzle } from "drizzle-orm/d1";
import { binding } from "../lib/platform";
import * as schema from "./schema";

export function getDb() {
  const d1 = binding("DB");
  if (!d1) {
    throw new Error(
      "No database is bound. The saved-workspace features need a Cloudflare D1 binding named `DB`; " +
        "the current deployment has none, so sessions and placed assets are not persisted."
    );
  }

  return drizzle(d1 as Parameters<typeof drizzle>[0], { schema });
}
