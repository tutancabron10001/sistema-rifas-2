import { client } from '../db/client';

const PACK_SIZE = 3;

/**
 * Promo grace rule:
 * - While promo window is active, admin may mark as `pago_gracia`.
 * - When the grace window expires:
 *   - regardless of promo completion: `pago_gracia` -> `pago`
 *
 * This is a best-effort, cronless consistency hook.
 */
export async function finalizePromoGracePayments(nowIso: string = new Date().toISOString()) {
	// Expired grace: finalize as paid.
	await client.execute({
		sql: `
      UPDATE numeros_rifa
      SET estado = 'pago', reserved_at = NULL
      WHERE estado = 'pago_gracia'
        AND transaction_number IN (
          SELECT transaction_number
          FROM transactions
          WHERE promo_expires_at IS NOT NULL
            AND promo_expires_at <= ?
        );
    `,
		args: [nowIso],
	});
}
