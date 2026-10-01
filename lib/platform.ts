// Platform bindings and secrets, read without importing a runtime-specific
// module.
//
// The app is deployed to Vercel, where there is no `cloudflare:workers` module
// to import: a static import of it fails the Nitro build outright. Cloudflare
// bindings are therefore published here by the Workers entry at request time,
// and everything else falls back to the process environment. Code that needs a
// binding asks for it and handles its absence, rather than assuming a runtime.

type PlatformEnv = Record<string, unknown>;

// Kept on globalThis because the Workers entry and the route handlers are
// separate modules with no other channel between them.
const KEY = "__mirrorcityPlatformEnv";

export function setPlatformEnv(env: PlatformEnv): void {
  (globalThis as Record<string, unknown>)[KEY] = env;
}

function platformEnv(): PlatformEnv {
  return ((globalThis as Record<string, unknown>)[KEY] as PlatformEnv | undefined) ?? {};
}

/**
 * A platform binding such as D1 or R2. Only Cloudflare provides these, so on
 * Vercel this is always undefined and the caller must say so to the user.
 */
export function binding<T = unknown>(name: string): T | undefined {
  return platformEnv()[name] as T | undefined;
}

/** A secret or configuration value, from the platform env or the process env. */
export function secret(name: string): string | undefined {
  const fromPlatform = platformEnv()[name];
  if (typeof fromPlatform === "string" && fromPlatform.length > 0) return fromPlatform;
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return fromProcess && fromProcess.length > 0 ? fromProcess : undefined;
}
