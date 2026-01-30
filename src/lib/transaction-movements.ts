import { client } from '../db/client';

let ensured: Promise<void> | null = null;

// Movimientos validados por el administrador (NO comprobantes del usuario)
// Se usan para construir el histórico en correos.
export async function ensureTransactionMovementsTable() {
  if (!ensured) {
    ensured = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS transaction_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_number TEXT NOT NULL,
          kind TEXT NOT NULL,
          amount INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_transaction_movements_tx_created_at ON transaction_movements(transaction_number, created_at);`
      );
    })();
  }

  await ensured;
}
