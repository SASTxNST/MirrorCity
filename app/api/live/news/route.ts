// GET /api/live/news?place=&country= — recent news about the place on screen,
// from GDELT's document API.
//
// GDELT indexes world news every fifteen minutes and needs no key, but it
// rate-limits a single IP hard: calling it twice in quick succession returns
// 429. Everything therefore goes through one heavily cached edge entry, and
// the client polls on the same fifteen-minute cadence the index updates on.

import { edgeCache, fetchJson } from "../_shared.ts";

const CACHE_SECONDS = 900;
// GDELT's limiter is stricter than its documented one-request-per-five-seconds
// and penalises bursts for a while afterwards, so the last good answer is kept
// for a day and served when a refresh is refused. A day-old headline is worth
// more than an error panel.
const STALE_SECONDS = 86_400;
const MAX_RECORDS = 12;

type GdeltArticle = { url?: string; title?: string; seendate?: string; domain?: string; socialimage?: string; language?: string };

export type NewsItem = { title: string; url: string; domain: string; at: string | null; language: string | null };

// GDELT's seendate is a compact UTC stamp: 20261001T040000Z.
function readSeenDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const place = (params.get("place") ?? "").trim();
  const country = (params.get("country") ?? "").trim().toUpperCase();

  if (place.length < 2 || place.length > 80) {
    return Response.json({ error: "place must be between 2 and 80 characters", items: [] }, { status: 400 });
  }
  if (country && !/^[A-Z]{2}$/.test(country)) {
    return Response.json({ error: "country must be a two-letter code", items: [] }, { status: 400 });
  }

  // Quote the place so GDELT matches the phrase rather than either word.
  const query = `"${place.replace(/"/g, "")}"${country ? ` sourcecountry:${country}` : ""}`;
  const cacheKey = `https://mirrorcity.live/news?q=${encodeURIComponent(query)}`;

  const cache = edgeCache();
  const freshKey = new Request(cacheKey);
  const staleKey = new Request(`${cacheKey}&slot=last-good`);

  const fresh = await cache?.match(freshKey);
  if (fresh) return fresh;

  const payload = await fetchJson(
    "https://api.gdeltproject.org/api/v2/doc/doc?" +
      new URLSearchParams({
        query,
        mode: "artlist",
        maxrecords: String(MAX_RECORDS),
        format: "json",
        sort: "datedesc",
        timespan: "3d",
      }).toString(),
    20_000
  );

  if (payload === null) {
    const stale = await cache?.match(staleKey);
    if (stale) {
      const body = (await stale.json()) as Record<string, unknown>;
      return Response.json(
        { ...body, stale: true },
        { headers: { "Cache-Control": "public, max-age=120" } }
      );
    }
    return Response.json(
      { error: "GDELT is rate-limiting. It is a free service and throttles bursts; this will fill in shortly.", items: [] },
      { status: 502 }
    );
  }

  const articles = (payload as { articles?: GdeltArticle[] }).articles ?? [];
  const items: NewsItem[] = articles
    .filter((article) => article.url && article.title)
    .map((article) => ({
      title: (article.title ?? "").trim(),
      url: article.url ?? "",
      domain: article.domain ?? "",
      at: readSeenDate(article.seendate),
      language: article.language ?? null,
    }));

  const body = { items, query, source: "GDELT", fetchedAt: new Date().toISOString() };
  const response = Response.json(body, { headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` } });
  if (cache) {
    await cache.put(freshKey, response.clone()).catch(() => {});
    await cache
      .put(staleKey, Response.json(body, { headers: { "Cache-Control": `public, max-age=${STALE_SECONDS}` } }))
      .catch(() => {});
  }
  return response;
}
