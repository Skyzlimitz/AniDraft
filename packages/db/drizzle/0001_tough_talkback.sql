CREATE TABLE `invite_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`expires_at` integer,
	`max_uses` integer,
	`uses` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invite_codes_league_id_idx` ON `invite_codes` (`league_id`);--> statement-breakpoint
CREATE TABLE `league_members` (
	`league_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'player' NOT NULL,
	`joined_at` integer NOT NULL,
	`kicked_at` integer,
	PRIMARY KEY(`league_id`, `user_id`),
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `league_members_user_id_idx` ON `league_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `leagues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`commissioner_id` text,
	`season` text NOT NULL,
	`season_year` integer NOT NULL,
	`max_players` integer NOT NULL,
	`pick_timer_seconds` integer DEFAULT 60 NOT NULL,
	`draft_starts_at` integer,
	`status` text DEFAULT 'setup' NOT NULL,
	`finalized_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`commissioner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leagues_commissioner_id_idx` ON `leagues` (`commissioner_id`);