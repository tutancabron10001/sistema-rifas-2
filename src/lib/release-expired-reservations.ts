import { client } from '../db/client';

const RESERVATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

let ensured: Promise<void> | null = null;

async function ensureReservedAtColumn() {
  if (!ensured) {
    ensured = (async () => {
      // Self-healing: add reserved_at if missing (helps on serverless without manual migrations)
      try {
        await client.execute(`ALTER TABLE numeros_rifa ADD COLUMN reserved_at TEXT;`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // SQLite/libsql throws "duplicate column name" if it already exists
        if (!/duplicate column name/i.test(msg) && !/already exists/i.test(msg)) {
          throw err;
        }
      }

		// Self-healing: promo_hold used to prevent auto-release for promo packs
		try {
			await client.execute(`ALTER TABLE numeros_rifa ADD COLUMN promo_hold INTEGER DEFAULT 0;`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!/duplicate column name/i.test(msg) && !/already exists/i.test(msg)) {
				throw err;
			}
		}

    // Self-healing: paid_amount preserves direct-payment credit across repricing (promo grace, etc.)
    try {
      await client.execute(`ALTER TABLE numeros_rifa ADD COLUMN paid_amount INTEGER;`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(msg) && !/already exists/i.test(msg)) {
        throw err;
      }
    }

      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_numeros_rifa_estado_reserved_at ON numeros_rifa(estado, reserved_at);`
      );
    })();
  }

  await ensured;
}

export async function releaseExpiredReservations(params?: { eventId?: number }) {
  await ensureReservedAtColumn();

  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - RESERVATION_TTL_MS).toISOString();

  const eventId = params?.eventId;
  const eventFilter = Number.isInteger(eventId) ? ` AND event_id = ${eventId}` : '';
  // Note: we intentionally do NOT block releases based on transaction_movements anymore.

  // Capture impacted transactions BEFORE releasing rows, so we can de-promote pricing if a promo pack breaks.
  const impacted = await client.execute(`
    SELECT distinct transaction_number as tx, event_id as eventId
    FROM numeros_rifa
    WHERE estado = 'reservado'
      AND reserved_at IS NOT NULL
      AND reserved_at <= '${cutoffIso}'
      AND transaction_number IS NOT NULL
	  AND (promo_hold IS NULL OR promo_hold != 1)
      ${eventFilter};
  `);
  const impactedTxs = (impacted.rows || [])
    .map((r: any) => ({ tx: String(r?.tx || '').trim(), eventId: Number((r as any)?.eventId ?? 0) || 0 }))
    .filter((x: any) => x.tx && Number.isFinite(x.eventId) && x.eventId > 0);

  // Normalize legacy rows: if a row is reserved but reserved_at is missing, start the clock now.
  // This keeps the rule strictly based on reserved_at without guessing other timestamps.
  await client.execute(`
    UPDATE numeros_rifa
    SET reserved_at = '${nowIso}'
    WHERE estado = 'reservado'
      AND reserved_at IS NULL
	  AND (promo_hold IS NULL OR promo_hold != 1)
      ${eventFilter};
  `);

  // Atomic release: only rows still reserved AND expired based on reserved_at.
  await client.execute(`
    UPDATE numeros_rifa
    SET
      estado = 'disponible',
      numero_identificacion = NULL,
      transaction_number = NULL,
      tipo_precio = 'normal',
      abonado = 0,
      reserved_at = NULL,
      promo_hold = 0,
      precio_seleccionado = (
        SELECT price FROM events WHERE id = numeros_rifa.event_id
      )
    WHERE
      estado = 'reservado'
      AND reserved_at IS NOT NULL
      AND reserved_at <= '${cutoffIso}'
	  AND (promo_hold IS NULL OR promo_hold != 1)
      ${eventFilter};
  `);

  // If a transaction loses reserved numbers while it was promo-priced, remaining tickets must revert to normal pricing.
  // Business rule: remaining stay 'abonada' (if they had any validated credit), but promo pricing is cancelled.
  for (const it of impactedTxs) {
    try {
      await client.execute(`
        UPDATE numeros_rifa
        SET
          tipo_precio = 'normal',
          precio_seleccionado = (SELECT price FROM events WHERE id = numeros_rifa.event_id),
          estado = CASE WHEN estado = 'pago_gracia' THEN 'pago' ELSE estado END
        WHERE
          event_id = ${it.eventId}
          AND transaction_number = '${it.tx}'
          AND tipo_precio = 'promocion';
      `);

      // Keep transaction metadata consistent: no promo packs, totals recomputed at normal unit.
      await client.execute(`
        UPDATE transactions
        SET
          promociones = 0,
          cantidad = (SELECT count(*) FROM numeros_rifa WHERE event_id = ${it.eventId} AND transaction_number = '${it.tx}'),
          precio_total = (
            SELECT coalesce(count(*),0) * (SELECT price FROM events WHERE id = ${it.eventId})
            FROM numeros_rifa
            WHERE event_id = ${it.eventId} AND transaction_number = '${it.tx}'
          ),
          promo_started_at = NULL,
          promo_expires_at = NULL,
          promo_finalized_at = NULL
        WHERE transaction_number = '${it.tx}';
      `);
    } catch (e) {
      // Best-effort: releases should not fail because of promo cleanup.
      console.warn('Promo cleanup after release failed:', it, e);
    }
  }

  const changes = await client.execute(`SELECT changes() as released;`);
  const released = Number(changes.rows?.[0]?.released ?? 0);

  return { released, cutoffIso };
}
