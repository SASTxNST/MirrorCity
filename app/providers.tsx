"use client";

import { ClerkProvider } from "@clerk/clerk-react";

// @clerk/nextjs cannot run here: it loads a Node `require` shim for filesystem
// access, which Cloudflare Workers has no equivalent for. The React SDK talks
// to Clerk's Frontend API from the browser instead, and API routes verify the
// session token with @clerk/backend.
const PUBLISHABLE_KEY =
  import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  "";

// Clerk's own screens, restyled to the console's matte-black square language
// so sign-in does not look like a different product.
const appearance = {
  variables: {
    colorBackground: "#0a0a0a",
    colorForeground: "#f2f2f2",
    colorPrimary: "#ffffff",
    colorPrimaryForeground: "#000000",
    colorInput: "#111111",
    colorInputForeground: "#f2f2f2",
    colorMuted: "#0f0f0f",
    colorMutedForeground: "#8a8a8a",
    colorBorder: "#262626",
    colorRing: "#3d3d3d",
    borderRadius: "0px",
    fontSize: "14px",
  },
} as const;

export default function Providers({ children }: { children: React.ReactNode }) {
  if (!PUBLISHABLE_KEY) {
    return (
      <div className="boot-error">
        <h1>Clerk key missing</h1>
        <p>
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>.env.local</code>, then restart the dev server.
        </p>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} appearance={appearance}>
      {children}
    </ClerkProvider>
  );
}
