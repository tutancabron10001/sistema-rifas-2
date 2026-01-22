import { db } from '../../db/client';
import { numerosRifa } from '../../db/schema';
import { eq } from 'drizzle-orm';

export async function POST({ request }: any) {
  try {
    const { transactionNumber } = await request.json();

    if (!transactionNumber) {
      return new Response(
        JSON.stringify({ error: 'Transacción requerida' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Actualizar todos los números de la transacción de 'reservado' a 'pago'
    await db
      .update(numerosRifa)
      .set({ estado: 'pago' })
      .where(eq(numerosRifa.transactionNumber, transactionNumber));

    return new Response(
      JSON.stringify({ success: true, message: 'Transacción marcada como pagada' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error marking payment:', error);
    return new Response(
      JSON.stringify({ error: 'Error al procesar pago' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
