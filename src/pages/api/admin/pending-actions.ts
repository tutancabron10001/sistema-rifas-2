import type { APIRoute } from 'astro';
import { db } from '../../../db/client';
import { numerosRifa, transactions, transactionProofs, usuarios } from '../../../db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ensureTransactionProofsTable } from '../../../lib/transaction-proofs';
import { finalizePromoPacks } from '../../../lib/finalize-promo-packs';
import { finalizePromoGracePayments } from '../../../lib/finalize-promo-grace-payments';
import { getTxLedgerSummary } from '../../../lib/tx-ledger';
import { events } from '../../../db/schema';
import { promoPackSize } from '../../../lib/promo-pack';

function isAdminRequest(request: Request) {
	const cookie = request.headers.get('cookie') || '';
	return cookie.includes('admin_session=');
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
	const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(n)));
}

function computePendingProofs(proofs: any[], creditedTotal: number, totalPrice: number) {
  const considered = Array.isArray(proofs)
    ? proofs.filter((p) => String(p?.status || 'pending').toLowerCase() !== 'rejected')
    : [];

	// Si ya está pagada completa, no debe haber pendientes (equivalente a lupita en 0)
	if ((Number(totalPrice) || 0) > 0 && (Number(creditedTotal) || 0) >= (Number(totalPrice) || 0)) {
		const total = considered.length;
		return { total, validated: total, pending: 0, pendingAmount: 0 };
	}

	const asc = [...considered].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

	// IMPORTANT:
	// - 'abono' proofs are validated based on amounts applied (captured elsewhere in credited totals)
	// - 'pago' proofs usually have no amount; validate them by count of direct-paid numbers.
	const total = considered.length;
	let validated = 0;
	let pendingAmount = 0;

	// We expect the caller to pass a creditedTotal that includes both abonos and pagos.
	// To avoid mis-classifying pago proofs as pending forever, we validate up to `paidCount` pago proofs.
	const paidCount = Number((computePendingProofs as any)._paidCount ?? 0) || 0;
	let remainingPagoValidations = Math.max(0, Math.trunc(paidCount));

	// For abonos, we validate against the applied abono total only.
	const abonoBudget = Number((computePendingProofs as any)._totalAbonado ?? 0) || 0;
	let sumAbono = 0;

	for (const p of asc) {
		const kind = String(p?.kind || '').toLowerCase();
		if (kind === 'pago') {
			if (remainingPagoValidations > 0) {
				remainingPagoValidations -= 1;
				validated += 1;
			}
			continue;
		}
		const amt = Number(p?.amount ?? 0) || 0;
		if (amt <= 0) continue;
		if (sumAbono + amt <= abonoBudget) {
			sumAbono += amt;
			validated += 1;
		} else {
			pendingAmount += amt;
		}
	}

	return { total, validated, pending: Math.max(0, total - validated), pendingAmount };
}

export const GET: APIRoute = async ({ request }) => {
	try {
		if (!isAdminRequest(request)) {
			return new Response(JSON.stringify({ error: 'No autorizado' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Consistency hook: finalize promo packs at cutoff window (raffle - 1 day)
		try {
			await finalizePromoPacks();
		} catch (e) {
			console.warn('Promo finalize skipped:', e);
		}

		// Consistency hook: finalize grace window states
		try {
			await finalizePromoGracePayments();
		} catch (e) {
			console.warn('Promo grace finalize skipped:', e);
		}

		await ensureTransactionProofsTable();

		const url = new URL(request.url);
		const limit = clampInt(url.searchParams.get('limit'), 1, 200, 60);
		const mode = String(url.searchParams.get('mode') || 'admin').toLowerCase();
		const isPaymentMode = mode === 'payment' || mode === 'pago' || mode === 'unpaid';
		const isPagosMode = mode === 'pagos';

		let txNumbers: string[] = [];
		let aggRows:
			| Array<{
				transactionNumber: unknown;
				totalPrice: number;
				totalAbonado: number;
				paidTotal: number;
				paidCount: number;
				lastDate: string;
			}>
			| [] = [];

		if (isPaymentMode || isPagosMode) {
			// Admin accounting is ledger-based. We fetch candidate transactions from numeros_rifa
			// and later filter by ledger-derived saldoPendiente or by non-promo paid status.
			aggRows = await db
				.select({
					transactionNumber: numerosRifa.transactionNumber,
					totalPrice: sql<number>`sum(${numerosRifa.precioSeleccionado})`,
					totalAbonado: sql<number>`0`,
					paidTotal: sql<number>`0`,
					paidCount: sql<number>`sum(case when ${numerosRifa.estado} in ('pago','pago_gracia') then 1 else 0 end)`,
					lastDate: sql<string>`max(${numerosRifa.createdAt})`,
				})
				.from(numerosRifa)
				.where(
					and(
						inArray(numerosRifa.estado, ['reservado', 'abonada', 'pago', 'pago_gracia']),
						sql`${numerosRifa.transactionNumber} is not null`,
						sql`${numerosRifa.transactionNumber} != ''`
					)
				)
				.groupBy(numerosRifa.transactionNumber)
				.orderBy(desc(sql`max(${numerosRifa.createdAt})`))
				.limit(limit);

			txNumbers = Array.from(
				new Set(aggRows.map((r) => String((r as any).transactionNumber ?? '').trim()).filter((t) => t))
			);
		} else {
			// Base de pendientes: transacciones que tengan comprobantes (abono/pago).
			// El "pendiente" se define por comprobantes NO validados (misma lógica de la lupita).
			const proofAggRows = await db
				.select({
					transactionNumber: transactionProofs.transactionNumber,
					lastProofAt: sql<string>`max(${transactionProofs.createdAt})`,
				})
				.from(transactionProofs)
				.where(
					and(
						inArray(transactionProofs.kind, ['abono', 'pago']),
						sql`${transactionProofs.transactionNumber} is not null`,
						sql`${transactionProofs.transactionNumber} != ''`
					)
				)
				.groupBy(transactionProofs.transactionNumber)
				.orderBy(desc(sql`max(${transactionProofs.createdAt})`))
				.limit(limit);

			txNumbers = Array.from(
				new Set(
					proofAggRows
						.map((r) => String(r.transactionNumber ?? '').trim())
						.filter((t) => t)
				)
			);
		}

		if (txNumbers.length === 0) {
			return new Response(
				JSON.stringify({
					summary: {
						transactionsPending: 0,
						proofsPending: 0,
						pendingAmountTotal: 0,
					},
					items: [],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		}

		if (!isPaymentMode) {
			aggRows = await db
				.select({
					transactionNumber: numerosRifa.transactionNumber,
					totalPrice: sql<number>`sum(${numerosRifa.precioSeleccionado})`,
					totalAbonado: sql<number>`0`,
					paidTotal: sql<number>`0`,
					paidCount: sql<number>`sum(case when ${numerosRifa.estado} in ('pago','pago_gracia') then 1 else 0 end)`,
					lastDate: sql<string>`max(${numerosRifa.createdAt})`,
				})
				.from(numerosRifa)
				.where(
					and(
						inArray(numerosRifa.estado, ['reservado', 'abonada', 'pago', 'pago_gracia']),
						inArray(numerosRifa.transactionNumber, txNumbers)
					)
				)
				.groupBy(numerosRifa.transactionNumber);
		}

		const txRows = await db
			.select({
				transactionNumber: transactions.transactionNumber,
				usuarioCedula: transactions.usuarioCedula,
				usuarioNombre: sql<string>`case when ${transactions.usuarioNombre} = 'Usuario' then trim(${usuarios.primerNombre} || ' ' || coalesce(${usuarios.segundoNombre}, '') || ' ' || ${usuarios.primerApellido} || ' ' || ${usuarios.segundoApellido}) else ${transactions.usuarioNombre} end`,
				usuarioCorreo: usuarios.correoElectronico,
				usuarioTelefono: usuarios.telefono,
				campaignName: transactions.campaignName,
				eventId: transactions.eventId,
				eventName: transactions.eventName,
				createdAt: transactions.createdAt,
				precioTotal: transactions.precioTotal,
				cantidad: transactions.cantidad,
				promociones: transactions.promociones,
				// @ts-ignore optional promo columns
				promoStartedAt: (transactions as any).promoStartedAt,
				// @ts-ignore optional promo columns
				promoExpiresAt: (transactions as any).promoExpiresAt,
				// @ts-ignore optional promo columns
				promoFinalizedAt: (transactions as any).promoFinalizedAt,
			})
			.from(transactions)
			.leftJoin(usuarios, eq(usuarios.cedula, transactions.usuarioCedula))
			.where(inArray(transactions.transactionNumber, txNumbers));

		const eventIds = Array.from(new Set(txRows.map((t: any) => Number(t?.eventId ?? 0)).filter((n) => Number.isFinite(n) && n > 0)));
		const eventRows = eventIds.length
			? await db
					.select({ id: events.id, price: events.price, promoPrice: events.promoPrice })
					.from(events)
					.where(inArray(events.id, eventIds))
			: [];
		const eventById = new Map(eventRows.map((e: any) => [Number(e.id), e]));

		// Numbers per transaction (for admin card view)
		const numberRows = await db
			.select({
				transactionNumber: numerosRifa.transactionNumber,
				eventId: numerosRifa.eventId,
				numero: numerosRifa.numero,
				estado: numerosRifa.estado,
				tipoPrecio: numerosRifa.tipoPrecio,
				precioSeleccionado: numerosRifa.precioSeleccionado,
				paidAmount: numerosRifa.paidAmount,
				abonado: numerosRifa.abonado,
				reservedAt: numerosRifa.reservedAt,
			})
			.from(numerosRifa)
			.where(
				and(
					inArray(numerosRifa.transactionNumber, txNumbers),
					inArray(numerosRifa.estado, ['reservado', 'abonada', 'pago', 'pago_gracia'])
				)
			);

		const numbersByTx = new Map<string, any[]>();
		for (const r of numberRows) {
			const tx = String((r as any)?.transactionNumber ?? '').trim();
			if (!tx) continue;
			const arr = numbersByTx.get(tx) ?? [];
			arr.push(r);
			numbersByTx.set(tx, arr);
		}
		for (const [k, arr] of numbersByTx.entries()) {
			arr.sort((a: any, b: any) => String(a.numero || '').localeCompare(String(b.numero || '')));
			numbersByTx.set(k, arr);
		}

		const proofs = await db
			.select({
				id: transactionProofs.id,
				transactionNumber: transactionProofs.transactionNumber,
				kind: transactionProofs.kind,
				amount: transactionProofs.amount,
				url: transactionProofs.cloudinaryUrl,
				publicId: transactionProofs.cloudinaryPublicId,
				status: transactionProofs.status,
				rejectedAt: transactionProofs.rejectedAt,
				rejectReason: transactionProofs.rejectReason,
				createdAt: transactionProofs.createdAt,
			})
			.from(transactionProofs)
			.where(inArray(transactionProofs.transactionNumber, txNumbers));

		const proofsByTx = new Map<string, any[]>();
		for (const p of proofs) {
			const key = String(p.transactionNumber);
			const arr = proofsByTx.get(key) ?? [];
			arr.push(p);
			proofsByTx.set(key, arr);
		}
		for (const [k, arr] of proofsByTx.entries()) {
			arr.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
			proofsByTx.set(k, arr);
		}

		const txByNumber = new Map(txRows.map((t) => [String(t.transactionNumber), t]));

		let transactionsPending = 0;
		let proofsPending = 0;
		let pendingAmountTotal = 0;
		let transactionsUnpaid = 0;
		let numbersUnpaid = 0;
		let saldoUnpaidTotal = 0;
		let collectedTotal = 0;

		const aggByTx = new Map(aggRows.map((r) => [String(r.transactionNumber ?? '').trim(), r]));

		// Importante: si el sistema liberó una reserva y limpió los números,
		// NO debe aparecer como pendiente aunque existan comprobantes antiguos.
		// La definición de "pendiente" debe ser exactamente la misma que la lupita,
		// y la lupita solo existe cuando aún hay filas en numeros_rifa con esa transacción.
		const existingTxNumbers = txNumbers.filter((tx) => aggByTx.has(tx));
		if (existingTxNumbers.length === 0) {
			return new Response(
				JSON.stringify({
					summary: {
						transactionsPending: 0,
						proofsPending: 0,
						pendingAmountTotal: 0,
					},
					items: [],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Ledger totals per transaction (admin rule: ignore numeros_rifa.abonado)
		const ledgerEntries = await Promise.all(
			existingTxNumbers.map(async (tx) => [tx, await getTxLedgerSummary(tx)] as const)
		);
		const ledgerByTx = new Map(ledgerEntries);

		const items = existingTxNumbers
			.map((agg) => {
				const txNumber = String(agg ?? '').trim();
				if (!txNumber) return null;
				const aggRow = aggByTx.get(txNumber);
				const tx = txByNumber.get(txNumber);
				const totalPriceFallback = Number(aggRow?.totalPrice ?? tx?.precioTotal ?? 0) || 0;
				const ledger = ledgerByTx.get(txNumber);
				const totalPrice = Number(ledger?.totalPrice ?? totalPriceFallback) || 0;
				const totalAbonado = Number(ledger?.abonoLedgerTotal ?? 0) || 0;
				const paidTotal = Number(ledger?.paymentCredit ?? 0) || 0;
				const paidCount = Number(ledger?.paidCount ?? (aggRow as any)?.paidCount ?? 0) || 0;
				const creditedTotal = Number(ledger?.creditedTotal ?? totalAbonado + paidTotal) || 0;
				const saldoPendiente = Number(ledger?.saldoPendiente ?? Math.max(0, totalPrice - creditedTotal)) || 0;

				const txProofs = proofsByTx.get(txNumber) ?? [];
				// Pass extra context via function static fields to avoid refactoring the whole file.
				(computePendingProofs as any)._totalAbonado = totalAbonado;
				(computePendingProofs as any)._paidCount = paidCount;
				const p = computePendingProofs(txProofs, creditedTotal, totalPrice);

				// Resumen para modo admin (pendientes por validar)
				if (p.pending > 0) {
					transactionsPending += 1;
					proofsPending += p.pending;
					pendingAmountTotal += Number(p.pendingAmount ?? 0) || 0;
				}

				// Resumen para modo pago (pendientes de pago por saldo)
				if (saldoPendiente > 0) {
					transactionsUnpaid += 1;
					saldoUnpaidTotal += saldoPendiente;
					collectedTotal += creditedTotal;
					const txNumbersRows = numbersByTx.get(txNumber) ?? [];
					for (const n of txNumbersRows as any[]) {
						const st = String(n?.estado || '').toLowerCase();
						if (st !== 'pago' && st !== 'pago_gracia') numbersUnpaid += 1;
					}
				}

				return {
					transactionNumber: txNumber,
					usuarioNombre: tx?.usuarioNombre ?? null,
					usuarioCedula: tx?.usuarioCedula ?? null,
					usuarioCorreo: (tx as any)?.usuarioCorreo ?? null,
					usuarioTelefono: (tx as any)?.usuarioTelefono ?? null,
					campaignName: tx?.campaignName ?? null,
					eventId: (tx as any)?.eventId ?? null,
					eventName: tx?.eventName ?? null,
					createdAt: tx?.createdAt ?? aggRow?.lastDate ?? null,
					totalPrice,
					totalAbonado,
					paidTotal,
					paidCount,
					creditedTotal,
					saldoPendiente,
					proofs: txProofs,
					proofStats: p,
					promo: (() => {
						const ev = eventById.get(Number((tx as any)?.eventId ?? 0));
						const eligible = Boolean(ev && Number((ev as any).price || 0) > 20000 && (ev as any).promoPrice != null);
						const packSize = promoPackSize();
						const cantidad = Math.max(0, Number((tx as any)?.cantidad ?? 0) || 0);
						const missing = (packSize - (cantidad % packSize)) % packSize;
						const expiresAt = String((tx as any)?.promoExpiresAt ?? '').trim();
						const finalizedAt = String((tx as any)?.promoFinalizedAt ?? '').trim();
						const nowMs = Date.now();
						const expMs = expiresAt ? Date.parse(expiresAt) : NaN;
						const active = Number.isFinite(expMs) && expMs > nowMs;
						return {
							eligible,
							missing,
							active,
							expiresAt: expiresAt || null,
							finalizedAt: finalizedAt || null,
						};
					})(),
					numbers: (numbersByTx.get(txNumber) ?? []).map((n: any) => ({
						eventId: Number(n?.eventId ?? 0) || 0,
						numero: String(n?.numero ?? ''),
						estado: String(n?.estado ?? ''),
						tipoPrecio: String(n?.tipoPrecio ?? ''),
						precioSeleccionado: Number(n?.precioSeleccionado ?? 0) || 0,
						reservedAt: n?.reservedAt ?? null,
						// Admin view: do not reflect per-boleta payments/abonos (ledger-only).
						paidAmount: 0,
						abonado: 0,
					})),
				};
			})
			.filter(Boolean)
			.filter((it: any) => {
				if (isPagosMode) {
					// Modo pagos: transacciones completamente pagadas (saldo = 0) y sin promoción activa
					const saldo = Number(it?.saldoPendiente || 0) || 0;
					const tx = txByNumber.get(String(it?.transactionNumber || ''));
					const hasPromo = tx && (Number((tx as any)?.promociones ?? 0) > 0);
					return saldo === 0 && !hasPromo;
				}
				if (isPaymentMode) return (Number(it?.saldoPendiente || 0) || 0) > 0;
				return (Number(it?.proofStats?.pending || 0) || 0) > 0;
			})
			.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

		return new Response(
			JSON.stringify({
				summary: {
					transactionsPending,
					proofsPending,
					pendingAmountTotal,
					transactionsUnpaid,
					numbersUnpaid,
					saldoUnpaidTotal,
					collectedTotal,
				},
				items,
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		console.error('Error admin/pending-actions:', error);
		return new Response(JSON.stringify({ error: 'Error interno' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
