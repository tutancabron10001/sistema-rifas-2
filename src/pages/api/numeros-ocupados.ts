import { db } from '../../db/client';
import { numerosRifa } from '../../db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { releaseExpiredReservations } from '../../lib/release-expired-reservations';

export async function GET({ request }: any) {
  try {
    const url = new URL(request.url);
    const eventId = url.searchParams.get('eventId');

    if (!eventId) {
      return new Response(
        JSON.stringify({ error: 'EventId es requerido' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Best-effort: free expired reserved numbers before computing occupied list.
    try {
      await releaseExpiredReservations({ eventId: parseInt(eventId) });
    } catch (e) {
      console.warn('Auto-release skipped:', e);
    }

    // Obtener todos los números que NO están disponibles
    const ocupados = await db
      .select({ numero: numerosRifa.numero })
      .from(numerosRifa)
      .where(
        and(
          eq(numerosRifa.eventId, parseInt(eventId)),
          ne(numerosRifa.estado, 'disponible')
        )
      );

    return new Response(
      JSON.stringify({ 
        numerosOcupados: ocupados.map(n => n.numero)
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error getting occupied numbers:', error);
    return new Response(
      JSON.stringify({ error: 'Error al obtener números ocupados' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
