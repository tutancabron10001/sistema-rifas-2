import { db } from '../db/client';
import { events, transactions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { ensurePromoPackColumns, getPromoWindowIso, promoPackSize } from './promo-pack';

export async function maybeStartPromoGraceWindow(opts: { transactionNumber: string; eventId: number }) {
  const transactionNumber = String(opts.transactionNumber || '').trim();
  const eventId = Number(opts.eventId);
  if (!transactionNumber || !Number.isFinite(eventId) || eventId <= 0) return { started: false };

  await ensurePromoPackColumns();

  const eventRow = await db
    .select({ price: events.price, promoPrice: events.promoPrice })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1)
    .then((r) => (r.length ? r[0] : null));

  const promoEligible = Boolean(eventRow && Number(eventRow.price || 0) > 20000 && eventRow.promoPrice != null);
  if (!promoEligible) return { started: false, promoEligible: false };

  const txRow = await db
    .select({
      cantidad: transactions.cantidad,
      promoExpiresAt: transactions.promoExpiresAt,
      // @ts-ignore optional columns
      promoFinalizedAt: (transactions as any).promoFinalizedAt,
    })
    .from(transactions)
    .where(eq(transactions.transactionNumber, transactionNumber))
    .limit(1)
    .then((r) => (r.length ? r[0] : null));

  if (!txRow) return { started: false, promoEligible: true };
  if ((txRow as any)?.promoFinalizedAt) return { started: false, promoEligible: true, finalized: true };

  const packSize = promoPackSize();
  const cantidad = Math.max(0, Number((txRow as any)?.cantidad ?? 0) || 0);
  const missing = (packSize - (cantidad % packSize)) % packSize;
  if (missing <= 0) return { started: false, promoEligible: true, missing };

  const nowMs = Date.now();
  const expiresAtRaw = String((txRow as any)?.promoExpiresAt ?? '').trim();
  const expiresMs = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN;
  const hasActive = Number.isFinite(expiresMs) && expiresMs > nowMs;
  if (hasActive) return { started: false, promoEligible: true, active: true, missing, expiresAt: expiresAtRaw };

  const win = getPromoWindowIso(nowMs);
  await db
    .update(transactions)
    .set({
      // @ts-ignore optional columns
      promoStartedAt: win.startedAt,
      // @ts-ignore optional columns
      promoExpiresAt: win.expiresAt,
    })
    .where(eq(transactions.transactionNumber, transactionNumber));

  return { started: true, promoEligible: true, missing, expiresAt: win.expiresAt };
}
