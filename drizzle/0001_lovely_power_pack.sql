CREATE TABLE `numeros_rifa` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`numero` text NOT NULL,
	`estado` text DEFAULT 'disponible' NOT NULL,
	`precio_seleccionado` real NOT NULL,
	`tipo_precio` text NOT NULL,
	`abonado` real DEFAULT 0,
	`numero_identificacion` text,
	`created_at` text NOT NULL
);
