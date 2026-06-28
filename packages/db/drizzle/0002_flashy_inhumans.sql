CREATE TABLE `pool_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`anilist_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`cover_image` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pool_overrides_league_id_anilist_id_idx` ON `pool_overrides` (`league_id`,`anilist_id`);