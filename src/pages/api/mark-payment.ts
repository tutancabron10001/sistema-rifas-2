import { db } from '../../db/client';
import { numerosRifa, transactions } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import { releaseExpiredReservations } from '../../lib/release-expired-reservations';

export async function POST({ request }: any) {
  try {
    const { transactionNumber } = await request.json();

    if (!transactionNumber) {
      return new Response(
        JSON.stringify({ error: 'Transacción requerida' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Consistency rule: release expired reservations before changing states.
    try {
      await releaseExpiredReservations();
    } catch (e) {
      console.warn('Auto-release skipped:', e);
    }

    // If promo grace window is active, keep as 'pago_gracia' (visible until grace expires)
    let nextEstado: 'pago' | 'pago_gracia' = 'pago';
    try {
      const tx = await db
        .select({ promoExpiresAt: transactions.promoExpiresAt, cantidad: transactions.cantidad })
        .from(transactions)
        .where(eq(transactions.transactionNumber, transactionNumber))
        .limit(1);
      if (tx.length > 0) {
        const expiresAt = String(tx[0].promoExpiresAt ?? '').trim();
        const cantidad = Number(tx[0].cantidad ?? 0) || 0;
        const expiresMs = expiresAt ? new Date(expiresAt).getTime() : NaN;
        if (Number.isFinite(expiresMs) && expiresMs > Date.now() && (cantidad % 3) !== 0) {
          nextEstado = 'pago_gracia';
        }
      }
    } catch (e) {
      console.warn('Promo grace check skipped:', e);
    }

    // Actualizar todos los números de la transacción.
    // Preserve paidAmount for direct payments so promo repricing doesn't reduce credited value.
    await db.execute(sql`
      UPDATE numeros_rifa
      SET estado = ${nextEstado},
          reserved_at = NULL,
          paid_amount = CASE
            WHEN coalesce(abonado,0) = 0 THEN coalesce(paid_amount, precio_seleccionado)
            ELSE paid_amount
          END
      WHERE transaction_number = ${transactionNumber}
    `);

    return new Response(
      JSON.stringify({ success: true, message: nextEstado === 'pago_gracia' ? 'Transacción marcada como pago (ventana promo activa)' : 'Transacción marcada como pagada' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error marking payment:', error);
    return new Response(
      JSON.stringify({ error: 'Error al procesar pago' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
