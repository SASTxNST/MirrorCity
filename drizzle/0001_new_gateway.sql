CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT 'Unnamed Room' NOT NULL,
	`glb_path` text DEFAULT '/models/room/room.glb' NOT NULL,
	`width_m` real DEFAULT 6 NOT NULL,
	`depth_m` real DEFAULT 5 NOT NULL,
	`height_m` real DEFAULT 3 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sensor_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sensor_id` integer NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`recorded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sensors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`hardware_id` text NOT NULL,
	`name` text DEFAULT 'Sensor' NOT NULL,
	`type` text DEFAULT 'env' NOT NULL,
	`x` real DEFAULT 0.5 NOT NULL,
	`y` real DEFAULT 0.7 NOT NULL,
	`z` real DEFAULT 0.5 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
