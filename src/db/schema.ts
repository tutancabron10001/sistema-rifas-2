import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const campaigns = sqliteTable('campaigns', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	description: text('description'),
	price: real('price').notNull(),
	promoPrice: real('promo_price'),
	imageUrl: text('image_url'),
	numbersMode: text('numbers_mode').notNull(), // '0-99' | '0-999' | '0-9999'
	createdAt: text('created_at').notNull(), // ISO string
});

export const events = sqliteTable('events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	campaignId: integer('campaign_id').notNull(),
	name: text('name').notNull(),
	price: real('price').notNull(),
	promoPrice: real('promo_price'),
	createdAt: text('created_at').notNull(),
	raffleDate: text('raffle_date').notNull(),
});

export const campaignsRelations = relations(campaigns, ({ many }) => ({
	events: many(events),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
	campaign: one(campaigns, {
		fields: [events.campaignId],
		references: [campaigns.id],
	}),
	numerosRifa: many(numerosRifa),
}));

export const numerosRifa = sqliteTable('numeros_rifa', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id').notNull(),
	numero: text('numero').notNull(), // '001', '0042', etc.
	estado: text('estado').notNull().default('disponible'), // 'disponible' | 'reservado' | 'vendido'
	precioSeleccionado: real('precio_seleccionado').notNull(), // precio 1 o promoción
	tipoPrecio: text('tipo_precio').notNull(), // 'normal' | 'promocion'
	abonado: real('abonado').default(0), // monto abonado
	numeroIdentificacion: text('numero_identificacion'), // cédula/ID del comprador
	transactionNumber: text('transaction_number'), // referencia de transacción
	createdAt: text('created_at').notNull(),
});

export const numerosRifaRelations = relations(numerosRifa, ({ one }) => ({
	event: one(events, {
		fields: [numerosRifa.eventId],
		references: [events.id],
	}),
}));

export const transactions = sqliteTable('transactions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	transactionNumber: text('transaction_number').notNull().unique(), // '0001'
	usuarioCedula: text('usuario_cedula').notNull(),
	usuarioNombre: text('usuario_nombre').notNull(),
	campaignName: text('campaign_name').notNull(),
	eventId: integer('event_id').notNull(),
	eventName: text('event_name').notNull(),
	cantidad: integer('cantidad').notNull(),
	promociones: integer('promociones').notNull().default(0),
	precioTotal: real('precio_total').notNull(),
	createdAt: text('created_at').notNull(),
});

export const usuarios = sqliteTable('usuarios', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	cedula: text('cedula').unique().notNull(),
	primerNombre: text('primer_nombre').notNull(),
	segundoNombre: text('segundo_nombre'),
	primerApellido: text('primer_apellido').notNull(),
	segundoApellido: text('segundo_apellido').notNull(),
	fechaNacimiento: text('fecha_nacimiento'),
	departamento: text('departamento'),
	ciudad: text('ciudad'),
	correoElectronico: text('correo_electronico'),
	telefono: text('telefono'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

