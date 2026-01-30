import type { APIRoute } from 'astro';
import { db } from '../../db/client';
import { numerosRifa, transactions, usuarios, events, campaigns, transactionMovements, transactionProofs } from '../../db/schema';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { queueEmailOnce } from '../../lib/email-outbox';
import { releaseExpiredReservations } from '../../lib/release-expired-reservations';
import { ensureTransactionMovementsTable } from '../../lib/transaction-movements';
import { getTxLedgerSummary } from '../../lib/tx-ledger';
import { maybeStartPromoGraceWindow } from '../../lib/promo-grace';
import { ensureTransactionProofsTable } from '../../lib/transaction-proofs';

type AllocationItem = {
  numero: string;
  tipoPrecio: string;
  precioTotal: number;
  abonoPrevio: number;
  abonoAplicado: number;
  abonoNuevo: number;
  saldoPendiente: number;
  estadoFinal: string;
};

function toIntPesos(n: number) {
  const v = Math.floor(Number(n) || 0);
  return Number.isFinite(v) ? v : 0;
}

function isPaidEstado(estado: unknown) {
  const s = String(estado || '').toLowerCase();
  return s === 'pago' || s === 'pago_gracia';
}

function sumAbonos(movs: Array<{ kind: string; amount: number }>) {
  return movs.reduce((s, m) => (String(m?.kind || '').toLowerCase() === 'abono' ? s + (Number(m.amount) || 0) : s), 0);
}

async function loadMovimientosForEmail(params: {
  transactionNumber: string;
  neededAbonosAmount?: number;
}) {
  const transactionNumber = String(params.transactionNumber || '').trim();
  const neededAbonosAmount = Number(params.neededAbonosAmount ?? 0) || 0;

  let movimientos: Array<{ kind: string; amount: number; createdAt: string; url?: string }> = [];
  try {
    await ensureTransactionMovementsTable();
    const rows = await db
      .select({
        kind: transactionMovements.kind,
        amount: transactionMovements.amount,
        createdAt: transactionMovements.createdAt,
      })
      .from(transactionMovements)
      .where(eq(transactionMovements.transactionNumber, transactionNumber))
      .orderBy(desc(transactionMovements.createdAt));
    movimientos = (rows || []).map((p: any) => ({
      kind: String(p.kind || ''),
      amount: Number(p.amount ?? 0) || 0,
      createdAt: String(p.createdAt || ''),
    }));
  } catch (e) {
    console.warn('No se pudieron cargar movimientos (transaction_movements):', e);
  }

  // Backfill for older transactions (before transaction_movements existed):
  // derive validated abonos from proofs that have been already applied to numbers.
  if (neededAbonosAmount > 0) {
    const sumCurrent = sumAbonos(movimientos);
    if (sumCurrent + 0.5 < neededAbonosAmount) {
      try {
        const proofs = await db
          .select({
            amount: transactionProofs.amount,
            createdAt: transactionProofs.createdAt,
          })
          .from(transactionProofs)
          .where(and(eq(transactionProofs.transactionNumber, transactionNumber), eq(transactionProofs.kind, 'abono')))
          .orderBy(asc(transactionProofs.createdAt));

        const valid: Array<{ kind: string; amount: number; createdAt: string }> = [];
        let acc = 0;
        for (const p of proofs || []) {
          const amt = Math.trunc(Number((p as any)?.amount ?? 0) || 0);
          if (amt <= 0) continue;
          if (acc + amt <= neededAbonosAmount + 0.5) {
            acc += amt;
            valid.push({ kind: 'abono', amount: amt, createdAt: String((p as any)?.createdAt || '') });
          }
          if (acc + 0.5 >= neededAbonosAmount) break;
        }

        if (valid.length > 0 && sumAbonos(valid as any) + 0.5 >= sumCurrent) {
          const pagos = movimientos.filter((m) => String(m?.kind || '').toLowerCase() !== 'abono');
          movimientos = [...pagos, ...valid];
        }
      } catch (e) {
        console.warn('No se pudieron backfillear abonos desde proofs:', e);
      }
    }
  }

  return movimientos;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const transactionNumber = String(body?.transactionNumber || '').trim();
    const amount = Number(body?.amount);
    const proofId = Math.trunc(Number(body?.proofId ?? 0) || 0);

    // Ensure new columns exist (status/rejected_at/etc)
    try {
      await ensureTransactionProofsTable();
    } catch (e) {
      console.warn('ensureTransactionProofsTable skipped:', e);
    }

    if (!transactionNumber) {
      return new Response(JSON.stringify({ success: false, error: 'transactionNumber requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return new Response(JSON.stringify({ success: false, error: 'amount inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tx = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionNumber, transactionNumber))
      .get();

    if (!tx) {
      return new Response(JSON.stringify({ success: false, error: 'Transacción no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Consistency rule: release expired reservations before any state changes.
    try {
      await releaseExpiredReservations({ eventId: tx.eventId });
    } catch (e) {
      console.warn('Auto-release skipped:', e);
    }

    const rows = await db
      .select()
      .from(numerosRifa)
      .where(
        and(eq(numerosRifa.transactionNumber, transactionNumber), eq(numerosRifa.eventId, tx.eventId))
      )
      .all();

    if (!rows.length) {
      return new Response(JSON.stringify({ success: false, error: 'No hay números asociados a la transacción' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }


    // Admin rule: abonos are recorded ONLY at transaction level (transaction_movements).
    // We no longer distribute or update numeros_rifa.abonado per boleta.
    const ledgerBefore = await getTxLedgerSummary(transactionNumber);
    const saldoTxBefore = Math.max(0, toIntPesos(ledgerBefore?.saldoPendiente ?? 0));
    const abonoAmount = Math.max(0, toIntPesos(amount));

    if (abonoAmount > saldoTxBefore) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'El abono supera el saldo pendiente de la transacción',
          saldoPendiente: saldoTxBefore,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Registrar movimiento validado por admin (abono)
    console.log(`[mark-abono] Intentando registrar movimiento - TX: ${transactionNumber}, Monto: ${abonoAmount}`);
    try {
      await ensureTransactionMovementsTable();
      const result = await db.insert(transactionMovements).values({
        transactionNumber,
        kind: 'abono',
        amount: abonoAmount,
        createdAt: new Date().toISOString(),
      });
      console.log(`[mark-abono] ✅ Movimiento registrado exitosamente - TX: ${transactionNumber}`, result);
    } catch (e) {
      console.error(`[mark-abono] ❌ Error crítico al registrar transaction_movements - TX: ${transactionNumber}`, e);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Error al registrar el movimiento en la base de datos',
          details: e instanceof Error ? e.message : String(e)
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Regla de negocio: la ventana de gracia promo inicia cuando el admin valida dinero (movimiento).
    try {
      await maybeStartPromoGraceWindow({ transactionNumber, eventId: tx.eventId });
    } catch (e) {
      console.warn('No se pudo iniciar ventana promo (abono):', e);
    }

    // Persist proof status (optional): if admin validated using a specific proof, mark it as validated.
    if (proofId > 0) {
      try {
        const p = await db
          .select({ id: transactionProofs.id, transactionNumber: transactionProofs.transactionNumber, status: transactionProofs.status })
          .from(transactionProofs)
          .where(eq(transactionProofs.id, proofId))
          .limit(1)
          .then((r) => (r.length ? r[0] : null));

        if (p && String((p as any).transactionNumber || '') === transactionNumber) {
          const st = String((p as any).status || 'pending').toLowerCase();
          if (st !== 'rejected') {
            await db
              .update(transactionProofs)
              .set({ status: 'validated' })
              .where(eq(transactionProofs.id, proofId));
          }
        }
      } catch (e) {
        console.warn('No se pudo marcar proof como validated (abono):', e);
      }
    }

    const ledgerAfter = await getTxLedgerSummary(transactionNumber);
    const totalPrecioTx = Math.max(0, toIntPesos(ledgerAfter?.totalPrice ?? 0));
    const totalAbonadoTx = Math.max(0, toIntPesos(ledgerAfter?.abonoLedgerTotal ?? 0));
    const saldoPendienteTx = Math.max(0, toIntPesos(ledgerAfter?.saldoPendiente ?? 0));
    const txBecamePaid = totalPrecioTx > 0 && saldoPendienteTx <= 0;

    // Para decidir ABONADA vs RESERVADA en promo, usamos SOLO dinero VALIDADO en movements.
    let creditedByMovements = 0;
    try {
      const ledgerMov = await getTxLedgerSummary(transactionNumber, { includePaidRowsCredit: false });
      creditedByMovements =
        (Number(ledgerMov?.abonoLedgerTotal ?? 0) || 0) + (Number(ledgerMov?.pagoLedgerTotal ?? 0) || 0);
    } catch (e) {
      console.warn('No se pudo calcular creditedByMovements:', e);
      creditedByMovements = 0;
    }

    const hasPromoNumbers = rows.some((r: any) => String(r?.tipoPrecio || '').toLowerCase() === 'promocion');
    const promoLike =
      hasPromoNumbers || (Number((tx as any)?.promociones ?? 0) || 0) > 0 || Boolean((tx as any)?.promoExpiresAt);
    const promoMinMet = creditedByMovements + 0.5 >= 20000;

    // Para promo: una boleta no pasa a ABONADA hasta cumplir el mínimo (20.000) validado en movements.
    // Para no-promo: mantenemos el comportamiento previo (cualquier dinero validado evita auto-release).
    const lockReservationsNow = !promoLike || promoMinMet || txBecamePaid;
    if (lockReservationsNow) {
      await db
        .update(numerosRifa)
        .set({ reservedAt: null })
        .where(and(eq(numerosRifa.transactionNumber, transactionNumber), eq(numerosRifa.eventId, tx.eventId)))
        .run();
    }

    // Si NO está totalmente pagada:
    // - Promo: solo promover reservadas->abonadas cuando se cumple mínimo.
    // - No-promo: promover reservadas->abonadas como señal de abono validado.
    if (!txBecamePaid && (!promoLike || promoMinMet)) {
      await db
        .update(numerosRifa)
        .set({ estado: 'abonada', reservedAt: null })
        .where(
          and(
            eq(numerosRifa.transactionNumber, transactionNumber),
            eq(numerosRifa.eventId, tx.eventId),
            inArray(numerosRifa.estado, ['reservado'])
          )
        )
        .run();
    }

    // If fully covered by ledger, force all numbers to PAGO (idempotent)
    if (txBecamePaid) {
      await db
        .update(numerosRifa)
        .set({ estado: 'pago', promoHold: 0 })
        .where(and(eq(numerosRifa.transactionNumber, transactionNumber), eq(numerosRifa.eventId, tx.eventId)))
        .run();
    }

    const rowsFinal = await db
      .select()
      .from(numerosRifa)
      .where(and(eq(numerosRifa.transactionNumber, transactionNumber), eq(numerosRifa.eventId, tx.eventId)))
      .all();

    const items: AllocationItem[] = rowsFinal
      .slice()
      .sort((a, b) => String(a.numero || '').localeCompare(String(b.numero || '')))
      .map((r) => {
        const promoPrice = Number(r.precioSeleccionado || 0) || 0;
        const saldoPromo = Math.max(0, promoPrice);
        return {
          numero: String(r.numero),
          tipoPrecio: String(r.tipoPrecio || 'normal'),
          // Importante: siempre mostrar precio/saldo con el precio REAL (promo)
          precioTotal: promoPrice,
          abonoPrevio: 0,
          abonoAplicado: 0,
          abonoNuevo: 0,
          saldoPendiente: saldoPromo,
          estadoFinal: String(r.estado || ''),
        };
      });

    // Encolar correo
    // - Si el abono COMPLETA el pago de la transacción: enviar correo estándar de PAGO.
    // - Si NO completa: enviar correo de ABONO (sin valores por boleta; solo estados).
    try {
      const usuarioData = await db
        .select()
        .from(usuarios)
        .where(eq(usuarios.cedula, tx.usuarioCedula))
        .get();

      if (usuarioData?.correoElectronico) {
        const nombreCompleto = `${usuarioData.primerNombre} ${usuarioData.segundoNombre || ''} ${usuarioData.primerApellido} ${usuarioData.segundoApellido}`
          .trim()
          .replace(/\s+/g, ' ');

        if (txBecamePaid) {
          const evento = await db.select().from(events).where(eq(events.id, tx.eventId)).limit(1);
          const campaign = evento.length > 0
            ? await db.select().from(campaigns).where(eq(campaigns.id, evento[0].campaignId)).limit(1)
            : [];

          const numerosPagados = rowsFinal
            .slice()
            .sort((a, b) => String(a.numero || '').localeCompare(String(b.numero || '')))
            .map((r) => ({
              numero: Number(r.numero),
              tipoPrecio: r.tipoPrecio || 'normal',
              precioSeleccionado: Number(r.precioSeleccionado || 0),
              abonado: 0,
            }));

          const fechaPago = new Date().toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          const fechaRifa = evento.length > 0
            ? new Date((evento[0] as any).raffleDate).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
            : '';

          const totalPrecio = totalPrecioTx;
          const totalAbonado = totalAbonadoTx;
          const totalPagado = Math.max(0, totalPrecio - totalAbonado);

          // Histórico (PAGO): movimientos validados por admin + backfill de abonos antiguos (ya aplicados)
          const movimientos = await loadMovimientosForEmail({
            transactionNumber,
            neededAbonosAmount: Math.max(0, Math.trunc(Number(totalAbonado) || 0)),
          });

          await queueEmailOnce('pago', {
            to: usuarioData.correoElectronico,
            nombreCompleto,
            cedula: usuarioData.cedula,
            transactionNumber,
            campaignName: campaign.length > 0 ? campaign[0].name : tx.campaignName,
            eventId: tx.eventId,
            eventName: tx.eventName,
            numerosPagados,
            totalPrecio,
            totalAbonado,
            totalPagado,
            fechaPago,
            fechaRifa,
            movimientos,
          }, { transactionNumber });
        } else {
          // Histórico (ABONO): solo abonos validados + backfill de abonos antiguos (ya aplicados)
          let movimientos = await loadMovimientosForEmail({
            transactionNumber,
            neededAbonosAmount: Math.max(0, Math.trunc(Number(totalAbonadoTx) || 0)),
          });
          movimientos = movimientos.filter((m: any) => String(m?.kind || '').toLowerCase() === 'abono');

          await queueEmailOnce('abono', {
            usuarioNombre: nombreCompleto,
            usuarioCorreo: usuarioData.correoElectronico,
            transactionNumber,
            campaignName: tx.campaignName,
            eventName: tx.eventName,
            montoAbono: amount,
            totalPrecioTx,
            totalAbonadoTx,
            saldoPendienteTx: Math.max(0, saldoPendienteTx),
            items,
            movimientos,
          }, { transactionNumber });
        }
      }
    } catch (e) {
      console.error('Error encolando correo de abono por transacción:', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        transactionNumber,
        amountApplied: abonoAmount,
        affectedNumbers: rowsFinal.length,
        becamePaid: txBecamePaid ? rowsFinal.length : 0,
        saldoPendienteBefore: saldoTxBefore,
        saldoPendienteAfter: Math.max(0, saldoPendienteTx),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('ERROR en mark-abono-transaction:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
