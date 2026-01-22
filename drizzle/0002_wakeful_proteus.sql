CREATE TABLE `usuarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cedula` text NOT NULL,
	`primer_nombre` text NOT NULL,
	`segundo_nombre` text,
	`primer_apellido` text NOT NULL,
	`segundo_apellido` text NOT NULL,
	`fecha_nacimiento` text,
	`correo_electronico` text,
	`telefono` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuarios_cedula_unique` ON `usuarios` (`cedula`);