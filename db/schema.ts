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

// ─── Room-scale digital twin ──────────────────────────────────────────────────

// A physical room being twinned
export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default("Unnamed Room"),
  glbPath: text("glb_path").notNull().default("/models/room/room.glb"),
  widthM: real("width_m").notNull().default(6),
  depthM: real("depth_m").notNull().default(5),
  heightM: real("height_m").notNull().default(3),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// A physical sensor node (ESP8266/ESP32) inside a room
export const sensors = sqliteTable("sensors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull(),
  hardwareId: text("hardware_id").notNull(),   // MAC-derived id from the device e.g. "ESP_A1B2"
  name: text("name").notNull().default("Sensor"),
  type: text("type").notNull().default("env"), // "env" | "occupancy" | "co2" | "multi"
  x: real("x").notNull().default(0.5),         // 0–1 normalised position in the room model
  y: real("y").notNull().default(0.7),         // height fraction
  z: real("z").notNull().default(0.5),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// One row per metric reading from a sensor
export const sensorReadings = sqliteTable("sensor_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sensorId: integer("sensor_id").notNull(),
  metric: text("metric").notNull(),            // "temperature" | "humidity" | "occupancy" | "co2"
  value: real("value").notNull(),
  unit: text("unit").notNull(),                // "°C" | "%" | "bool" | "ppm"
  recordedAt: text("recorded_at").notNull().default(sql`CURRENT_TIMESTAMP`),
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
