"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import WorldEngine, { type WorldLayers } from "./WorldEngine";
import LivePanel from "./LivePanel";
import type { OsmBuilding } from "../../lib/osm";
import { useScene } from "./useScene";
import { findPlace, PLACES } from "../../lib/places";
import type { GeocodeResult } from "../api/geocode/route";


type Place = { name: string; detail: string; lat: number; lon: number };
type Status = { state: "idle" } | { state: "loading"; message: string } | { state: "error"; message: string } | { state: "ready" };

const DEFAULT_LAYERS: WorldLayers = { buildings: true, roads: true, water: true, green: true, facilities: true };

function formatMetres(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} km` : `${Math.round(value)} m`;
}

function formatArea(m2: number): string {
  return m2 >= 10_000 ? `${(m2 / 10_000).toFixed(2)} ha` : `${Math.round(m2)} m²`;
}

// The URL is an external store that the server cannot read: this route is
// rendered without its query string, so the first client render has to match
// that and correct itself afterwards. useSyncExternalStore is the one hook
// that does this without tripping hydration, because it takes a separate
// server snapshot.
const NO_OP_SUBSCRIBE = () => () => {};
const readSearch = () => window.location.search;
const readServerSearch = () => "";

export default function ExplorePage() {
  // Onboarding hands the chosen place over as ?place=<id>.
  const search = useSyncExternalStore(NO_OP_SUBSCRIBE, readSearch, readServerSearch);
  const start = useMemo(
    () => findPlace(new URLSearchParams(search).get("place")) ?? PLACES[0],
    [search]
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [chosen, setChosen] = useState<Place | null>(null);
  const [chosenRadius, setChosenRadius] = useState<number | null>(null);
  const place = useMemo<Place>(
    () => chosen ?? { name: start.name, detail: start.region, lat: start.lat, lon: start.lon },
    [chosen, start]
  );
  const radius = chosenRadius ?? start.radiusM;
  // The radius the scene was actually built at, so the slider can be moved
  const [layers, setLayers] = useState<WorldLayers>(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<OsmBuilding | null>(null);
  const [hovered, setHovered] = useState<OsmBuilding | null>(null);
  const [loadToken, setLoadToken] = useState(0);

  const { scene, facilities, source, upgrading, detailError, baseError } = useScene(place.lat, place.lon, radius, loadToken);
  const status: Status = useMemo(
    () =>
      baseError
        ? { state: "error", message: baseError }
        : scene
          ? { state: "ready" }
          : { state: "loading", message: "Loading base geometry…" },
    [baseError, scene]
  );
  // The radius the scene on screen was actually built at, so the slider can be
  // moved without silently invalidating the statistics beside it.
  const loadedRadius = scene?.radiusM ?? start.radiusM;

  // Place search, debounced so a typed word costs one Nominatim call.
  useEffect(() => {
    const term = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (term.length < 2) {
        setResults([]);
        setSearchError(null);
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const payload = (await response.json()) as { results?: GeocodeResult[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Search failed");
        setResults(payload.results ?? []);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setResults([]);
        setSearchError((error as Error).message);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);


  const stats = useMemo(() => {
    // Only describe geometry that is actually on screen — leaving the previous
    // area's numbers up during a load would misreport the place being shown.
    if (!scene || status.state !== "ready") return null;
    const roadMetres = scene.roads.reduce((sum, road) => sum + road.lengthM, 0);
    const footprint = scene.buildings.reduce((sum, building) => sum + building.footprintM2, 0);
    const surveyed = scene.buildings.filter((building) => building.heightSource !== "assumed").length;
    const tallest = scene.buildings.reduce<OsmBuilding | null>(
      (best, building) => (!best || building.heightM > best.heightM ? building : best),
      null
    );
    return {
      buildings: scene.buildings.length,
      roads: scene.roads.length,
      roadKm: roadMetres / 1000,
      areas: scene.areas.length,
      footprintHa: footprint / 10_000,
      // Share of buildings whose height came from a survey tag rather than our
      // inference — the honest measure of how real the skyline is.
      surveyedPercent: scene.buildings.length === 0 ? 0 : Math.round((surveyed / scene.buildings.length) * 100),
      tallest,
    };
  }, [scene, status.state]);

  const choosePlace = useCallback((next: Place, nextRadius: number) => {
    setChosen(next);
    setChosenRadius(nextRadius);
    setQuery("");
    setResults([]);
  }, []);

  const inspected = selected ?? hovered;

  return (
    <div className="explore-shell">
      <header className="explore-bar">
        <Link className="explore-brand" href="/">
          <span className="brand-glyph"><i /><i /><i /></span>
          <span>MIRROR<span>CITY</span></span>
        </Link>
        <div className="explore-title">
          <small>REAL-WORLD GEOGRAPHY</small>
          <strong>{place.name}</strong>
        </div>

        <div className="explore-search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search any place on Earth — a campus, a ward, a street"
            aria-label="Search for a place"
            autoComplete="off"
          />
          {searching && <span className="explore-search-state">…</span>}
          {(results.length > 0 || searchError) && (
            <ul className="explore-results">
              {searchError && <li className="explore-result-empty">{searchError}</li>}
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => choosePlace({ name: result.name, detail: result.address, lat: result.lat, lon: result.lon }, result.radiusM)}
                  >
                    <strong>{result.name}</strong>
                    <small>{result.address || result.kind}</small>
                    <em>{result.kind}</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link className="quiet-button explore-exit" href="/">Workspace</Link>
      </header>

      <div className="explore-body">
        <aside className="explore-panel">
          <section className="explore-section">
            <p className="explore-label">Jump to</p>
            <div className="explore-presets">
              {PLACES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={place.lat === entry.lat && place.lon === entry.lon ? "active" : ""}
                  onClick={() => choosePlace({ name: entry.name, detail: entry.region, lat: entry.lat, lon: entry.lon }, entry.radiusM)}
                >
                  <strong>{entry.name}</strong>
                  <small>{entry.region}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="explore-section">
            <p className="explore-label">Radius <b>{formatMetres(radius)}</b></p>
            <input
              type="range"
              min={100}
              max={1500}
              step={50}
              value={radius}
              onChange={(event) => setChosenRadius(Number(event.target.value))}
              aria-label="Scene radius in metres"
            />
            <p className="explore-hint">
              {radius > 900
                ? "Large areas take longer to fetch and draw."
                : "A tighter radius loads faster and keeps detail crisp."}
            </p>
          </section>

          <section className="explore-section">
            <p className="explore-label">Layers</p>
            <div className="explore-layers">
              {(Object.keys(DEFAULT_LAYERS) as Array<keyof WorldLayers>).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`explore-layer ${layers[key] ? "on" : ""}`}
                  onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
                  aria-pressed={layers[key]}
                >
                  <i data-layer={key} />
                  <span>{key === "green" ? "parks & land" : key === "facilities" ? "facilities" : key}</span>
                </button>
              ))}
            </div>
          </section>

          {stats && (
            <section className="explore-section">
              <p className="explore-label">In this area</p>
              <dl className="explore-stats">
                <div><dt>Buildings</dt><dd>{stats.buildings.toLocaleString()}</dd></div>
                <div><dt>Footprint</dt><dd>{stats.footprintHa.toFixed(1)} ha</dd></div>
                <div><dt>Road network</dt><dd>{stats.roadKm.toFixed(1)} km</dd></div>
                <div><dt>Water & green</dt><dd>{stats.areas.toLocaleString()}</dd></div>
                <div><dt>Surveyed heights</dt><dd>{stats.surveyedPercent}%</dd></div>
                <div><dt>Tallest</dt><dd>{stats.tallest ? `${Math.round(stats.tallest.heightM)} m` : "—"}</dd></div>
              </dl>
              <p className="explore-hint">
                {stats.surveyedPercent < 50
                  ? `${100 - stats.surveyedPercent}% of heights are inferred from building type, not surveyed. Treat the skyline as indicative.`
                  : "Most heights here come from surveyed OSM tags."}
              </p>
            </section>
          )}

          <p className="explore-attribution">
            Geometry © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors,
            via OpenFreeMap tiles and the Overpass API. Search by Nominatim.
          </p>
        </aside>

        <main className="explore-stage">
          <WorldEngine scene={scene} facilities={facilities} layers={layers} selectedId={selected?.id ?? null} onSelect={setSelected} onHover={setHovered} />

          <LivePanel lat={place.lat} lon={place.lon} placeName={place.name} country={start.country} facilities={facilities} />

          {status.state === "loading" && (
            <div className="explore-overlay">
              <div className="explore-spinner" />
              <p>{status.message}</p>
            </div>
          )}

          {detailError && !upgrading && (
            <div className="explore-detail-note">
              Showing generalised tile geometry. Full detail is unavailable: {detailError}
              <button type="button" onClick={() => setLoadToken((n) => n + 1)}>Retry</button>
            </div>
          )}

          {status.state === "error" && (
            <div className="explore-overlay">
              <p className="explore-overlay-error">{status.message}</p>
              <button type="button" className="primary-button" onClick={() => setLoadToken((n) => n + 1)}>Try again</button>
            </div>
          )}

          <div className="explore-readout">
            <span><b>LAT</b> {place.lat.toFixed(5)}</span>
            <span><b>LON</b> {place.lon.toFixed(5)}</span>
            <span><b>RADIUS</b> {formatMetres(loadedRadius)}</span>
            <span>
              <b>SOURCE</b>{" "}
              {source === "overpass" ? "FULL DETAIL" : source === "tiles" ? "TILES" : "—"}
              {upgrading && <em className="explore-upgrading"> · loading detail</em>}
            </span>
            <span className="explore-north">N ↑</span>
          </div>

          {inspected && (
            <div className={`explore-inspector ${selected ? "pinned" : ""}`}>
              <div className="explore-inspector-head">
                <div>
                  <small>{inspected.kind.replace(/_/g, " ").toUpperCase()}</small>
                  <strong>{inspected.name ?? "Unnamed structure"}</strong>
                </div>
                {selected && (
                  <button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label="Close inspector">✕</button>
                )}
              </div>
              <dl className="explore-inspector-facts">
                <div><dt>Height</dt><dd>{inspected.heightM.toFixed(1)} m</dd></div>
                <div><dt>Storeys</dt><dd>{inspected.levels ?? "—"}</dd></div>
                <div><dt>Footprint</dt><dd>{formatArea(inspected.footprintM2)}</dd></div>
                <div>
                  <dt>Height from</dt>
                  <dd className={inspected.heightSource === "assumed" ? "inferred" : ""}>
                    {inspected.heightSource === "tag" ? "survey tag" : inspected.heightSource === "levels" ? "storey count" : "inferred"}
                  </dd>
                </div>
              </dl>
              {selected ? (
                <>
                  <p className="explore-label">OpenStreetMap tags</p>
                  <ul className="explore-tags">
                    {Object.entries(inspected.tags).slice(0, 14).map(([key, value]) => (
                      <li key={key}><b>{key}</b><span>{value}</span></li>
                    ))}
                  </ul>
                  <a
                    className="quiet-button explore-osm-link"
                    href={`https://www.openstreetmap.org/${inspected.id.split("#")[0]}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in OpenStreetMap
                  </a>
                </>
              ) : (
                <p className="explore-hint">Click to pin and see every tag.</p>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
