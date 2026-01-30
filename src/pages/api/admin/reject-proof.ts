import type { APIRoute } from 'astro';
import { db } from '../../../db/client';
import { transactionProofs, transactions, usuarios } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { queueEmailOnce } from '../../../lib/email-outbox';

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

    const body = await request.json().catch(() => ({}));
    const proofId = Number(body?.proofId ?? 0);
    const reason = String(body?.reason || '').trim() || 'No se especificó motivo';

    if (!Number.isFinite(proofId) || proofId <= 0) {
      return new Response(JSON.stringify({ error: 'ID de comprobante inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get proof details before rejection
    const proofs = await db
      .select()
      .from(transactionProofs)
      .where(eq(transactionProofs.id, proofId))
      .limit(1);

    const proof = proofs[0];
    if (!proof) {
      return new Response(JSON.stringify({ error: 'Comprobante no encontrado' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get transaction and user details for email
    const txRows = await db
      .select({
        transactionNumber: transactions.transactionNumber,
        usuarioCedula: transactions.usuarioCedula,
        usuarioNombre: transactions.usuarioNombre,
        campaignName: transactions.campaignName,
        eventId: transactions.eventId,
        eventName: transactions.eventName,
        correoElectronico: usuarios.correoElectronico,
      })
      .from(transactions)
      .leftJoin(usuarios, eq(usuarios.cedula, transactions.usuarioCedula))
      .where(eq(transactions.transactionNumber, proof.transactionNumber))
      .limit(1);

    const tx = txRows[0];
    if (!tx) {
      return new Response(JSON.stringify({ error: 'Transacción no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update proof status to rejected
    const nowIso = new Date().toISOString();
    await db
      .update(transactionProofs)
      .set({
        status: 'rejected',
        rejectedAt: nowIso,
        rejectReason: reason,
      })
      .where(eq(transactionProofs.id, proofId));

    console.log(`[reject-proof] Comprobante #${proofId} rechazado. Motivo: ${reason}`);

    // Queue rejection email notification
    try {
      const emailPayload = {
        to: tx.correoElectronico || '',
        nombreCompleto: tx.usuarioNombre || 'Usuario',
        cedula: tx.usuarioCedula || '',
        transactionNumber: proof.transactionNumber,
        campaignName: tx.campaignName || '',
        eventId: tx.eventId || 0,
        eventName: tx.eventName || '',
        proof: {
          kind: proof.kind || '',
          amount: proof.amount,
          url: proof.cloudinaryUrl || '',
          createdAt: proof.createdAt || nowIso,
        },
        reason,
        rejectedAt: nowIso,
      };

      if (emailPayload.to) {
        await queueEmailOnce('proof_rejected', emailPayload, {
          transactionNumber: proof.transactionNumber,
        });
        console.log(`[reject-proof] Email de rechazo encolado para tx=${proof.transactionNumber}`);
      } else {
        console.warn(`[reject-proof] No se pudo enviar email: sin correo para tx=${proof.transactionNumber}`);
      }
    } catch (emailError) {
      console.error('[reject-proof] Error encolando email:', emailError);
      // Don't fail the rejection if email queuing fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        proofId,
        transactionNumber: proof.transactionNumber,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[reject-proof] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Error interno del servidor' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
