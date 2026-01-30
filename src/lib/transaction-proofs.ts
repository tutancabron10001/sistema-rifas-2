import { client } from '../db/client';

let ensured: Promise<void> | null = null;

export async function ensureTransactionProofsTable() {
  if (!ensured) {
    ensured = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS transaction_proofs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_number TEXT NOT NULL,
          kind TEXT NOT NULL,
          amount INTEGER,
          cloudinary_public_id TEXT NOT NULL,
          cloudinary_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          rejected_at TEXT,
          reject_reason TEXT
        );
      `);

      // Self-healing: add columns if the table existed before.
      for (const stmt of [
        `ALTER TABLE transaction_proofs ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';`,
        `ALTER TABLE transaction_proofs ADD COLUMN rejected_at TEXT;`,
        `ALTER TABLE transaction_proofs ADD COLUMN reject_reason TEXT;`,
      ]) {
        try {
          await client.execute(stmt);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/duplicate column name/i.test(msg) && !/already exists/i.test(msg)) throw err;
        }
      }

      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_transaction_proofs_tx_created_at ON transaction_proofs(transaction_number, created_at);`
      );

      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_transaction_proofs_tx_status ON transaction_proofs(transaction_number, status);`
      );
    })();
  }

  await ensured;
}
