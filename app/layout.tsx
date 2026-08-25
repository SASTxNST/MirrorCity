import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "MirrorCity — Plan the city before it happens",
    description: "A district-scale digital twin for infrastructure simulation, resilience planning, and faster public decisions.",
    openGraph: {
      title: "MirrorCity — Plan the city before it happens",
      description: "Model infrastructure. Simulate pressure. Plan resilient districts.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1734, height: 907, alt: "MirrorCity district digital twin" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "MirrorCity — Plan the city before it happens",
      description: "A district-scale digital twin for resilient city planning.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
