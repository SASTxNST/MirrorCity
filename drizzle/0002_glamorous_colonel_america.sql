PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_drawn_areas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`points` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_drawn_areas`("id", "session_id", "points", "created_at") SELECT "id", "session_id", "points", "created_at" FROM `drawn_areas`;--> statement-breakpoint
DROP TABLE `drawn_areas`;--> statement-breakpoint
ALTER TABLE `__new_drawn_areas` RENAME TO `drawn_areas`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_drawn_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`kind` text NOT NULL,
	`points` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_drawn_lines`("id", "session_id", "kind", "points", "created_at") SELECT "id", "session_id", "kind", "points", "created_at" FROM `drawn_lines`;--> statement-breakpoint
DROP TABLE `drawn_lines`;--> statement-breakpoint
ALTER TABLE `__new_drawn_lines` RENAME TO `drawn_lines`;--> statement-breakpoint
CREATE TABLE `__new_placed_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`asset_id` text NOT NULL,
	`asset_name` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`rotation` real DEFAULT 0 NOT NULL,
	`scale` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_placed_assets`("id", "session_id", "asset_id", "asset_name", "x", "y", "rotation", "scale", "created_at") SELECT "id", "session_id", "asset_id", "asset_name", "x", "y", "rotation", "scale", "created_at" FROM `placed_assets`;--> statement-breakpoint
DROP TABLE `placed_assets`;--> statement-breakpoint
ALTER TABLE `__new_placed_assets` RENAME TO `placed_assets`;--> statement-breakpoint
CREATE TABLE `__new_planned_buildings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`floors` integer DEFAULT 4 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_planned_buildings`("id", "session_id", "x", "y", "floors", "created_at") SELECT "id", "session_id", "x", "y", "floors", "created_at" FROM `planned_buildings`;--> statement-breakpoint
DROP TABLE `planned_buildings`;--> statement-breakpoint
ALTER TABLE `__new_planned_buildings` RENAME TO `planned_buildings`;--> statement-breakpoint
CREATE TABLE `__new_sensor_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sensor_id` integer NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`recorded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`sensor_id`) REFERENCES `sensors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sensor_readings`("id", "sensor_id", "metric", "value", "unit", "recorded_at") SELECT "id", "sensor_id", "metric", "value", "unit", "recorded_at" FROM `sensor_readings`;--> statement-breakpoint
DROP TABLE `sensor_readings`;--> statement-breakpoint
ALTER TABLE `__new_sensor_readings` RENAME TO `sensor_readings`;--> statement-breakpoint
CREATE TABLE `__new_sensors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`hardware_id` text NOT NULL,
	`name` text DEFAULT 'Sensor' NOT NULL,
	`type` text DEFAULT 'env' NOT NULL,
	`x` real DEFAULT 0.5 NOT NULL,
	`y` real DEFAULT 0.7 NOT NULL,
	`z` real DEFAULT 0.5 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sensors`("id", "room_id", "hardware_id", "name", "type", "x", "y", "z", "active", "created_at") SELECT "id", "room_id", "hardware_id", "name", "type", "x", "y", "z", "active", "created_at" FROM `sensors`;--> statement-breakpoint
DROP TABLE `sensors`;--> statement-breakpoint
ALTER TABLE `__new_sensors` RENAME TO `sensors`;--> statement-breakpoint
CREATE TABLE `__new_uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`filename` text NOT NULL,
	`file_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`point_count` integer,
	`message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_uploads`("id", "session_id", "filename", "file_type", "size_bytes", "status", "point_count", "message", "created_at") SELECT "id", "session_id", "filename", "file_type", "size_bytes", "status", "point_count", "message", "created_at" FROM `uploads`;--> statement-breakpoint
DROP TABLE `uploads`;--> statement-breakpoint
ALTER TABLE `__new_uploads` RENAME TO `uploads`;