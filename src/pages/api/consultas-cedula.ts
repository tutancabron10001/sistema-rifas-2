import { db } from '../../db/client';
import { transactions, numerosRifa, events, usuarios, transactionProofs } from '../../db/schema';
import { and, eq, desc, like, sql, inArray } from 'drizzle-orm';
import { ensureTransactionProofsTable } from '../../lib/transaction-proofs';
import { finalizePromoGracePayments } from '../../lib/finalize-promo-grace-payments';

export async function GET({ request }: any) {
  try {
    // Consistency hook: grace window state transitions (cronless)
    try {
      await finalizePromoGracePayments();
    } catch (e) {
      console.warn('Promo grace finalize skipped:', e);
    }

    await ensureTransactionProofsTable();

    const url = new URL(request.url);
    const cedula = url.searchParams.get('cedula');
    const campaignFilter = url.searchParams.get('campaignId');
    const eventNameFilter = url.searchParams.get('eventName');
    const txFilter = url.searchParams.get('transactionNumber');

    // Al menos un filtro requerido
    if (!cedula && !eventNameFilter && !txFilter && !campaignFilter) {
      return new Response(
        JSON.stringify({ error: 'Ingresa cédula, evento, transacción o campaña para consultar' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const filters: any[] = [inArray(numerosRifa.estado, ['reservado', 'abonada', 'pago_gracia'])];
    if (cedula) filters.push(eq(transactions.usuarioCedula, cedula));
    if (campaignFilter) filters.push(eq(events.campaignId, parseInt(campaignFilter)));
    if (eventNameFilter) filters.push(like(events.name, `%${eventNameFilter}%`));
    if (txFilter) filters.push(eq(transactions.transactionNumber, txFilter));

    const rows = await db
      .select({
        transactionNumber: transactions.transactionNumber,
        proofUrl: sql`(SELECT cloudinary_url FROM transaction_proofs WHERE transaction_number = ${transactions.transactionNumber} ORDER BY created_at DESC LIMIT 1)`,
        proofKind: sql`(SELECT kind FROM transaction_proofs WHERE transaction_number = ${transactions.transactionNumber} ORDER BY created_at DESC LIMIT 1)`,
        fechaTransaccion: transactions.createdAt,
        usuarioNombre: sql`coalesce(${transactions.usuarioNombre}, ${usuarios.primerNombre} || ' ' || ${usuarios.primerApellido})`,
        usuarioCorreo: usuarios.correoElectronico,
        usuarioTelefono: usuarios.telefono,
        campaignName: transactions.campaignName,
        eventId: transactions.eventId,
        eventName: events.name,
        numero: numerosRifa.numero,
        estado: numerosRifa.estado,
        precioSeleccionado: numerosRifa.precioSeleccionado,
        precioNormal: events.price,
        tipoPrecio: numerosRifa.tipoPrecio,
        abonado: numerosRifa.abonado,
        raffleDate: events.raffleDate,
      })
      .from(transactions)
      .leftJoin(numerosRifa, eq(numerosRifa.transactionNumber, transactions.transactionNumber))
      .leftJoin(events, eq(events.id, transactions.eventId))
      .leftJoin(usuarios, eq(usuarios.cedula, transactions.usuarioCedula))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(transactions.createdAt));

    // Fallback: if no transactionNumber, still attempt to match by numeroIdentificacion
    let extraRows: any[] = [];
    if (rows.length === 0 && cedula) {
      extraRows = await db
        .select({
          transactionNumber: numerosRifa.transactionNumber,
          proofUrl: sql`(SELECT cloudinary_url FROM transaction_proofs WHERE transaction_number = ${numerosRifa.transactionNumber} ORDER BY created_at DESC LIMIT 1)`,
          proofKind: sql`(SELECT kind FROM transaction_proofs WHERE transaction_number = ${numerosRifa.transactionNumber} ORDER BY created_at DESC LIMIT 1)`,
          fechaTransaccion: numerosRifa.createdAt,
          usuarioNombre: sql`${usuarios.primerNombre} || ' ' || ${usuarios.primerApellido}`,
          usuarioCorreo: usuarios.correoElectronico,
          usuarioTelefono: usuarios.telefono,
          campaignName: sql`''`,
          eventId: numerosRifa.eventId,
          eventName: events.name,
          numero: numerosRifa.numero,
          estado: numerosRifa.estado,
          precioSeleccionado: numerosRifa.precioSeleccionado,
          precioNormal: events.price,
          tipoPrecio: numerosRifa.tipoPrecio,
          abonado: numerosRifa.abonado,
          raffleDate: events.raffleDate,
        })
        .from(numerosRifa)
        .leftJoin(events, eq(events.id, numerosRifa.eventId))
        .leftJoin(usuarios, eq(usuarios.cedula, numerosRifa.numeroIdentificacion))
        .where(and(
          eq(numerosRifa.numeroIdentificacion, cedula),
          inArray(numerosRifa.estado, ['reservado', 'abonada', 'pago_gracia'])
        ))
        .orderBy(desc(numerosRifa.createdAt));
    }

    const result = rows.length > 0 ? rows : extraRows;

    const txNumbers = Array.from(
      new Set(
        result
          .map((r: any) => String(r?.transactionNumber ?? '').trim())
          .filter((t: string) => t)
      )
    );

    let proofsByTx = new Map<string, any[]>();
    if (txNumbers.length > 0) {
      const proofs = await db
        .select({
          transactionNumber: transactionProofs.transactionNumber,
          kind: transactionProofs.kind,
          amount: transactionProofs.amount,
          url: transactionProofs.cloudinaryUrl,
          createdAt: transactionProofs.createdAt,
        })
        .from(transactionProofs)
        .where(inArray(transactionProofs.transactionNumber, txNumbers))
        .orderBy(desc(transactionProofs.createdAt));

      for (const p of proofs) {
        const key = String(p.transactionNumber);
        const arr = proofsByTx.get(key) ?? [];
        arr.push(p);
        proofsByTx.set(key, arr);
      }
    }

    const enriched = result.map((r: any) => {
      const txNum = String(r?.transactionNumber ?? '').trim();
      const proofs = txNum ? (proofsByTx.get(txNum) ?? []) : [];
      return {
        ...r,
        proofs,
        proofCount: proofs.length,
      };
    });

    return new Response(JSON.stringify({ movimientos: enriched }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error en consultas-cedula:', error);
    return new Response(
      JSON.stringify({ error: 'Error interno' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
