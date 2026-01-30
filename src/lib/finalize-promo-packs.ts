import { client } from '../db/client';
import { ensurePromoPackColumns } from './promo-pack';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let ensuredLockCols: Promise<void> | null = null;

async function ensurePromoLockColumns() {
	if (!ensuredLockCols) {
		ensuredLockCols = (async () => {
			try {
				await client.execute(`ALTER TABLE numeros_rifa ADD COLUMN reserved_at TEXT;`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (!/duplicate column name/i.test(msg) && !/already exists/i.test(msg)) throw err;
			}

			try {
				await client.execute(`ALTER TABLE numeros_rifa ADD COLUMN promo_hold INTEGER DEFAULT 0;`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (!/duplicate column name/i.test(msg) && !/already exists/i.test(msg)) throw err;
			}
		})();
	}

	await ensuredLockCols;
}

function parseIsoDateSafe(val: unknown): Date | null {
	if (!val) return null;
	const d = new Date(String(val));
	return Number.isFinite(d.getTime()) ? d : null;
}

export async function finalizePromoPacks(params?: { eventId?: number }) {
	await ensurePromoPackColumns();
	await ensurePromoLockColumns();

	const now = Date.now();
	const nowIso = new Date(now).toISOString();

	// Events with promo enabled
	const eventsRes = await client.execute(
		`SELECT id, raffle_date, promo_price, price FROM events WHERE promo_price IS NOT NULL;`
	);

	const eligibleEventIds: number[] = [];

	for (const row of eventsRes.rows ?? []) {
		const id = Number((row as any).id);
		const raffleDate = parseIsoDateSafe((row as any).raffle_date);
		const promoPrice = Number((row as any).promo_price);
		if (!Number.isFinite(id) || !raffleDate || !Number.isFinite(promoPrice)) continue;

		// Run only from (raffle - 1 day) until raffle time
		const cutoffStart = raffleDate.getTime() - ONE_DAY_MS;
		if (now >= cutoffStart && now < raffleDate.getTime()) {
			eligibleEventIds.push(id);
		}
	}

	const filtered = params?.eventId != null ? eligibleEventIds.filter((x) => x === params.eventId) : eligibleEventIds;
	if (filtered.length === 0) return { finalized: 0 };

	const idsSql = filtered.join(',');
	const txRes = await client.execute(
		`SELECT transaction_number, event_id FROM transactions
		 WHERE promociones > 0
		   AND promo_finalized_at IS NULL
		   AND event_id IN (${idsSql});`
	);

	let finalized = 0;

	for (const row of txRes.rows ?? []) {
		const txNumber = String((row as any).transaction_number ?? '').trim();
		const eventId = Number((row as any).event_id);
		if (!txNumber || !Number.isFinite(eventId)) continue;

		// Nuevo cierre promo:
		// - pagos ya pagados siguen igual
		// - cualquier otra boleta de la promo que NO esté en pago => reservado + promo_hold=1 (no juega y no se auto-libera)
		const safeTx = txNumber.replace(/'/g, "''");
		await client.execute(
			`UPDATE numeros_rifa
			 SET estado = 'reservado', promo_hold = 1, reserved_at = NULL
			 WHERE transaction_number = '${safeTx}'
			   AND estado NOT IN ('pago','pago_gracia');`
		);

		await client.execute(
			`UPDATE transactions SET promo_finalized_at = '${nowIso}' WHERE transaction_number = '${safeTx}';`
		);

		finalized += 1;
	}

	return { finalized };
}
