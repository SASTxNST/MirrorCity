CREATE TABLE `drawn_areas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`points` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drawn_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`kind` text NOT NULL,
	`points` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `placed_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`asset_id` text NOT NULL,
	`asset_name` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`rotation` real DEFAULT 0 NOT NULL,
	`scale` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planned_buildings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`floors` integer DEFAULT 4 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`district_name` text DEFAULT 'Varuna River Ward' NOT NULL,
	`population` integer DEFAULT 2000 NOT NULL,
	`active_scenario` text DEFAULT 'sewer' NOT NULL,
	`layers` text DEFAULT '{}' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`filename` text NOT NULL,
	`file_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`point_count` integer,
	`message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
