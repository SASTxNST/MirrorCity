"use client";

import { useCallback, useEffect, useState } from "react";
import { aqiBand, compass, type Aircraft, type AirReading, type Quake } from "../../lib/live";
import type { NewsItem } from "../api/live/news/route";

type Props = { lat: number; lon: number; placeName: string; country?: string };

// Each feed is polled at the rate it actually changes. OpenSky's anonymous
// tier resolves to ten seconds; air quality is hourly; the USGS summary feed
// is rebuilt every minute.
// GDELT reindexes every fifteen minutes and rate-limits hard, so news is
// polled on exactly that cadence.
const POLL_MS = { aircraft: 20_000, quakes: 180_000, air: 600_000, news: 900_000 } as const;

// Half-width of the aircraft query box, and therefore the radius the scope
// draws to. One degree is roughly 110 km.
const SPAN_DEG = 1;

type Feed<T> = { data: T | null; error: string | null; at: number | null };
const EMPTY = { data: null, error: null, at: null };

function useFeed<T>(url: string | null, intervalMs: number): Feed<T> {
  const [feed, setFeed] = useState<Feed<T>>(EMPTY);

  const load = useCallback(async (target: string, signal: AbortSignal) => {
    try {
      const response = await fetch(target, { signal });
      const payload = (await response.json()) as T & { error?: string };
      if (signal.aborted) return;
      if (!response.ok) {
        setFeed({ data: payload, error: payload.error ?? `Feed returned ${response.status}`, at: Date.now() });
        return;
      }
      setFeed({ data: payload, error: null, at: Date.now() });
    } catch (error) {
      if (!signal.aborted) setFeed({ data: null, error: (error as Error).message, at: Date.now() });
    }
  }, []);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    // Deferred so the first fetch does not resolve inside this effect's body.
    const first = setTimeout(() => void load(url, controller.signal), 0);
    const timer = setInterval(() => void load(url, controller.signal), intervalMs);
    return () => {
      controller.abort();
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [url, intervalMs, load]);

  return feed;
}

function km(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(metres >= 100_000 ? 0 : 1)} km` : `${Math.round(metres)} m`;
}

function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

// Square plan-position scope. Aircraft are drawn at their true bearing and
// true range from the scene, so the picture is geometrically honest rather
// than a decorative radar sweep.
function Scope({ aircraft, centre }: { aircraft: Aircraft[]; centre: { lat: number; lon: number } }) {
  const size = 236;
  const half = size / 2;

  return (
    <svg className="live-scope" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Aircraft within 110 km">
      <rect x="0.5" y="0.5" width={size - 1} height={size - 1} fill="none" stroke="#232323" />
      {[0.33, 0.66].map((ring) => (
        <rect
          key={ring}
          x={half - half * ring}
          y={half - half * ring}
          width={half * ring * 2}
          height={half * ring * 2}
          fill="none"
          stroke="#1c1c1c"
        />
      ))}
      <line x1={half} y1="0" x2={half} y2={size} stroke="#1c1c1c" />
      <line x1="0" y1={half} x2={size} y2={half} stroke="#1c1c1c" />

      {aircraft.map((plane) => {
        // North is up: east offsets grow x, north offsets shrink y.
        const dx = ((plane.lon - centre.lon) / SPAN_DEG) * half;
        const dy = ((plane.lat - centre.lat) / SPAN_DEG) * half;
        const x = half + dx;
        const y = half - dy;
        if (x < 2 || x > size - 2 || y < 2 || y > size - 2) return null;
        const heading = plane.headingDeg ?? 0;
        return (
          <g key={plane.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${heading.toFixed(0)})`}>
            <path
              d="M 0 -5 L 3.2 4 L 0 2 L -3.2 4 Z"
              fill={plane.onGround ? "#525252" : "#eaeaea"}
            />
          </g>
        );
      })}

      <rect x={half - 3} y={half - 3} width="6" height="6" fill="none" stroke="#e61919" strokeWidth="1.5" />
    </svg>
  );
}

export default function LivePanel({ lat, lon, placeName, country }: Props) {
  const [open, setOpen] = useState(true);
  const query = `lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;

  const air = useFeed<{ reading: AirReading | null; source: string }>(`/api/live/air?${query}`, POLL_MS.air);
  const sky = useFeed<{ aircraft: Aircraft[]; airborne: number; total: number }>(
    `/api/live/aircraft?${query}&span=${SPAN_DEG}`,
    POLL_MS.aircraft
  );
  const seismic = useFeed<{ nearest: Quake[]; total: number }>(`/api/live/quakes?${query}`, POLL_MS.quakes);
  const news = useFeed<{ items: NewsItem[]; stale?: boolean }>(
    `/api/live/news?place=${encodeURIComponent(placeName)}${country ? `&country=${country}` : ""}`,
    POLL_MS.news
  );

  const reading = air.data?.reading ?? null;
  const band = aqiBand(reading?.usAqi ?? null);
  const aircraft = sky.data?.aircraft ?? [];
  const quakes = seismic.data?.nearest ?? [];
  const stories = news.data?.items ?? [];
  const anyLive = Boolean(reading || aircraft.length || quakes.length || stories.length);

  if (!open) {
    return (
      <button type="button" className="live-reopen" onClick={() => setOpen(true)}>
        <span className={`c-live ${anyLive ? "" : "off"}`}><i />Live</span>
      </button>
    );
  }

  return (
    <aside className="live-panel">
      <header className="live-head">
        <span className={`c-live ${anyLive ? "" : "off"}`}><i />Live feeds</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide live feeds">—</button>
      </header>

      <section className="live-block">
        <p className="live-label">Air · {placeName}</p>
        {air.error && !reading ? (
          <p className="live-note">{air.error}</p>
        ) : reading ? (
          <>
            <div className="live-aqi" data-severity={band.severity}>
              <strong className="c-data">{reading.usAqi ?? "—"}</strong>
              <span>
                US AQI
                <b>{band.label}</b>
              </span>
            </div>
            <dl className="live-grid">
              <div><dt>PM2.5</dt><dd className="c-data">{reading.pm25?.toFixed(1) ?? "—"}<small>µg/m³</small></dd></div>
              <div><dt>PM10</dt><dd className="c-data">{reading.pm10?.toFixed(0) ?? "—"}<small>µg/m³</small></dd></div>
              <div><dt>Temp</dt><dd className="c-data">{reading.temperatureC?.toFixed(1) ?? "—"}<small>°C</small></dd></div>
              <div><dt>Wind</dt><dd className="c-data">{reading.windKph?.toFixed(0) ?? "—"}<small>km/h</small></dd></div>
            </dl>
          </>
        ) : (
          <p className="live-note">Reading…</p>
        )}
      </section>

      <section className="live-block">
        <p className="live-label">
          Aircraft · {sky.data ? `${sky.data.airborne} airborne` : "—"}
          <em>110 km</em>
        </p>
        {sky.error && aircraft.length === 0 ? (
          <p className="live-note">{sky.error}</p>
        ) : (
          <>
            <Scope aircraft={aircraft} centre={{ lat, lon }} />
            <ul className="live-list">
              {aircraft.filter((plane) => !plane.onGround).slice(0, 4).map((plane) => (
                <li key={plane.id}>
                  <b>{plane.callsign ?? plane.id.toUpperCase()}</b>
                  <span>{compass({ lat, lon }, plane)} {km(plane.distanceM)}</span>
                  <u className="c-data">{plane.altitudeM === null ? "—" : `${Math.round(plane.altitudeM)}m`}</u>
                </li>
              ))}
              {aircraft.length === 0 && <li className="live-empty">Nothing in range right now.</li>}
            </ul>
          </>
        )}
      </section>

      <section className="live-block">
        <p className="live-label">
          Seismic · 24 h
          {seismic.data && <em>{seismic.data.total} worldwide</em>}
        </p>
        {seismic.error && quakes.length === 0 ? (
          <p className="live-note">{seismic.error}</p>
        ) : (
          <ul className="live-list">
            {quakes.slice(0, 4).map((quake) => (
              <li key={quake.id}>
                <b className={quake.magnitude >= 5 ? "c-red" : ""}>M{quake.magnitude.toFixed(1)}</b>
                <span>{compass({ lat, lon }, quake)} {km(quake.distanceM)}</span>
                <u>{ago(quake.time)}</u>
              </li>
            ))}
            {quakes.length === 0 && <li className="live-empty">No located events.</li>}
          </ul>
        )}
      </section>

      <section className="live-block">
        <p className="live-label">News · {placeName}<em>{news.data?.stale ? "cached" : "72 h"}</em></p>
        {news.error && stories.length === 0 ? (
          <p className="live-note">{news.error}</p>
        ) : stories.length === 0 ? (
          <p className="live-note">Nothing indexed for this place yet.</p>
        ) : (
          <ul className="live-news">
            {stories.slice(0, 5).map((story) => (
              <li key={story.url}>
                <a href={story.url} target="_blank" rel="noreferrer">{story.title}</a>
                <span>
                  {story.domain}
                  {story.at && <u>{ago(Date.parse(story.at))}</u>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="live-foot">
        OpenSky · USGS · Open-Meteo · GDELT
        {sky.at && <span>· synced {ago(sky.at)}</span>}
      </footer>
    </aside>
  );
}
