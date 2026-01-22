import { db } from '../../db/client';
import { numerosRifa, events, usuarios } from '../../db/schema';
import { and, eq, like, inArray } from 'drizzle-orm';

export async function GET({ url }: any) {
  try {
    const campaignIdParam = url.searchParams.get('campaignId');
    const eventNameParam = url.searchParams.get('eventName');

    const filters: any[] = [inArray(numerosRifa.estado, ['reservado', 'abonada', 'pago'])];

    // Filtrar por campaña
    if (campaignIdParam) {
      const eventsInCampaign = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.campaignId, parseInt(campaignIdParam)));
      const eventIds = eventsInCampaign.map(e => e.id);
      if (eventIds.length > 0) {
        filters.push(inArray(numerosRifa.eventId, eventIds));
      }
    }

    // Filtrar por evento (nombre)
    if (eventNameParam) {
      const matchingEvents = await db
        .select({ id: events.id })
        .from(events)
        .where(like(events.name, `%${eventNameParam}%`));
      const eventIds = matchingEvents.map(e => e.id);
      if (eventIds.length > 0) {
        filters.push(inArray(numerosRifa.eventId, eventIds));
      } else {
        return new Response(
          JSON.stringify({ movimientos: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const rows = await db
      .select({
        eventName: events.name,
        numero: numerosRifa.numero,
        estado: numerosRifa.estado,
        tipoPrecio: numerosRifa.tipoPrecio,
        precioSeleccionado: numerosRifa.precioSeleccionado,
        abonado: numerosRifa.abonado,
        cedula: numerosRifa.numeroIdentificacion,
        transactionNumber: numerosRifa.transactionNumber,
        usuarioNombre: usuarios.primerNombre,
        usuarioCorreo: usuarios.correoElectronico,
        usuarioTelefono: usuarios.telefono,
        createdAt: numerosRifa.createdAt,
      })
      .from(numerosRifa)
      .leftJoin(events, eq(events.id, numerosRifa.eventId))
      .leftJoin(usuarios, eq(usuarios.cedula, numerosRifa.numeroIdentificacion))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(numerosRifa.createdAt);

    return new Response(
      JSON.stringify({ movimientos: rows }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching reservados-pagos:', error);
    return new Response(
      JSON.stringify({ error: 'Error al consultar' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
