import { createClient } from '@libsql/client';
import fs from 'fs';

const dbUrl = 'file:./data/db.sqlite';

async function ensureTransactionMigration() {
  const db = createClient({ url: dbUrl });

  // Check column transaction_number exists
  const cols = await db.execute(`PRAGMA table_info(numeros_rifa);`);
  const hasTxCol = cols.rows.some((r) => r.name === 'transaction_number');
  if (!hasTxCol) {
    console.log('Adding transaction_number column to numeros_rifa...');
    await db.execute(`ALTER TABLE numeros_rifa ADD COLUMN transaction_number text;`);
  } else {
    console.log('transaction_number already exists in numeros_rifa');
  }

  // Create transactions table if not exists
  console.log('Creating transactions table if missing...');
  await db.execute(`CREATE TABLE IF NOT EXISTS transactions (
    id integer PRIMARY KEY AUTOINCREMENT,
    transaction_number text NOT NULL UNIQUE,
    usuario_cedula text NOT NULL,
    usuario_nombre text NOT NULL,
    campaign_name text NOT NULL,
    event_id integer NOT NULL,
    event_name text NOT NULL,
    cantidad integer NOT NULL,
    promociones integer NOT NULL DEFAULT 0,
    precio_total real NOT NULL,
    created_at text NOT NULL
  );`);

  console.log('Migration 0004 completed.');
  await db.close();
}

ensureTransactionMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
