import type { APIRoute } from 'astro';
import { db } from '../../db/client';
import { numerosRifa, transactions, usuarios, events, campaigns, transactionMovements, transactionProofs } from '../../db/schema';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { queueEmailOnce } from '../../lib/email-outbox';
import { releaseExpiredReservations } from '../../lib/release-expired-reservations';
import { ensureTransactionMovementsTable } from '../../lib/transaction-movements';
import { getTxLedgerSummary } from '../../lib/tx-ledger';
import { maybeStartPromoGraceWindow } from '../../lib/promo-grace';
import { ensureTransactionProofsTable } from '../../lib/transaction-proofs';

function sumAbonos(movs: Array<{ kind: string; amount: number }>) {
  return movs.reduce((s, m) => (String(m?.kind || '').toLowerCase() === 'abono' ? s + (Number(m.amount) || 0) : s), 0);
}

async function loadMovimientosForEmail(params: { transactionNumber: string; neededAbonosAmount?: number }) {
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
  // infer validated abonos from proofs already applied (bounded by current applied total).
  if (neededAbonosAmount > 0) {
    const sumCurrent = sumAbonos(movimientos as any);
    if (sumCurrent + 0.5 < neededAbonosAmount) {
      try {
        const proofs = await db
          .select({ amount: transactionProofs.amount, createdAt: transactionProofs.createdAt })
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

        if (valid.length > 0) {
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

function isPromoGraceActive(tx: any, nowMs: number) {
  const expiresAt = String(tx?.promoExpiresAt ?? '').trim();
  if (!expiresAt) return false;
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return false;
  // Only meaningful when the transaction is still not a full pack.
  const cantidad = Number(tx?.cantidad ?? 0) || 0;
  return expiresMs > nowMs && (cantidad % 3) !== 0;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { numeros } = body || {};
    const forcePago = Boolean(body?.forcePago);
    const proofId = Math.trunc(Number(body?.proofId ?? 0) || 0);
    console.log('API mark-payment-numbers - Datos recibidos:', { numeros, forcePago });

    // Ensure new columns exist (status/rejected_at/etc)
    try {
      await ensureTransactionProofsTable();
    } catch (e) {
      console.warn('ensureTransactionProofsTable skipped:', e);
    }
    
    if (!numeros || !Array.isArray(numeros) || numeros.length === 0) {
      console.log('Error: Números no proporcionados o inválidos');
      return new Response(JSON.stringify({ error: 'Números no proporcionados' }), { status: 400 });
    }

    // Consistency rule: release expired reservations before any state changes.
    try {
      const eventIds = Array.from(
        new Set(
          numeros
            .map((n: any) => parseInt(n?.eventId, 10))
            .filter((id: number) => Number.isFinite(id) && id > 0)
        )
      );
      for (const id of eventIds) {
        await releaseExpiredReservations({ eventId: id });
      }
    } catch (e) {
      console.warn('Auto-release skipped:', e);
    }

    let count = 0;
    const numerosPagados: Array<{ numero: number; tipoPrecio: string; precioSeleccionado: number; abonado?: number }> = [];
    let transactionNumber = '';
    let eventId = 0;
    let cedula = '';
    let usedGraceState = false;
		const txCache = new Map<string, any>();
		const nowMs = Date.now();
		let ledgerBefore: Awaited<ReturnType<typeof getTxLedgerSummary>> | null = null;
		let paymentNeeded = 0;
    
    // Actualizar cada número individualmente y recopilar datos
    for (const item of numeros) {
      const numeroValue = item.numero; // Mantener como string
      const eventIdValue = parseInt(item.eventId, 10);
      
      console.log(`Procesando número ${numeroValue}, eventId ${eventIdValue}`);
      
      if (!numeroValue || !eventIdValue) continue;
      
      // Obtener info del número antes de actualizar (puede estar reservado o abonada)
      const numData = await db.select()
        .from(numerosRifa)
        .where(
          and(
            eq(numerosRifa.numero, numeroValue),
            eq(numerosRifa.eventId, eventIdValue)
          )
        )
        .limit(1);
      
      console.log(`Datos encontrados para número ${numeroValue}:`, numData);
      
      if (numData.length > 0) {
        const numRow = numData[0];
        // Solo procesar si está reservado o abonada
        if (numRow.estado === 'reservado' || numRow.estado === 'abonada' || numRow.estado === 'pago_gracia') {
          numerosPagados.push({
            numero: Number(numRow.numero),
            tipoPrecio: numRow.tipoPrecio || 'normal',
            precioSeleccionado: numRow.precioSeleccionado || 0,
            abonado: numRow.abonado || 0
          });
          
          // Guardar datos de la transacción del primer número
          if (count === 0) {
            transactionNumber = numRow.transactionNumber || '';
            eventId = eventIdValue;

				// Capture ledger totals BEFORE we mutate number states, so we can record the correct remaining payment.
				if (transactionNumber) {
					ledgerBefore = await getTxLedgerSummary(transactionNumber);
					paymentNeeded = Math.max(0, Math.trunc(Number(ledgerBefore?.saldoPendiente ?? 0) || 0));
				}
          }

        // Determine whether this transaction is in promo grace.
        let tx: any = null;
        if (numRow.transactionNumber) {
          const key = String(numRow.transactionNumber);
          tx = txCache.get(key);
          if (!tx) {
            const rows = await db
              .select({
                transactionNumber: transactions.transactionNumber,
                promoExpiresAt: transactions.promoExpiresAt,
                cantidad: transactions.cantidad,
              })
              .from(transactions)
              .where(eq(transactions.transactionNumber, key))
              .limit(1);
            tx = rows.length > 0 ? rows[0] : null;
            txCache.set(key, tx);
          }
        }

      const nextEstado = forcePago
        ? 'pago'
        : (tx && isPromoGraceActive(tx, nowMs) ? 'pago_gracia' : 'pago');
      if (nextEstado === 'pago_gracia') usedGraceState = true;
          
          // Actualizar a pago (funciona para reservado y abonada)
          await db.update(numerosRifa)
            .set({
              estado: nextEstado,
              reservedAt: null,
              promoHold: 0,
              // Preserve/derive cash paid for this number (excluding any abono already recorded).
              // - If paid_amount already exists (e.g., 25k paid before promo repricing), keep it.
              // - Otherwise, set it to the remaining cash needed: max(0, precioSeleccionado - abonado).
              paidAmount: sql`
                coalesce(
                  ${numerosRifa.paidAmount},
                  case
                    when coalesce(${numerosRifa.precioSeleccionado},0) > coalesce(${numerosRifa.abonado},0)
                      then (coalesce(${numerosRifa.precioSeleccionado},0) - coalesce(${numerosRifa.abonado},0))
                    else 0
                  end
                )
              ` as any,
            })
            .where(
              and(
                eq(numerosRifa.numero, numeroValue),
                eq(numerosRifa.eventId, eventIdValue)
              )
            );
          
          count++;
        }
      }
    }

    console.log(`${count} números actualizados a estado PAGO`);
    console.log('Números pagados:', numerosPagados);

    // Registrar movimiento validado por admin (pago) UNA sola vez por transacción.
    // Esto debe ocurrir incluso si el estado del número queda como pago_gracia.
    if (transactionNumber && paymentNeeded > 0) {
      console.log(`[mark-payment] Intentando registrar movimiento - TX: ${transactionNumber}, Monto: ${paymentNeeded}`);
      try {
        await ensureTransactionMovementsTable();
        const amtPago = Math.max(0, Math.trunc(Number(paymentNeeded) || 0));
        if (amtPago > 0) {
          const result = await db.insert(transactionMovements).values({
            transactionNumber,
            kind: 'pago',
            amount: amtPago,
            createdAt: new Date().toISOString(),
          });
          console.log(`[mark-payment] ✅ Movimiento registrado exitosamente - TX: ${transactionNumber}`, result);
        }
      } catch (e) {
        console.error(`[mark-payment] ❌ Error crítico al registrar transaction_movements - TX: ${transactionNumber}`, e);
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Error al registrar el movimiento de pago en la base de datos',
            details: e instanceof Error ? e.message : String(e)
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Ventana promo: inicia a partir de validación admin.
      try {
        await maybeStartPromoGraceWindow({ transactionNumber, eventId });
      } catch (e) {
        console.warn('No se pudo iniciar ventana promo (pago):', e);
      }
    }

    // Persist proof status (optional): if admin validated using a specific proof, mark it as validated.
    if (proofId > 0 && transactionNumber) {
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
        console.warn('No se pudo marcar proof como validated (pago):', e);
      }
    }

    // Si se marcó como pago_gracia (ventana promo), NO enviar correo de PAGO final.
    // Se convertirá automáticamente a PAGO al expirar.
    if (!usedGraceState && transactionNumber && numerosPagados.length > 0 && paymentNeeded > 0) {
      console.log('Preparando correo para transacción:', transactionNumber);
      
      const txData = await db.select().from(transactions).where(eq(transactions.transactionNumber, transactionNumber)).limit(1);
      console.log('Datos de transacción encontrados:', txData);
      
      if (txData.length > 0) {
        cedula = txData[0].usuarioCedula || '';
        const usuario = await db.select().from(usuarios).where(eq(usuarios.cedula, cedula)).limit(1);
        const evento = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
        const campaign = evento.length > 0 
          ? await db.select().from(campaigns).where(eq(campaigns.id, evento[0].campaignId)).limit(1)
          : [];

      console.log('Datos para correo:', { 
        usuarioEncontrado: usuario.length > 0, 
        eventoEncontrado: evento.length > 0,
        campaignEncontrada: campaign.length > 0,
        correo: usuario[0]?.correoElectronico 
      });

      if (usuario.length > 0 && evento.length > 0 && campaign.length > 0 && usuario[0].correoElectronico) {
        const nombreCompleto = `${usuario[0].primerNombre} ${usuario[0].segundoNombre || ''} ${usuario[0].primerApellido} ${usuario[0].segundoApellido}`.trim();
        // Admin accounting is ledger-based: do not rely on numeros_rifa.abonado.
        const ledgerForEmail = ledgerBefore ?? (transactionNumber ? await getTxLedgerSummary(transactionNumber) : null);
        const totalPrecio = Math.trunc(Number(ledgerForEmail?.totalPrice ?? 0) || 0);
        const totalAbonado = Math.trunc(Number(ledgerForEmail?.abonoLedgerTotal ?? 0) || 0);
        const totalPagado = Math.max(0, Math.trunc(Number(paymentNeeded) || 0));

        // Histórico: movimientos validados por admin + backfill (para transacciones antiguas)
        // Needed abonos amount is ledger-based.
        const totalAbonadoTxNow = Math.max(0, Math.trunc(Number(ledgerForEmail?.abonoLedgerTotal ?? 0) || 0));

        const movimientos = await loadMovimientosForEmail({
          transactionNumber,
          neededAbonosAmount: totalAbonadoTxNow,
        });
        
        const fechaPago = new Date().toLocaleString('es-CO', {
          timeZone: 'America/Bogota',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const fechaRifa = new Date(evento[0].raffleDate).toLocaleDateString('es-CO', { 
          day: 'numeric', 
          month: 'long', 
          year: 'numeric' 
        });

        console.log('Encolando correo a:', usuario[0].correoElectronico);

        try {
          await queueEmailOnce('pago', {
            to: usuario[0].correoElectronico,
            nombreCompleto,
            cedula: usuario[0].cedula,
            transactionNumber: transactionNumber,
            campaignName: campaign[0].name,
            eventId: evento[0].id,
            eventName: evento[0].name,
            numerosPagados,
            totalPrecio,
            totalAbonado,
            totalPagado,
            fechaPago,
            fechaRifa,
            movimientos,
          }, { transactionNumber });
        } catch (err) {
          console.error('Error encolando correo:', err);
        }
      } else {
        console.log('No se envió correo - datos incompletos');
      }
      } else {
        console.log('No se encontraron datos de transacción');
      }
    } else {
      console.log('No se envió correo - sin transacción o sin números pagados');
    }

    console.log('Respuesta exitosa, count:', count);
    return new Response(JSON.stringify({ success: true, count }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error completo en mark-payment-numbers:', error);
    return new Response(JSON.stringify({ error: 'Error al procesar la solicitud: ' + String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
