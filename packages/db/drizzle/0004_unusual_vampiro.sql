CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`order_json` text NOT NULL,
	`current_pick_index` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_league_id_idx` ON `drafts` (`league_id`);--> statement-breakpoint
CREATE TABLE `picks` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`pick_number` integer NOT NULL,
	`round` integer NOT NULL,
	`user_id` text NOT NULL,
	`anime_id` integer NOT NULL,
	`picked_at` integer NOT NULL,
	`was_auto_pick` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `picks_draft_id_pick_number_idx` ON `picks` (`draft_id`,`pick_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `picks_draft_id_anime_id_idx` ON `picks` (`draft_id`,`anime_id`);--> statement-breakpoint
CREATE INDEX `picks_user_id_idx` ON `picks` (`user_id`);--> statement-breakpoint
CREATE TABLE `roster_swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`user_id` text NOT NULL,
	`dropped_anime_id` integer NOT NULL,
	`picked_up_anime_id` integer NOT NULL,
	`week_number` integer NOT NULL,
	`swapped_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dropped_anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`picked_up_anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `roster_swaps_league_id_user_id_idx` ON `roster_swaps` (`league_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `rosters` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`user_id` text NOT NULL,
	`anime_id` integer NOT NULL,
	`acquired_at` integer NOT NULL,
	`released_at` integer,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rosters_league_id_user_id_idx` ON `rosters` (`league_id`,`user_id`);