import { db } from '../../db/client';
import { numerosRifa, transactions, transactionProofs, usuarios } from '../../db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ensureTransactionProofsTable } from '../../lib/transaction-proofs';
import { finalizePromoPacks } from '../../lib/finalize-promo-packs';
import { finalizePromoGracePayments } from '../../lib/finalize-promo-grace-payments';
import { releaseExpiredReservations } from '../../lib/release-expired-reservations';
import { getTxLedgerSummary } from '../../lib/tx-ledger';

const RESERVATION_TTL_MS = 5 * 60 * 1000;

export async function GET({ request }: any) {
	try {
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
		const cedula = String(url.searchParams.get('cedula') ?? '').trim();
		const eventIdRaw = String(url.searchParams.get('eventId') ?? '').trim();
		const eventId = eventIdRaw ? Number(eventIdRaw) : null;
		const view = String(url.searchParams.get('view') ?? '').trim();
		const isWelcomeView = view === 'welcome';

		// Keep reservation state fresh so the welcome countdown matches reality.
		try {
			if (eventId != null && Number.isFinite(eventId) && eventId > 0) {
				await releaseExpiredReservations({ eventId });
			} else {
				// Best-effort cleanup when eventId is omitted.
				await releaseExpiredReservations({});
			}
		} catch (e) {
			console.warn('Release expired reservations skipped:', e);
		}

		if (!cedula) {
			return new Response(JSON.stringify({ error: 'cedula requerida' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const usuarioRow = await db.select().from(usuarios).where(eq(usuarios.cedula, cedula)).limit(1);
		const usuarioNombreReal = usuarioRow.length > 0
			? `${usuarioRow[0].primerNombre} ${usuarioRow[0].segundoNombre || ''} ${usuarioRow[0].primerApellido} ${usuarioRow[0].segundoApellido}`.trim()
			: null;
		const usuarioCorreo = usuarioRow.length > 0 ? (usuarioRow[0].correoElectronico ?? null) : null;

		// For the welcome screen we also want to show already paid numbers (they already participate).
		let paidNumbers: string[] = [];
		if (isWelcomeView) {
			const paidWhere: any[] = [
				eq(numerosRifa.numeroIdentificacion, cedula),
				inArray(numerosRifa.estado, ['pago', 'pago_gracia']),
			];
			if (eventId != null && Number.isFinite(eventId) && eventId > 0) {
				paidWhere.push(eq(numerosRifa.eventId, eventId));
			}
			const paidRows = await db
				.select({ numero: numerosRifa.numero })
				.from(numerosRifa)
				.where(and(...paidWhere));
			paidNumbers = paidRows.map((r) => String((r as any).numero ?? '')).filter((n) => n).sort();
		}

		const estados = isWelcomeView
			? ['reservado', 'abonada', 'pago_gracia', 'pago']
			: ['reservado', 'abonada', 'pago_gracia'];

		// 1) Determine which transactions to return.
		// For the payments modal (non-welcome view) we list only pending-ish states,
		// BUT we must compute totals including already-paid rows (estado='pago') inside the same transaction.
		const txWhereParts: any[] = [
			eq(numerosRifa.numeroIdentificacion, cedula),
			inArray(numerosRifa.estado, estados),
			sql`${numerosRifa.transactionNumber} is not null`,
			sql`${numerosRifa.transactionNumber} != ''`,
		];
		if (eventId != null && Number.isFinite(eventId) && eventId > 0) {
			txWhereParts.push(eq(numerosRifa.eventId, eventId));
		}

		const txNumberRows = await db
			.selectDistinct({ transactionNumber: numerosRifa.transactionNumber, eventId: numerosRifa.eventId })
			.from(numerosRifa)
			.where(and(...txWhereParts));

		const txNumbers = txNumberRows
			.map((r) => String(r.transactionNumber ?? '').trim())
			.filter((t) => t);

		if (txNumbers.length === 0) {
			return new Response(
				JSON.stringify({
					usuario: { cedula, nombre: usuarioNombreReal, correo: usuarioCorreo },
					transactions: [],
					...(isWelcomeView ? { paidNumbers } : {}),
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// 2) Aggregate using ALL rows that belong to those transactions (including estado='pago').
		const aggWhereParts: any[] = [
			eq(numerosRifa.numeroIdentificacion, cedula),
			inArray(numerosRifa.transactionNumber, txNumbers),
			sql`${numerosRifa.estado} != 'disponible'`,
			sql`${numerosRifa.transactionNumber} is not null`,
			sql`${numerosRifa.transactionNumber} != ''`,
		];
		if (eventId != null && Number.isFinite(eventId) && eventId > 0) {
			aggWhereParts.push(eq(numerosRifa.eventId, eventId));
		}

		const aggregates = await db
			.select({
				transactionNumber: numerosRifa.transactionNumber,
				eventId: numerosRifa.eventId,
				totalPrice: sql<number>`sum(${numerosRifa.precioSeleccionado})`,
				cantidad: sql<number>`count(1)`,
				numerosCsv: sql<string>`group_concat(${numerosRifa.numero}, ',')`,
				hasPromo: sql<number>`max(case when ${numerosRifa.tipoPrecio} != 'normal' then 1 else 0 end)`,
				promoUnitPrice: sql<number>`min(case when ${numerosRifa.tipoPrecio} != 'normal' then ${numerosRifa.precioSeleccionado} else null end)`,
				normalUnitPrice: sql<number>`min(case when ${numerosRifa.tipoPrecio} = 'normal' then ${numerosRifa.precioSeleccionado} else null end)`,
				reservedCount: sql<number>`sum(case when ${numerosRifa.estado} = 'reservado' then 1 else 0 end)`,
				minReservedAt: sql<string>`min(case when ${numerosRifa.estado} = 'reservado' then ${numerosRifa.reservedAt} else null end)`,
			})
			.from(numerosRifa)
			.where(and(...aggWhereParts))
			.groupBy(numerosRifa.transactionNumber, numerosRifa.eventId)
			.orderBy(desc(sql`max(${numerosRifa.createdAt})`));

		const txRows = await db
			.select({
				transactionNumber: transactions.transactionNumber,
				usuarioCedula: transactions.usuarioCedula,
				usuarioNombre: transactions.usuarioNombre,
				campaignName: transactions.campaignName,
				eventId: transactions.eventId,
				eventName: transactions.eventName,
				createdAt: transactions.createdAt,
				precioTotal: transactions.precioTotal,
				promociones: transactions.promociones,
				promoStartedAt: transactions.promoStartedAt,
				promoExpiresAt: transactions.promoExpiresAt,
			})
			.from(transactions)
			.where(inArray(transactions.transactionNumber, txNumbers))
			.orderBy(desc(transactions.createdAt));

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

		const txByNumber = new Map(txRows.map((t) => [String(t.transactionNumber), t]));
		const proofsByNumber = new Map<string, typeof proofs>();
		for (const p of proofs) {
			const key = String(p.transactionNumber);
			const arr = proofsByNumber.get(key) ?? [];
			arr.push(p);
			proofsByNumber.set(key, arr);
		}

		const usuarioNombreFallback = txRows.find((t) => String(t.usuarioCedula) === cedula)?.usuarioNombre ?? null;
		const usuarioNombre = usuarioNombreReal ?? (usuarioNombreFallback === 'Usuario' ? null : usuarioNombreFallback);

		const result = await Promise.all(aggregates.map(async (agg) => {
			const txNumber = String(agg.transactionNumber);
			const tx = txByNumber.get(txNumber);

			// User-facing totals must come from the admin ledger only.
			const ledger = await getTxLedgerSummary(txNumber, { includePaidRowsCredit: false });
			const totalPrice = Number(ledger.totalPrice ?? agg.totalPrice ?? tx?.precioTotal ?? 0) || 0;
			const totalAbonado = Number(ledger.abonoLedgerTotal ?? 0) || 0;
			const totalPagado = Number(ledger.pagoLedgerTotal ?? 0) || 0;
			const creditedTotal = totalAbonado + totalPagado;
			const saldoPendiente = Math.max(0, totalPrice - creditedTotal);
			const cantidad = Number(agg.cantidad ?? 0) || 0;

			const promoUnitPrice = Number((agg as any).promoUnitPrice ?? 0) || 0;
			const normalUnitPrice = Number((agg as any).normalUnitPrice ?? 0) || 0;

			const reservedCount = Number((agg as any).reservedCount ?? 0) || 0;
			const minReservedAt = (agg as any).minReservedAt ? String((agg as any).minReservedAt) : null;

			// Importante: NO inferir promo por la ventana de gracia.
			// Una transacción "normal" de 1-2 boletas puede tener promo_expires_at para permitir completar el pack,
			// pero sigue siendo normal (min abono 10.000) hasta que realmente sea promo (promociones>0 o tipoPrecio=promocion).
			const hasPromoNumbers = Number(agg.hasPromo ?? 0) === 1;
			const hasPromoTx = (Number(tx?.promociones ?? 0) || 0) > 0;
			const isPromoTx = hasPromoTx || hasPromoNumbers;
			const minAbono = 5000;

			const promoExpiresAt = tx?.promoExpiresAt ? String(tx.promoExpiresAt) : null;
			const msRemaining = promoExpiresAt ? Math.max(0, Date.parse(promoExpiresAt) - Date.now()) : 0;

			const proofsList = (proofsByNumber.get(txNumber) ?? []).map((p) => ({
				kind: p.kind,
				amount: p.amount,
				url: p.url,
				createdAt: p.createdAt,
			}));
			const hasProofs = proofsList.length > 0;

			// "Reserva sin abonos": no comprobantes y sin créditos, con al menos 1 número aún en estado reservado.
			// Nota: aunque exista promoExpiresAt (gracia para completar promo), esto sigue siendo una reserva mientras no tenga abonos/pagos.
			const isReservedOnly = cantidad > 0 && reservedCount > 0 && creditedTotal <= 0 && !hasProofs;
			const isFullyReserved = cantidad > 0 && reservedCount === cantidad;

			let reservationExpiresAt: string | null = null;
			let reservationMsRemaining = 0;
			if (isReservedOnly) {
				const baseIso = minReservedAt || (tx?.createdAt ? String(tx.createdAt) : null);
				const baseMs = baseIso ? Date.parse(String(baseIso)) : NaN;
				if (Number.isFinite(baseMs)) {
					const expMs = baseMs + RESERVATION_TTL_MS;
					reservationExpiresAt = new Date(expMs).toISOString();
					reservationMsRemaining = Math.max(0, expMs - Date.now());
				}
			}

			return {
				transactionNumber: txNumber,
				eventId: Number(tx?.eventId ?? agg.eventId),
				eventName: tx?.eventName ?? null,
				campaignName: tx?.campaignName ?? null,
				createdAt: tx?.createdAt ?? null,
				promoExpiresAt,
				msRemaining,
				reservationExpiresAt,
				reservationMsRemaining,
				isReservedOnly,
				isFullyReserved,
				cantidad,
				numeros: String(agg.numerosCsv ?? '')
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
					.sort(),
				totalPrice,
				totalAbonado,
				totalPagado,
				creditedTotal,
				saldoPendiente,
				hasPromo: isPromoTx,
				promoUnitPrice: promoUnitPrice > 0 ? promoUnitPrice : null,
				normalUnitPrice: normalUnitPrice > 0 ? normalUnitPrice : null,
				minAbono,
				proofs: proofsList,
			};
		}));

		return new Response(
			JSON.stringify({
				usuario: { cedula, nombre: usuarioNombre, correo: usuarioCorreo },
				transactions: result,
				...(isWelcomeView ? { paidNumbers } : {}),
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		console.error('Error pending-transactions:', error);
		return new Response(JSON.stringify({ error: 'Error interno' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
