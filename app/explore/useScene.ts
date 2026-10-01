"use client";

import { useEffect, useState } from "react";
import { parseOverpass, type OsmScene } from "../../lib/osm";
import {
  tilesCovering,
  tilesToFacilities,
  tilesToScene,
  TILEJSON_URL,
  type DecodedTile,
  type Facility,
  type SceneDetail,
  type TileId,
} from "../../lib/tiles";

export type SceneSource = "tiles" | "overpass";
/**
 * Overpass runs a live query per request and already struggles with a 700 m
 * box, so the detail pass is only attempted for small scenes. Wider views are
 * tiles only, which is what makes them possible at all.
 */
export const DETAIL_PASS_MAX_RADIUS_M = 1500;

// 100 tiles at a 10 km radius. They are small and CDN-served, so the batch is
// wide enough to keep a city-scale load to a few seconds without opening a
// hundred sockets at once.
const TILE_CONCURRENCY = 25;

export type SceneState = {
  scene: OsmScene | null;
  /**
   * Named hospitals, police and fire stations, schools and transit stops from
   * the tile POI layer. Held separately from the scene so the Overpass upgrade,
   * which does not query POIs, does not throw them away.
   */
  facilities: Facility[];
  source: SceneSource | null;
  /** Set while the detailed pass is still running. */
  upgrading: boolean;
  /** Why the detailed pass did not land, if it did not. */
  detailError: string | null;
  baseError: string | null;
  /** What the distance-based detail limit left out, for the UI to disclose. */
  detail: SceneDetail;
};

const IDLE: SceneState = {
  scene: null,
  facilities: [],
  source: null,
  upgrading: false,
  detailError: null,
  baseError: null,
  detail: { buildingsDropped: 0, roadsDropped: 0 },
};

// The tile URL template carries a build date, so it is read once per session
// rather than hard-coded.
let templatePromise: Promise<string> | null = null;
function tileTemplate(): Promise<string> {
  templatePromise ??= fetch(TILEJSON_URL)
    .then((response) => response.json())
    .then((json: { tiles?: string[] }) => {
      const template = json.tiles?.[0];
      if (!template) throw new Error("Tile service returned no template");
      return template;
    })
    .catch((error) => {
      templatePromise = null;
      throw error;
    });
  return templatePromise;
}

async function decodeTile(template: string, tile: TileId, signal: AbortSignal): Promise<{ tile: TileId; data: DecodedTile } | null> {
  const url = template.replace("{z}", String(tile.z)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y));
  const response = await fetch(url, { signal });
  // A tile with nothing in it (ocean, desert) is served as a 204 or a 404.
  if (!response.ok) return null;
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) return null;

  const [{ VectorTile }, { PbfReader }] = await Promise.all([import("@mapbox/vector-tile"), import("pbf")]);
  return { tile, data: new VectorTile(new PbfReader(new Uint8Array(buffer))) as unknown as DecodedTile };
}

/**
 * Two-stage load. Vector tiles draw the scene within a second and always
 * succeed; Overpass then replaces them with full-detail geometry if it answers.
 * A failed detail pass leaves the tile scene standing rather than blanking it.
 */
export function useScene(lat: number, lon: number, radiusM: number, reloadToken: number): SceneState {
  const [state, setState] = useState<SceneState>(IDLE);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const origin = { lat, lon };

    (async () => {
      setState({ ...IDLE, upgrading: true });

      // Stage one: tiles.
      let tileScene: OsmScene | null = null;
      try {
        const template = await tileTemplate();
        const tiles = tilesCovering(origin, radiusM);

        const decoded: Array<{ tile: TileId; data: DecodedTile }> = [];
        for (let start = 0; start < tiles.length; start += TILE_CONCURRENCY) {
          const batch = await Promise.all(
            tiles.slice(start, start + TILE_CONCURRENCY).map((tile) => decodeTile(template, tile, signal))
          );
          if (signal.aborted) return;
          for (const entry of batch) if (entry) decoded.push(entry);
        }

        const detail: SceneDetail = { buildingsDropped: 0, roadsDropped: 0 };
        tileScene = tilesToScene(decoded, origin, radiusM, detail);
        const facilities = tilesToFacilities(decoded, origin, radiusM);
        const wantsDetailPass = radiusM <= DETAIL_PASS_MAX_RADIUS_M;
        setState({
          scene: tileScene,
          facilities,
          source: "tiles",
          upgrading: wantsDetailPass,
          detailError: null,
          baseError: null,
          detail,
        });
        if (!wantsDetailPass) return;
      } catch (error) {
        if (signal.aborted) return;
        setState({ ...IDLE, baseError: (error as Error).message });
        return;
      }

      // Stage two: Overpass, for the detail the tiles generalise away.
      try {
        const response = await fetch(
          `/api/osm?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&radius=${Math.round(radiusM)}`,
          { signal }
        );
        const payload = await response.json();
        if (signal.aborted) return;
        if (!response.ok) throw new Error((payload as { error?: string }).error ?? `Request failed (${response.status})`);

        const detailed = parseOverpass(payload, origin, radiusM);
        if (signal.aborted) return;
        // Only take the upgrade if it is actually richer: an empty Overpass
        // answer should not wipe a working tile scene.
        if (detailed.buildings.length + detailed.roads.length === 0) {
          setState((current) => ({ ...current, upgrading: false }));
          return;
        }
        setState((current) => ({ ...current, scene: detailed, source: "overpass", upgrading: false, detailError: null, baseError: null }));
      } catch (error) {
        if (signal.aborted) return;
        const message = (error as Error).name === "AbortError" ? null : (error as Error).message;
        setState((current) => ({
          ...current,
          upgrading: false,
          detailError: current.scene ? message : null,
          baseError: current.scene ? null : message ?? current.baseError,
        }));
      }
    })();

    return () => controller.abort();
  }, [lat, lon, radiusM, reloadToken]);

  return state;
}
