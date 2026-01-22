import { createClient } from '@libsql/client';

const client = createClient({ url: 'file:./data/db.sqlite' });

async function checkTables() {
  const result = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('📊 Tablas en SQLite local:');
  console.log(result.rows);
}

checkTables();
