import { db } from '../../db/client';
import { numerosRifa } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { releaseExpiredReservations } from '../../lib/release-expired-reservations';

export async function GET({ request }: any) {
  try {
    const url = new URL(request.url);
    const eventId = url.searchParams.get('eventId');
    const numero = url.searchParams.get('numero');

    if (!eventId || !numero) {
      return new Response(
        JSON.stringify({ error: 'EventId y numero son requeridos' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Best-effort: free expired reserved numbers before reporting current status.
    try {
      await releaseExpiredReservations({ eventId: parseInt(eventId) });
    } catch (e) {
      console.warn('Auto-release skipped:', e);
    }

    const result = await db
      .select()
      .from(numerosRifa)
      .where(
        and(
          eq(numerosRifa.eventId, parseInt(eventId)),
          eq(numerosRifa.numero, numero)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return new Response(
        JSON.stringify({ exists: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        exists: true, 
        estado: result[0].estado,
        numero: result[0].numero
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error checking numero:', error);
    return new Response(
      JSON.stringify({ error: 'Error al verificar número' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
