import type { APIRoute } from 'astro';
import { db } from '../../db/client';
import { numerosRifa, transactions, usuarios, events, transactionMovements, transactionProofs } from '../../db/schema';
import { asc, desc, eq, sql, and } from 'drizzle-orm';
import { queueEmailOnce } from '../../lib/email-outbox';
import { releaseExpiredReservations } from '../../lib/release-expired-reservations';
import { ensureTransactionMovementsTable } from '../../lib/transaction-movements';
import { maybeStartPromoGraceWindow } from '../../lib/promo-grace';

function sumAbonos(movs: Array<{ kind: string; amount: number }>) {
  return movs.reduce((s, m) => (String(m?.kind || '').toLowerCase() === 'abono' ? s + (Number(m.amount) || 0) : s), 0);
}

async function loadAbonosForEmail(params: { transactionNumber: string; neededAbonosAmount: number }) {
  const txNum = String(params.transactionNumber || '').trim();
  const needed = Math.max(0, Math.trunc(Number(params.neededAbonosAmount) || 0));

  let movimientos: Array<{ kind: string; amount: number; createdAt: string }> = [];
  try {
    await ensureTransactionMovementsTable();
    const rows = await db
      .select({
        kind: transactionMovements.kind,
        amount: transactionMovements.amount,
        createdAt: transactionMovements.createdAt,
      })
      .from(transactionMovements)
      .where(eq(transactionMovements.transactionNumber, txNum))
      .orderBy(desc(transactionMovements.createdAt));
    movimientos = (rows || []).map((p: any) => ({
      kind: String(p.kind || ''),
      amount: Number(p.amount ?? 0) || 0,
      createdAt: String(p.createdAt || ''),
    }));
  } catch (e) {
    console.warn('No se pudieron cargar movimientos (transaction_movements):', e);
  }

  movimientos = movimientos.filter((m) => String(m?.kind || '').toLowerCase() === 'abono');

  // Backfill from proofs when older validated abonos exist but no movement records were created.
  if (needed > 0) {
    const sumCurrent = sumAbonos(movimientos as any);
    if (sumCurrent + 0.5 < needed) {
      try {
        const proofs = await db
          .select({ amount: transactionProofs.amount, createdAt: transactionProofs.createdAt })
          .from(transactionProofs)
          .where(and(eq(transactionProofs.transactionNumber, txNum), eq(transactionProofs.kind, 'abono')))
          .orderBy(asc(transactionProofs.createdAt));

        const valid: Array<{ kind: string; amount: number; createdAt: string }> = [];
        let acc = 0;
        for (const p of proofs || []) {
          const amt = Math.trunc(Number((p as any)?.amount ?? 0) || 0);
          if (amt <= 0) continue;
          if (acc + amt <= needed + 0.5) {
            acc += amt;
            valid.push({ kind: 'abono', amount: amt, createdAt: String((p as any)?.createdAt || '') });
          }
          if (acc + 0.5 >= needed) break;
        }

        if (valid.length > 0 && sumAbonos(valid as any) + 0.5 >= sumCurrent) {
          movimientos = valid;
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
    // Admin rule update (Jan 2026): abonos are recorded only at transaction level via /api/mark-abono-transaction.
    // This endpoint previously distributed abonos per boleta (numeros_rifa.abonado), which is now deprecated.
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Abonos por boleta deshabilitados. Use "Abonar transacción" (transaction_movements).',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );

    // Legacy code below (kept temporarily).
    // eslint-disable-next-line @typescript-eslint/no-unreachable
    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-unreachable
    const { numeros } = body; // Array de { numero, eventId, abono }

    // eslint-disable-next-line @typescript-eslint/no-unreachable
    if (!numeros || !Array.isArray(numeros) || numeros.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-unreachable
      return new Response(JSON.stringify({ success: false, error: 'Datos inválidos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
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

    console.log('=== PROCESANDO ABONOS ===');
    console.log('Datos recibidos:', JSON.stringify(numeros, null, 2));

    const resultados = [];

    // Actualizar estado de números
    for (const item of numeros) {
      const numeroValue = item.numero;
      const eventId = parseInt(item.eventId);
      const montoAbono = parseFloat(item.abono) || 0;

      const eventRow = await db.select({ price: events.price }).from(events).where(eq(events.id, eventId)).get();
      const precioNormalEvento = Number(eventRow?.price ?? 0) || 0;

      console.log(`\n--- Procesando: Número ${numeroValue}, Event ${eventId}, Abono ${montoAbono} ---`);

      // Buscar el número en la base de datos
      const numerosData = await db
        .select()
        .from(numerosRifa)
        .where(eq(numerosRifa.numero, numeroValue))
        .all();

      console.log('Números encontrados:', numerosData.length);

      const numeroData = numerosData.find(n => n.eventId === eventId);

      if (!numeroData) {
        console.log(`ERROR: Número ${numeroValue} no encontrado para eventId ${eventId}`);
        continue;
      }

      console.log('Número encontrado:', { id: numeroData.id, numero: numeroData.numero, abonado: numeroData.abonado });

      const estadoActual = String(numeroData.estado || '').toLowerCase();
      const yaPagado = estadoActual === 'pago' || estadoActual === 'pago_gracia';
      if (yaPagado) {
        console.log(`Saltando abono: Número ${numeroValue} ya está en estado ${estadoActual}`);
        continue;
      }
      
      // No permitir que un abono exceda el saldo total pendiente de la transacción (precio promo)
      if (numeroData.transactionNumber) {
        const totals = await db
          .select({
            totalPrice: sql<number>`sum(${numerosRifa.precioSeleccionado})`,
            totalAbonado: sql<number>`sum(coalesce(${numerosRifa.abonado}, 0))`,
          })
          .from(numerosRifa)
          .where(eq(numerosRifa.transactionNumber, numeroData.transactionNumber));

        const totalPrice = Number(totals?.[0]?.totalPrice ?? 0) || 0;
        const totalAbonado = Number(totals?.[0]?.totalAbonado ?? 0) || 0;
        const saldoTx = Math.max(0, totalPrice - totalAbonado);

        if (montoAbono > saldoTx) {
          console.log(`ERROR: Abono excede saldo transacción. Abono=${montoAbono} saldoTx=${saldoTx}`);
          continue;
        }
      }

      const nuevoAbono = (numeroData.abonado || 0) + montoAbono;

      const isPromo = String(numeroData.tipoPrecio || '').toLowerCase() === 'promocion';
      const promoPrice = Number(numeroData.precioSeleccionado || 0);
      const normalThreshold = isPromo && precioNormalEvento > 0 ? precioNormalEvento : promoPrice;
      const estadoFinal = isPromo
        ? (nuevoAbono >= normalThreshold ? 'pago' : 'abonada')
        : (nuevoAbono >= promoPrice ? 'pago' : 'abonada');
      
      // Actualizar en la base de datos
      await db
        .update(numerosRifa)
        .set({ 
          estado: estadoFinal,
          abonado: nuevoAbono,
          reservedAt: null,
        })
        .where(eq(numerosRifa.id, numeroData.id))
        .run();

      console.log(`Número ${numeroValue} actualizado. Nuevo abono total: ${nuevoAbono}`);
      resultados.push({ numero: numeroValue, abono: nuevoAbono });

      // Si con este abono se cubrió el total de la transacción (precio promo), marcar toda la transacción como PAGO
      if (numeroData.transactionNumber) {
        try {
          const totalsAfter = await db
            .select({
              totalPrice: sql<number>`sum(${numerosRifa.precioSeleccionado})`,
              totalAbonado: sql<number>`sum(coalesce(${numerosRifa.abonado}, 0))`,
            })
            .from(numerosRifa)
            .where(eq(numerosRifa.transactionNumber, numeroData.transactionNumber));

          const totalPriceAfter = Number(totalsAfter?.[0]?.totalPrice ?? 0) || 0;
          const totalAbonadoAfter = Number(totalsAfter?.[0]?.totalAbonado ?? 0) || 0;

          if (totalPriceAfter > 0 && totalAbonadoAfter >= totalPriceAfter) {
            await db
              .update(numerosRifa)
              .set({ estado: 'pago', reservedAt: null, promoHold: 0 })
              .where(eq(numerosRifa.transactionNumber, numeroData.transactionNumber))
              .run();
          }
        } catch (e) {
          console.warn('Auto-mark payment skipped:', e);
        }

        // Enviar correo electrónico
        console.log('Buscando transacción:', numeroData.transactionNumber);
        
        const transactionData = await db
          .select()
          .from(transactions)
          .where(eq(transactions.transactionNumber, numeroData.transactionNumber))
          .get();

        if (!transactionData) {
          console.log('ERROR: Transacción no encontrada');
          continue;
        }

        console.log('Transacción encontrada:', { cedula: transactionData.usuarioCedula });

        // Buscar usuario con Drizzle ORM
        const usuarioData = await db
          .select()
          .from(usuarios)
          .where(eq(usuarios.cedula, transactionData.usuarioCedula))
          .get();

        if (!usuarioData) {
          console.log('ERROR: Usuario no encontrado');
          continue;
        }

        console.log('Usuario encontrado:', { 
          nombre: usuarioData.primerNombre, 
          correo: usuarioData.correoElectronico 
        });

        if (!usuarioData.correoElectronico) {
          console.log('ERROR: Usuario no tiene correo electrónico');
          continue;
        }

        console.log('Encolando correo de abono a:', usuarioData.correoElectronico);

        try {
          const txNum = String(numeroData.transactionNumber || '').trim();
          // Registrar movimiento validado por admin
          try {
            await ensureTransactionMovementsTable();
            await db.insert(transactionMovements).values({
              transactionNumber: txNum,
              kind: 'abono',
              amount: Math.trunc(montoAbono),
              createdAt: new Date().toISOString(),
            });
          } catch (e) {
            console.warn('No se pudo registrar transaction_movements (abono):', e);
          }

          // Ventana promo: inicia a partir de validación admin.
          try {
            await maybeStartPromoGraceWindow({ transactionNumber: txNum, eventId: transactionData.eventId });
          } catch (e) {
            console.warn('No se pudo iniciar ventana promo (abono-numbers):', e);
          }

          // Needed for backfill completeness: total abonos ya aplicados en la transacción
          let totalAbonadoTxNow = 0;
          try {
            const totalsTx = await db
              .select({
                totalAbonado: sql<number>`sum(coalesce(${numerosRifa.abonado}, 0))`,
              })
              .from(numerosRifa)
              .where(eq(numerosRifa.transactionNumber, txNum));
            totalAbonadoTxNow = Math.max(0, Math.trunc(Number(totalsTx?.[0]?.totalAbonado ?? 0) || 0));
          } catch {
            totalAbonadoTxNow = 0;
          }

          const movimientos = await loadAbonosForEmail({ transactionNumber: txNum, neededAbonosAmount: totalAbonadoTxNow });

          await queueEmailOnce('abono', {
            usuarioNombre: `${usuarioData.primerNombre} ${usuarioData.primerApellido}`,
            usuarioCorreo: usuarioData.correoElectronico,
            transactionNumber: numeroData.transactionNumber,
            campaignName: transactionData.campaignName,
            eventName: transactionData.eventName,
            numero: numeroValue,
            montoAbono: montoAbono,
            totalAbonado: nuevoAbono,
            // Importante: precio/saldo siempre sobre el precio REAL de la promo (precioSeleccionado)
            precioTotal: promoPrice,
            saldoPendiente: Math.max(0, promoPrice - nuevoAbono),
            tipoPrecio: numeroData.tipoPrecio,
            movimientos,
          }, { transactionNumber: txNum });
        } catch (error) {
          console.error('❌ Error encolando correo de abono:', error);
        }
      } else {
        console.log('AVISO: Número sin transactionNumber, no se envía correo');
      }
    }

    console.log('\n=== ABONOS PROCESADOS ===');
    console.log('Resultados:', resultados);

    return new Response(JSON.stringify({ success: true, count: resultados.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('ERROR en mark-abono-numbers:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Error desconocido' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
