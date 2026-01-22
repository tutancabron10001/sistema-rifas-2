import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config();

async function migrate() {
  console.log('🔄 Iniciando migración de SQLite local a Turso...\n');

  // Cliente SQLite local
  const localClient = createClient({ url: 'file:./data/db.sqlite' });

  // Cliente Turso
  const tursoClient = createClient({
    url: process.env.TURSO_CONNECTION_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // Crear tablas en Turso si no existen
  console.log('📋 Verificando/creando tablas en Turso...\n');
  
  const createTables = `
    CREATE TABLE IF NOT EXISTS campaigns (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, name text NOT NULL, description text, price real NOT NULL, promo_price real, image_url text, numbers_mode text NOT NULL, created_at text NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, campaign_id integer NOT NULL, name text NOT NULL, price real NOT NULL, promo_price real, created_at text NOT NULL, raffle_date text NOT NULL);
    CREATE TABLE IF NOT EXISTS numeros_rifa (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, event_id integer NOT NULL, numero text NOT NULL, estado text DEFAULT 'disponible' NOT NULL, precio_seleccionado real NOT NULL, tipo_precio text NOT NULL, abonado real DEFAULT 0, numero_identificacion text, transaction_number text, created_at text NOT NULL);
    CREATE TABLE IF NOT EXISTS usuarios (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, cedula text NOT NULL, primer_nombre text NOT NULL, segundo_nombre text, primer_apellido text NOT NULL, segundo_apellido text NOT NULL, fecha_nacimiento text, correo_electronico text, telefono text, departamento text, ciudad text, created_at text NOT NULL, updated_at text NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_cedula_unique ON usuarios (cedula);
    CREATE TABLE IF NOT EXISTS transactions (id integer PRIMARY KEY AUTOINCREMENT, transaction_number text NOT NULL UNIQUE, usuario_cedula text NOT NULL, usuario_nombre text NOT NULL, campaign_name text NOT NULL, event_id integer NOT NULL, event_name text NOT NULL, cantidad integer NOT NULL, promociones integer NOT NULL DEFAULT 0, precio_total real NOT NULL, created_at text NOT NULL);
  `;
  
  const statements = createTables.split(';').filter(s => s.trim());
  for (const statement of statements) {
    if (statement.trim()) {
      await tursoClient.execute(statement.trim());
    }
  }
  console.log('✅ Tablas verificadas/creadas en Turso\n');

  console.log('✅ Tablas verificadas/creadas en Turso\n');

  try {
    // Migrar campaigns
    console.log('📦 Migrando campañas...');
    const localCampaigns = await localClient.execute('SELECT * FROM campaigns');
    if (localCampaigns.rows.length > 0) {
      for (const row of localCampaigns.rows) {
        await tursoClient.execute({
          sql: 'INSERT INTO campaigns (id, name, description, price, promo_price, image_url, numbers_mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          args: [row.id, row.name, row.description, row.price, row.promo_price, row.image_url, row.numbers_mode, row.created_at]
        });
      }
      console.log(`✅ ${localCampaigns.rows.length} campañas migradas`);
    } else {
      console.log('⚠️  No hay campañas para migrar');
    }

    // Migrar events
    console.log('\n📅 Migrando eventos...');
    const localEvents = await localClient.execute('SELECT * FROM events');
    if (localEvents.rows.length > 0) {
      for (const row of localEvents.rows) {
        await tursoClient.execute({
          sql: 'INSERT INTO events (id, campaign_id, name, price, promo_price, created_at, raffle_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
          args: [row.id, row.campaign_id, row.name, row.price, row.promo_price, row.created_at, row.raffle_date]
        });
      }
      console.log(`✅ ${localEvents.rows.length} eventos migrados`);
    } else {
      console.log('⚠️  No hay eventos para migrar');
    }

    // Migrar usuarios
    console.log('\n👥 Migrando usuarios...');
    const localUsuarios = await localClient.execute('SELECT * FROM usuarios');
    if (localUsuarios.rows.length > 0) {
      for (const row of localUsuarios.rows) {
        await tursoClient.execute({
          sql: 'INSERT INTO usuarios (id, cedula, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, fecha_nacimiento, correo_electronico, telefono, departamento, ciudad, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: [row.id, row.cedula, row.primer_nombre, row.segundo_nombre, row.primer_apellido, row.segundo_apellido, row.fecha_nacimiento, row.correo_electronico, row.telefono, row.departamento, row.ciudad, row.created_at, row.updated_at]
        });
      }
      console.log(`✅ ${localUsuarios.rows.length} usuarios migrados`);
    } else {
      console.log('⚠️  No hay usuarios para migrar');
    }

    // Migrar numeros_rifa
    console.log('\n🎲 Migrando números...');
    const localNumeros = await localClient.execute('SELECT * FROM numeros_rifa');
    if (localNumeros.rows.length > 0) {
      let count = 0;
      for (const row of localNumeros.rows) {
        await tursoClient.execute({
          sql: 'INSERT INTO numeros_rifa (id, event_id, numero, estado, precio_seleccionado, tipo_precio, abonado, numero_identificacion, transaction_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: [row.id, row.event_id, row.numero, row.estado, row.precio_seleccionado, row.tipo_precio, row.abonado, row.numero_identificacion, row.transaction_number, row.created_at]
        });
        count++;
        if (count % 100 === 0) {
          console.log(`  ✅ ${count}/${localNumeros.rows.length} números migrados`);
        }
      }
      console.log(`✅ Total: ${localNumeros.rows.length} números migrados`);
    } else {
      console.log('⚠️  No hay números para migrar');
    }

    // Migrar transactions
    console.log('\n💳 Migrando transacciones...');
    const localTransactions = await localClient.execute('SELECT * FROM transactions');
    if (localTransactions.rows.length > 0) {
      for (const row of localTransactions.rows) {
        await tursoClient.execute({
          sql: 'INSERT INTO transactions (id, transaction_number, usuario_cedula, usuario_nombre, campaign_name, event_id, event_name, cantidad, promociones, precio_total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: [row.id, row.transaction_number, row.usuario_cedula, row.usuario_nombre, row.campaign_name, row.event_id, row.event_name, row.cantidad, row.promociones, row.precio_total, row.created_at]
        });
      }
      console.log(`✅ ${localTransactions.rows.length} transacciones migradas`);
    } else {
      console.log('⚠️  No hay transacciones para migrar');
    }

    console.log('\n🎉 ¡Migración completada exitosamente!');
  } catch (error) {
    console.error('\n❌ Error durante la migración:', error.message);
    process.exit(1);
  }
}

migrate();
