import { client } from '../db/client';

const PROMO_PACK_SIZE = 3;
const PROMO_WINDOW_MS = 5 * 60 * 1000;

let ensured: Promise<void> | null = null;

export async function ensurePromoPackColumns() {
	if (!ensured) {
		ensured = (async () => {
			// numeros_rifa.promo_hold
			try {
				await client.execute(`ALTER TABLE numeros_rifa ADD COLUMN promo_hold INTEGER DEFAULT 0;`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (!/duplicate column name/i.test(msg) && !/already exists/i.test(msg)) throw err;
			}

			// numeros_rifa.paid_amount (tracks actual paid amount for direct payments)
			try {
				await client.execute(`ALTER TABLE numeros_rifa ADD COLUMN paid_amount REAL;`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (!/duplicate column name/i.test(msg) && !/already exists/i.test(msg)) throw err;
			}

			// transactions promo columns
			for (const stmt of [
				`ALTER TABLE transactions ADD COLUMN promo_started_at TEXT;`,
				`ALTER TABLE transactions ADD COLUMN promo_expires_at TEXT;`,
				`ALTER TABLE transactions ADD COLUMN promo_finalized_at TEXT;`,
			]) {
				try {
					await client.execute(stmt);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					if (!/duplicate column name/i.test(msg) && !/already exists/i.test(msg)) throw err;
				}
			}

			await client.execute(
				`CREATE INDEX IF NOT EXISTS idx_transactions_promo_window ON transactions(event_id, usuario_cedula, promo_expires_at);`
			);
			await client.execute(
				`CREATE INDEX IF NOT EXISTS idx_numeros_rifa_tx_promo_hold ON numeros_rifa(transaction_number, promo_hold);`
			);
		})();
	}

	await ensured;
}

export function getPromoWindowIso(now = Date.now()) {
	const startedAt = new Date(now).toISOString();
	const expiresAt = new Date(now + PROMO_WINDOW_MS).toISOString();
	return { startedAt, expiresAt };
}

export function promoPackSize() {
	return PROMO_PACK_SIZE;
}
