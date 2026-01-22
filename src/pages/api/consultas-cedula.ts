import { db } from '../../db/client';
import { transactions, numerosRifa, events, usuarios } from '../../db/schema';
import { and, eq, desc, like, sql, inArray } from 'drizzle-orm';

export async function GET({ request }: any) {
  try {
    const url = new URL(request.url);
    const cedula = url.searchParams.get('cedula');
    const campaignFilter = url.searchParams.get('campaignId');
    const eventNameFilter = url.searchParams.get('eventName');
    const txFilter = url.searchParams.get('transactionNumber');

    // Al menos un filtro requerido
    if (!cedula && !eventNameFilter && !txFilter && !campaignFilter) {
      return new Response(
        JSON.stringify({ error: 'Ingresa cédula, evento, transacción o campaña para consultar' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const filters: any[] = [inArray(numerosRifa.estado, ['reservado', 'abonada'])];
    if (cedula) filters.push(eq(transactions.usuarioCedula, cedula));
    if (campaignFilter) filters.push(eq(events.campaignId, parseInt(campaignFilter)));
    if (eventNameFilter) filters.push(like(events.name, `%${eventNameFilter}%`));
    if (txFilter) filters.push(eq(transactions.transactionNumber, txFilter));

    const rows = await db
      .select({
        transactionNumber: transactions.transactionNumber,
        fechaTransaccion: transactions.createdAt,
        usuarioNombre: sql`coalesce(${transactions.usuarioNombre}, ${usuarios.primerNombre} || ' ' || ${usuarios.primerApellido})`,
        usuarioCorreo: usuarios.correoElectronico,
        usuarioTelefono: usuarios.telefono,
        campaignName: transactions.campaignName,
        eventId: transactions.eventId,
        eventName: events.name,
        numero: numerosRifa.numero,
        estado: numerosRifa.estado,
        precioSeleccionado: numerosRifa.precioSeleccionado,
        tipoPrecio: numerosRifa.tipoPrecio,
        abonado: numerosRifa.abonado,
        raffleDate: events.raffleDate,
      })
      .from(transactions)
      .leftJoin(numerosRifa, eq(numerosRifa.transactionNumber, transactions.transactionNumber))
      .leftJoin(events, eq(events.id, transactions.eventId))
      .leftJoin(usuarios, eq(usuarios.cedula, transactions.usuarioCedula))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(transactions.createdAt));

    // Fallback: if no transactionNumber, still attempt to match by numeroIdentificacion
    let extraRows = [] as typeof rows;
    if (rows.length === 0 && cedula) {
      extraRows = await db
        .select({
          transactionNumber: numerosRifa.transactionNumber,
          fechaTransaccion: numerosRifa.createdAt,
          usuarioNombre: sql`${usuarios.primerNombre} || ' ' || ${usuarios.primerApellido}`,
          usuarioCorreo: usuarios.correoElectronico,
          usuarioTelefono: usuarios.telefono,
          campaignName: sql`''`,
          eventId: numerosRifa.eventId,
          eventName: events.name,
          numero: numerosRifa.numero,
          estado: numerosRifa.estado,
          precioSeleccionado: numerosRifa.precioSeleccionado,
          tipoPrecio: numerosRifa.tipoPrecio,
          abonado: numerosRifa.abonado,
          raffleDate: events.raffleDate,
        })
        .from(numerosRifa)
        .leftJoin(events, eq(events.id, numerosRifa.eventId))
        .leftJoin(usuarios, eq(usuarios.cedula, numerosRifa.numeroIdentificacion))
        .where(and(
          eq(numerosRifa.numeroIdentificacion, cedula),
          inArray(numerosRifa.estado, ['reservado', 'abonada'])
        ))
        .orderBy(desc(numerosRifa.createdAt));
    }

    const result = rows.length > 0 ? rows : extraRows;

    return new Response(JSON.stringify({ movimientos: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error en consultas-cedula:', error);
    return new Response(
      JSON.stringify({ error: 'Error interno' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
