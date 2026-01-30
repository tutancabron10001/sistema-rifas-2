import type { APIRoute } from 'astro';
import { db } from '../../../db/client';
import { transactions } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { maybeStartPromoGraceWindow } from '../../../lib/promo-grace';

function isAdminRequest(request: Request) {
	const cookie = request.headers.get('cookie') || '';
	return cookie.includes('admin_session=');
}

export const POST: APIRoute = async ({ request }) => {
	try {
		if (!isAdminRequest(request)) {
			return new Response(JSON.stringify({ error: 'No autorizado' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const body = await request.json().catch(() => null);
		const transactionNumber = String(body?.transactionNumber || '').trim();
		if (!transactionNumber) {
			return new Response(JSON.stringify({ error: 'transactionNumber requerido' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const tx = await db
			.select({ eventId: transactions.eventId })
			.from(transactions)
			.where(eq(transactions.transactionNumber, transactionNumber))
			.limit(1)
			.then((r) => (r.length ? r[0] : null));

		if (!tx) {
			return new Response(JSON.stringify({ error: 'Transacción no encontrada' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const result = await maybeStartPromoGraceWindow({
			transactionNumber,
			eventId: Number((tx as any).eventId),
		});

		return new Response(JSON.stringify({ ok: true, result }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Error admin/grant-promo-grace:', error);
		return new Response(JSON.stringify({ error: 'Error interno' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
