import type { APIRoute } from 'astro';
import { v2 as cloudinary } from 'cloudinary';
import { db } from '../../db/client';
import { numerosRifa, transactions, transactionProofs } from '../../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { ensureTransactionProofsTable } from '../../lib/transaction-proofs';
import { ensureTransactionMovementsTable } from '../../lib/transaction-movements';
import { getTxLedgerSummary } from '../../lib/tx-ledger';

cloudinary.config({
  cloud_name: import.meta.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME,
  api_key: import.meta.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY,
  api_secret: import.meta.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRET,
});

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB

function uploadBufferToCloudinary(buffer: Buffer, folder: string) {
  return new Promise<{ secureUrl: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve({ secureUrl: result.secure_url, publicId: result.public_id });
      }
    );

    stream.end(buffer);
  });
}

function inferMinAbono(isPromo: boolean, _cantidad: number) {
  // Regla de negocio: abono mínimo para boletas normales $10.000 COP,
  // y para promociones $20.000 COP.
  return isPromo ? 20000 : 10000;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    await ensureTransactionProofsTable();

    const form = await request.formData();

    const transactionNumber = String(form.get('transactionNumber') ?? '').trim();
    const cedula = String(form.get('cedula') ?? '').trim();
    const kind = String(form.get('kind') ?? '').trim(); // 'pago' | 'abono'

    const amountRaw = form.get('amount');
    const amountStr = amountRaw == null ? '' : String(amountRaw).trim();
    const amount = amountStr === '' ? null : Number(amountStr);

    const file = form.get('file');

    if (!transactionNumber) {
      return new Response(JSON.stringify({ error: 'transactionNumber requerido' }), { status: 400 });
    }

    if (!cedula) {
      return new Response(JSON.stringify({ error: 'cedula requerida' }), { status: 400 });
    }

    if (kind !== 'pago' && kind !== 'abono') {
      return new Response(JSON.stringify({ error: 'kind inválido' }), { status: 400 });
    }

    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: 'Archivo requerido' }), { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return new Response(JSON.stringify({ error: 'Archivo muy grande (máx 8MB)' }), { status: 400 });
    }

    // 1) Validar transacción y que pertenezca a la cédula
    const tx = await db
      .select({ transactionNumber: transactions.transactionNumber, usuarioCedula: transactions.usuarioCedula })
      .from(transactions)
      .where(eq(transactions.transactionNumber, transactionNumber))
      .limit(1);

    if (tx.length === 0) {
      return new Response(JSON.stringify({ error: 'Transacción no existe' }), { status: 404 });
    }

    if (String(tx[0].usuarioCedula) !== cedula) {
      return new Response(JSON.stringify({ error: 'Transacción no corresponde a la cédula' }), { status: 403 });
    }

    // 1.5) Calcular saldo pendiente basado SOLO en el ledger validado por admin (transaction_movements)
    await ensureTransactionMovementsTable();
    const ledger = await getTxLedgerSummary(transactionNumber, { includePaidRowsCredit: false });

    const totals = await db
      .select({
        cantidad: sql<number>`count(1)`,
      })
      .from(numerosRifa)
      .where(eq(numerosRifa.transactionNumber, transactionNumber));

    const totalPrice = Number(ledger.totalPrice ?? 0) || 0;
    const cantidad = Number((totals as any)?.[0]?.cantidad ?? 0) || 0;
    const saldoPendiente = Math.max(0, Number(ledger.saldoPendiente ?? 0) || 0);

    if (saldoPendiente <= 0) {
      return new Response(JSON.stringify({ error: 'Esta transacción ya no tiene saldo pendiente' }), { status: 400 });
    }

    // 2) Validar abono mínimo según si la transacción tiene promo (basado en BD)
    if (kind === 'abono') {
      if (amount == null || !Number.isFinite(amount)) {
        return new Response(JSON.stringify({ error: 'amount requerido para abono' }), { status: 400 });
      }

      if (amount <= 0) {
        return new Response(JSON.stringify({ error: 'amount inválido' }), { status: 400 });
      }

      if (amount > saldoPendiente) {
        return new Response(JSON.stringify({ error: `El abono no puede superar el saldo pendiente: ${saldoPendiente}` }), { status: 400 });
      }

      const promoFlag = await db
        .select({ isPromo: sql<number>`max(case when ${numerosRifa.tipoPrecio} != 'normal' then 1 else 0 end)` })
        .from(numerosRifa)
        .where(eq(numerosRifa.transactionNumber, transactionNumber));

      const isPromo = Number(promoFlag?.[0]?.isPromo ?? 0) === 1;
      const minBase = inferMinAbono(isPromo, cantidad);
      const creditedPrev = (Number(ledger.abonoLedgerTotal ?? 0) || 0) + (Number(ledger.pagoLedgerTotal ?? 0) || 0);
      const minAdditional = isPromo ? Math.max(0, 20000 - creditedPrev) : minBase;

      if (amount + 0.000001 < minAdditional) {
        return new Response(JSON.stringify({ error: `Abono mínimo adicional: ${Math.trunc(minAdditional)}` }), { status: 400 });
      }
    }

    // 3) Upload a Cloudinary
    const buffer = Buffer.from(await file.arrayBuffer());
    const folder = `sistema-rifas/comprobantes/${transactionNumber}`;
    const uploaded = await uploadBufferToCloudinary(buffer, folder);

    // 4) Registrar en BD
    const amountToStore = kind === 'pago' ? Math.trunc(saldoPendiente) : (amount == null ? null : Math.trunc(amount));
    await db.insert(transactionProofs).values({
      transactionNumber,
      kind,
      amount: amountToStore,
      cloudinaryPublicId: uploaded.publicId,
      cloudinaryUrl: uploaded.secureUrl,
      createdAt: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ success: true, proofUrl: uploaded.secureUrl, url: uploaded.secureUrl }),
      {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error upload-transaction-proof:', error);
    return new Response(JSON.stringify({ error: 'Error subiendo comprobante' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
