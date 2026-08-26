import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// One row per saved workspace session / snapshot
export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  districtName: text("district_name").notNull().default("Varuna River Ward"),
  population: integer("population").notNull().default(2000),
  activeScenario: text("active_scenario").notNull().default("sewer"),
  layers: text("layers").notNull().default("{}"),
  label: text("label").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Assets placed on the map (one row per placed asset)
export const placedAssets = sqliteTable("placed_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  assetId: text("asset_id").notNull(),
  assetName: text("asset_name").notNull(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  rotation: real("rotation").notNull().default(0),
  scale: real("scale").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Utility lines drawn on the map
export const drawnLines = sqliteTable("drawn_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  kind: text("kind").notNull(),
  points: text("points").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Planning zones (polygons)
export const drawnAreas = sqliteTable("drawn_areas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  points: text("points").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Proposed buildings placed on the plan
export const plannedBuildings = sqliteTable("planned_buildings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  floors: integer("floors").notNull().default(4),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Uploaded data files (metadata only)
export const uploads = sqliteTable("uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  filename: text("filename").notNull(),
  fileType: text("file_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status").notNull().default("processing"),
  pointCount: integer("point_count"),
  message: text("message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
