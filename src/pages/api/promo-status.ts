import type { APIRoute } from 'astro';
import { db } from '../../db/client';
import { transactions, numerosRifa } from '../../db/schema';
import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { getTxLedgerSummary } from '../../lib/tx-ledger';

function promoPackSize() {
  return 3;
}

export const GET: APIRoute = async ({ url, request }) => {
  try {
    const eventId = url.searchParams.get('eventId');
    const cedula = url.searchParams.get('cedula');

    if (!eventId || !cedula) {
      return new Response(
        JSON.stringify({ active: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const nowIso = new Date().toISOString();

    // Find active grace window transaction for this user and event
    const promoTx = await db
      .select({
        transactionNumber: transactions.transactionNumber,
        cantidad: transactions.cantidad,
        promoExpiresAt: transactions.promoExpiresAt,
        promoStartedAt: transactions.promoStartedAt,
        promoFinalizedAt: transactions.promoFinalizedAt,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.eventId, parseInt(eventId)),
          eq(transactions.usuarioCedula, cedula),
          isNotNull(transactions.promoExpiresAt),
          gt(transactions.promoExpiresAt, nowIso),
          gt(transactions.cantidad, 0)
        )
      )
      .orderBy(desc(transactions.promoExpiresAt))
      .limit(1)
      .then((rows) => (rows.length ? rows[0] : null));

    if (!promoTx) {
      return new Response(
        JSON.stringify({ active: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const packSize = promoPackSize();
    const qty = Math.max(0, Number(promoTx.cantidad ?? 0) || 0);
    const targetQty = Math.ceil(qty / packSize) * packSize;
    const requiredAdditional = Math.max(0, targetQty - qty);

    if (requiredAdditional <= 0) {
      return new Response(
        JSON.stringify({ active: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const expiresAt = String(promoTx.promoExpiresAt || '');
    const expMs = expiresAt ? Date.parse(expiresAt) : NaN;
    const nowMs = Date.now();
    const msRemaining = Number.isFinite(expMs) ? Math.max(0, expMs - nowMs) : 0;

    // Get existing numbers in this transaction
    const existingNumbers = await db
      .select({ numero: numerosRifa.numero })
      .from(numerosRifa)
      .where(
        and(
          eq(numerosRifa.transactionNumber, promoTx.transactionNumber),
          eq(numerosRifa.eventId, parseInt(eventId))
        )
      )
      .then((rows) => rows.map((r) => String(r.numero)));

    // Get credited total (ledger-based)
    const ledger = await getTxLedgerSummary(promoTx.transactionNumber);
    const creditedTotal = Number(ledger?.creditedTotal ?? 0) || 0;

    return new Response(
      JSON.stringify({
        active: true,
        transactionNumber: promoTx.transactionNumber,
        existingQty: qty,
        requiredAdditional,
        packSize,
        targetQty,
        expiresAt,
        msRemaining,
        existingNumbers,
        creditedTotal,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in promo-status:', error);
    return new Response(
      JSON.stringify({ active: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
