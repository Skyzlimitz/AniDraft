CREATE TABLE `anime` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`romaji_title` text NOT NULL,
	`english_title` text,
	`format` text,
	`season` text,
	`season_year` integer,
	`start_date` integer,
	`episodes_planned` integer,
	`cover_image_url` text,
	`is_adult` integer DEFAULT false NOT NULL,
	`raw_metadata` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `anime_season_season_year_idx` ON `anime` (`season`,`season_year`);--> statement-breakpoint
CREATE TABLE `episodes` (
	`anime_id` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`air_date` integer,
	`score_when_last_fetched` integer,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`anime_id`, `episode_number`),
	FOREIGN KEY (`anime_id`) REFERENCES `anime`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `user` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `user` ADD `avatar_url` text;--> statement-breakpoint
ALTER TABLE `user` ADD `created_at` integer;--> statement-breakpoint
UPDATE `user` SET `created_at` = (unixepoch() * 1000) WHERE `created_at` IS NULL;