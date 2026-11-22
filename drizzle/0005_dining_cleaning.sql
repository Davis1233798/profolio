ALTER TABLE `dining_tables` ADD COLUMN `zone` text DEFAULT 'main' NOT NULL;
--> statement-breakpoint
ALTER TABLE `dining_tables` ADD COLUMN `shape` text DEFAULT 'square' NOT NULL;
--> statement-breakpoint
ALTER TABLE `dining_tables` ADD COLUMN `coord_x` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `dining_tables` ADD COLUMN `coord_y` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `dining_tables` ADD COLUMN `cleaned_until` text;
--> statement-breakpoint
ALTER TABLE `dining_table_sessions` ADD COLUMN `duration_minutes` integer;
