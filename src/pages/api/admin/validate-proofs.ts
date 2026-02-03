import type { APIRoute } from 'astro';
import { db } from '../../../db/client';
import { transactionProofs, transactionMovements, numerosRifa, transactions, events } from '../../../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { ensureTransactionProofsTable } from '../../../lib/transaction-proofs';
import { ensureTransactionMovementsTable } from '../../../lib/transaction-movements';
import { getTxLedgerSummary } from '../../../lib/tx-ledger';
import { maybeStartPromoGraceWindow } from '../../../lib/promo-grace';

function isAdminRequest(request: Request) {
	const cookie = request.headers.get('cookie') || '';
	return cookie.includes('admin_session=');
}

function toIntPesos(n: number) {
	const v = Math.floor(Number(n) || 0);
	return Number.isFinite(v) ? v : 0;
}

export const POST: APIRoute = async ({ request }) => {
	try {
		if (!isAdminRequest(request)) {
			return new Response(JSON.stringify({ error: 'No autorizado' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const body = await request.json().catch(() => ({}));
		const { transactionNumber, kind } = body;

		if (!transactionNumber || !kind || !['pago', 'abono'].includes(kind)) {
			return new Response(JSON.stringify({ error: 'Parámetros inválidos' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		await ensureTransactionProofsTable();
		await ensureTransactionMovementsTable();

		// Obtener todos los proofs pendientes del tipo especificado para esta transacción
		const pendingProofs = await db
			.select({
				id: transactionProofs.id,
				amount: transactionProofs.amount,
				createdAt: transactionProofs.createdAt,
			})
			.from(transactionProofs)
			.where(
				and(
					eq(transactionProofs.transactionNumber, transactionNumber),
					eq(transactionProofs.kind, kind),
					eq(transactionProofs.status, 'pending')
				)
			)
			.orderBy(transactionProofs.createdAt);

		if (pendingProofs.length === 0) {
			return new Response(JSON.stringify({ error: 'No hay comprobantes pendientes para validar' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Actualizar todos los proofs a 'validated'
		await db
			.update(transactionProofs)
			.set({ status: 'validated' })
			.where(
				and(
					eq(transactionProofs.transactionNumber, transactionNumber),
					eq(transactionProofs.kind, kind),
					eq(transactionProofs.status, 'pending')
				)
			);

		// Para abonos, ejecutar la misma lógica que mark-abono-transaction
		if (kind === 'abono') {
			// Calcular el total de abonos a validar
			const totalAbonoAmount = pendingProofs.reduce((sum, proof) => sum + (Number(proof.amount) || 0), 0);
			
			if (totalAbonoAmount > 0) {
				// Obtener información de la transacción
				const txInfo = await db
					.select()
					.from(transactions)
					.where(eq(transactions.transactionNumber, transactionNumber))
					.limit(1)
					.then(rows => rows[0] || null);

				if (!txInfo) {
					return new Response(JSON.stringify({ error: 'Transacción no encontrada' }), {
						status: 404,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				// Verificar saldo pendiente antes de registrar
				const ledgerBefore = await getTxLedgerSummary(transactionNumber);
				const saldoTxBefore = Math.max(0, toIntPesos(ledgerBefore?.saldoPendiente ?? 0));
				const abonoAmount = Math.max(0, toIntPesos(totalAbonoAmount));

				if (abonoAmount > saldoTxBefore) {
					return new Response(
						JSON.stringify({
							error: 'El total de abonos supera el saldo pendiente de la transacción',
							saldoPendiente: saldoTxBefore,
							totalAbonos: abonoAmount,
						}),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				// Registrar movimientos en transactionMovements
				const movements = pendingProofs.map(proof => ({
					transactionNumber,
					kind: 'abono' as const,
					amount: Number(proof.amount) || 0,
					createdAt: new Date().toISOString(),
				}));

				await db.insert(transactionMovements).values(movements);

				// Ejecutar la misma lógica de negocio que mark-abono-transaction
				try {
					// Iniciar ventana de gracia promo si aplica
					await maybeStartPromoGraceWindow({ transactionNumber, eventId: txInfo.eventId });

					// Obtener números de la transacción
					const numbers = await db
						.select()
						.from(numerosRifa)
						.where(
							and(
								eq(numerosRifa.transactionNumber, transactionNumber),
								eq(numerosRifa.eventId, txInfo.eventId)
							)
						);

					// Calcular estados después del abono
					const ledgerAfter = await getTxLedgerSummary(transactionNumber);
					const totalPrecioTx = Math.max(0, toIntPesos(ledgerAfter?.totalPrice ?? 0));
					const totalAbonadoTx = Math.max(0, toIntPesos(ledgerAfter?.abonoLedgerTotal ?? 0));
					const saldoPendienteTx = Math.max(0, toIntPesos(ledgerAfter?.saldoPendiente ?? 0));
					const txBecamePaid = totalPrecioTx > 0 && saldoPendienteTx <= 0;

					// Lógica para decidir si bloquear reservas y actualizar estados
					let creditedByMovements = 0;
					try {
						const ledgerMov = await getTxLedgerSummary(transactionNumber, { includePaidRowsCredit: false });
						creditedByMovements =
							(Number(ledgerMov?.abonoLedgerTotal ?? 0) || 0) + (Number(ledgerMov?.pagoLedgerTotal ?? 0) || 0);
					} catch (e) {
						console.warn('No se pudo calcular creditedByMovements:', e);
					}

					const hasPromoNumbers = numbers.some((r: any) => String(r?.tipoPrecio || '').toLowerCase() === 'promocion');
					const promoLike =
						hasPromoNumbers || (Number((txInfo as any)?.promociones ?? 0) || 0) > 0 || Boolean((txInfo as any)?.promoExpiresAt);
					const promoMinMet = creditedByMovements + 0.5 >= 20000;

					// Para promo: una boleta no pasa a ABONADA hasta cumplir el mínimo (20.000) validado en movements.
					// Para no-promo: mantenemos el comportamiento previo (cualquier dinero validado evita auto-release).
					const lockReservationsNow = !promoLike || promoMinMet || txBecamePaid;
					if (lockReservationsNow) {
						await db
							.update(numerosRifa)
							.set({ reservedAt: null })
							.where(and(eq(numerosRifa.transactionNumber, transactionNumber), eq(numerosRifa.eventId, txInfo.eventId)));
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
									eq(numerosRifa.eventId, txInfo.eventId),
									inArray(numerosRifa.estado, ['reservado'])
								)
							);
					}

					// If fully covered by ledger, force all numbers to PAGO (idempotent)
					if (txBecamePaid) {
						await db
							.update(numerosRifa)
							.set({ estado: 'pago', promoHold: 0 })
							.where(and(eq(numerosRifa.transactionNumber, transactionNumber), eq(numerosRifa.eventId, txInfo.eventId)));
					}

				} catch (e) {
					console.error('Error ejecutando lógica de negocio para abonos:', e);
					// No fallamos la validación, pero logueamos el error
				}
			}
		}

		// Para pagos, registrar un movimiento por cada proof validado
		if (kind === 'pago') {
			// Obtener el resumen actual de la transacción para determinar el monto a registrar
			const ledger = await getTxLedgerSummary(transactionNumber);
			const saldoPendiente = Number(ledger?.saldoPendiente || 0);
			
			// Si hay saldo pendiente, registrar el pago correspondiente
			if (saldoPendiente > 0) {
				await db.insert(transactionMovements).values({
					transactionNumber,
					kind: 'pago',
					amount: Math.min(saldoPendiente, 999999999), // Limitar para evitar overflow
					createdAt: new Date().toISOString(),
				});

				// Para pagos, también actualizar estados de números a 'pago'
				try {
					const txInfo = await db
						.select()
						.from(transactions)
						.where(eq(transactions.transactionNumber, transactionNumber))
						.limit(1)
						.then(rows => rows[0] || null);

					if (txInfo) {
						await db
							.update(numerosRifa)
							.set({ estado: 'pago', promoHold: 0, reservedAt: null })
							.where(and(eq(numerosRifa.transactionNumber, transactionNumber), eq(numerosRifa.eventId, txInfo.eventId)));
					}
				} catch (e) {
					console.error('Error actualizando estados a pago:', e);
				}
			}
		}

		return new Response(
			JSON.stringify({
				success: true,
				message: `${kind === 'pago' ? 'Pagos' : 'Abonos'} validados correctamente`,
				validatedCount: pendingProofs.length,
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);

	} catch (error) {
		console.error('Error en validate-proofs:', error);
		return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
