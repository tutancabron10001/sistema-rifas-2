import { db } from '../../db/client';
import { numerosRifa, events, usuarios, transactionProofs } from '../../db/schema';
import { and, eq, like, inArray, sql } from 'drizzle-orm';
import { releaseExpiredReservations } from '../../lib/release-expired-reservations';
import { ensureTransactionProofsTable } from '../../lib/transaction-proofs';
import { getTxLedgerSummary } from '../../lib/tx-ledger';

export async function GET({ url }: any) {
  try {
    await ensureTransactionProofsTable();

    const campaignIdParam = url.searchParams.get('campaignId');
    const eventNameParam = url.searchParams.get('eventName');

    // Best-effort: free expired reserved numbers so admin views stay current.
    try {
      if (campaignIdParam) {
        // If campaign is filtered, release per events in that campaign.
        const eventsInCampaign = await db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.campaignId, parseInt(campaignIdParam)));
        for (const ev of eventsInCampaign) {
          await releaseExpiredReservations({ eventId: ev.id });
        }
      } else {
        await releaseExpiredReservations();
      }
    } catch (e) {
      console.warn('Auto-release skipped:', e);
    }

    const filters: any[] = [inArray(numerosRifa.estado, ['reservado', 'abonada', 'pago', 'pago_gracia'])];

    // Filtrar por campaña
    if (campaignIdParam) {
      const eventsInCampaign = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.campaignId, parseInt(campaignIdParam)));
      const eventIds = eventsInCampaign.map(e => e.id);
      if (eventIds.length > 0) {
        filters.push(inArray(numerosRifa.eventId, eventIds));
      }
    }

    // Filtrar por evento (nombre)
    if (eventNameParam) {
      const matchingEvents = await db
        .select({ id: events.id })
        .from(events)
        .where(like(events.name, `%${eventNameParam}%`));
      const eventIds = matchingEvents.map(e => e.id);
      if (eventIds.length > 0) {
        filters.push(inArray(numerosRifa.eventId, eventIds));
      } else {
        return new Response(
          JSON.stringify({ movimientos: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const rows = await db
      .select({
        eventName: events.name,
        numero: numerosRifa.numero,
        estado: numerosRifa.estado,
        tipoPrecio: numerosRifa.tipoPrecio,
        precioSeleccionado: numerosRifa.precioSeleccionado,
        abonado: numerosRifa.abonado,
        cedula: numerosRifa.numeroIdentificacion,
        transactionNumber: numerosRifa.transactionNumber,
        reservedAt: numerosRifa.reservedAt,
        proofUrl: sql`(SELECT cloudinary_url FROM transaction_proofs WHERE transaction_number = ${numerosRifa.transactionNumber} ORDER BY created_at DESC LIMIT 1)`,
        proofKind: sql`(SELECT kind FROM transaction_proofs WHERE transaction_number = ${numerosRifa.transactionNumber} ORDER BY created_at DESC LIMIT 1)`,
        usuarioNombre: sql<string>`trim(${usuarios.primerNombre} || ' ' || coalesce(${usuarios.segundoNombre}, '') || ' ' || ${usuarios.primerApellido} || ' ' || ${usuarios.segundoApellido})`,
        usuarioCorreo: usuarios.correoElectronico,
        usuarioTelefono: usuarios.telefono,
        createdAt: numerosRifa.createdAt,
      })
      .from(numerosRifa)
      .leftJoin(events, eq(events.id, numerosRifa.eventId))
      .leftJoin(usuarios, eq(usuarios.cedula, numerosRifa.numeroIdentificacion))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(numerosRifa.createdAt);

    const txNumbers = Array.from(
      new Set(
        rows
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
        .where(inArray(transactionProofs.transactionNumber, txNumbers));

      for (const p of proofs) {
        const key = String(p.transactionNumber);
        const arr = proofsByTx.get(key) ?? [];
        arr.push(p);
        proofsByTx.set(key, arr);
      }

      // Sort proofs newest-first per tx
      for (const [k, arr] of proofsByTx.entries()) {
        arr.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        proofsByTx.set(k, arr);
      }
    }

    const enriched = rows.map((r: any) => {
      const txNum = String(r?.transactionNumber ?? '').trim();
      const proofs = txNum ? (proofsByTx.get(txNum) ?? []) : [];
      return {
        ...r,
        proofs,
        proofCount: proofs.length,
      };
    });

    // Add ledger summaries per transaction
    const txNumbers_unique = Array.from(
      new Set(enriched.map((r: any) => String(r?.transactionNumber ?? '').trim()).filter((t: string) => t))
    );
    
    const ledgerByTx = new Map<string, any>();
    for (const txNum of txNumbers_unique) {
      const ledger = await getTxLedgerSummary(txNum);
      ledgerByTx.set(txNum, ledger);
    }

    const enriched_with_ledger = enriched.map((r: any) => {
      const txNum = String(r?.transactionNumber ?? '').trim();
      const ledger = txNum ? (ledgerByTx.get(txNum) ?? null) : null;
      return {
        ...r,
        ledger,
      };
    });

    return new Response(
      JSON.stringify({ movimientos: enriched_with_ledger }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching reservados-pagos:', error);
    return new Response(
      JSON.stringify({ error: 'Error al consultar' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
