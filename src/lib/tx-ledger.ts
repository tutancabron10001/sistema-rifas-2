import { db } from '../db/client';
import { numerosRifa, transactionMovements } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

export type TxLedgerSummary = {
	transactionNumber: string;
	totalPrice: number;
	paidCount: number;
	paidRowsCredit: number;
	abonoLedgerTotal: number;
	pagoLedgerTotal: number;
	paymentCredit: number;
	creditedTotal: number;
	saldoPendiente: number;
};

export type TxLedgerOptions = {
	// Back-compat for older transactions where rows are already marked paid.
	// When false, totals come strictly from transaction_movements.
	includePaidRowsCredit?: boolean;
};

function toInt(n: unknown) {
	const v = Math.trunc(Number(n) || 0);
	return Number.isFinite(v) ? v : 0;
}

// Computes transaction totals with the new admin rule:
// - We do NOT use numeros_rifa.abonado as a source of truth.
// - Credits come from transaction_movements (ledger) plus paid rows credit (paid_amount/price).
// - To avoid double counting payments, payment credit is max(pagoLedgerTotal, paidRowsCredit).
export async function getTxLedgerSummary(
	transactionNumber: string,
	opts: TxLedgerOptions = {}
): Promise<TxLedgerSummary> {
	const tx = String(transactionNumber || '').trim();
	const includePaidRowsCredit = opts.includePaidRowsCredit !== false;
	if (!tx) {
		return {
			transactionNumber: '',
			totalPrice: 0,
			paidCount: 0,
			paidRowsCredit: 0,
			abonoLedgerTotal: 0,
			pagoLedgerTotal: 0,
			paymentCredit: 0,
			creditedTotal: 0,
			saldoPendiente: 0,
		};
	}

	const rows = await db
		.select({
			totalPrice: sql<number>`coalesce(sum(${numerosRifa.precioSeleccionado}), 0)`,
			paidCount: sql<number>`sum(case when ${numerosRifa.estado} in ('pago','pago_gracia') then 1 else 0 end)`,
			paidRowsCredit: sql<number>`sum(case when ${numerosRifa.estado} in ('pago','pago_gracia') then coalesce(${numerosRifa.paidAmount}, ${numerosRifa.precioSeleccionado}) else 0 end)`,
			abonoLedgerTotal: sql<number>`coalesce((select sum(${transactionMovements.amount}) from ${transactionMovements} where ${transactionMovements.transactionNumber} = ${tx} and lower(${transactionMovements.kind}) = 'abono'), 0)`,
			pagoLedgerTotal: sql<number>`coalesce((select sum(${transactionMovements.amount}) from ${transactionMovements} where ${transactionMovements.transactionNumber} = ${tx} and lower(${transactionMovements.kind}) != 'abono'), 0)`,
		})
		.from(numerosRifa)
		.where(eq(numerosRifa.transactionNumber, tx));

	const r: any = rows?.[0] ?? {};
	const totalPrice = toInt(r.totalPrice);
	const paidCount = toInt(r.paidCount);
	const paidRowsCredit = includePaidRowsCredit ? toInt(r.paidRowsCredit) : 0;
	const abonoLedgerTotal = toInt(r.abonoLedgerTotal);
	const pagoLedgerTotal = toInt(r.pagoLedgerTotal);

	// Use ledger totals as primary source (authoritative).
	// Only fall back to paidRowsCredit if there are no ledger movements (backward compat for old data).
	const paymentCredit = pagoLedgerTotal > 0 ? pagoLedgerTotal : (includePaidRowsCredit ? paidRowsCredit : 0);
	const creditedTotal = abonoLedgerTotal + paymentCredit;
	const saldoPendiente = Math.max(0, totalPrice - creditedTotal);

	return {
		transactionNumber: tx,
		totalPrice,
		paidCount,
		paidRowsCredit,
		abonoLedgerTotal,
		pagoLedgerTotal,
		paymentCredit,
		creditedTotal,
		saldoPendiente,
	};
}
