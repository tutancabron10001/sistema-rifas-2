import { db } from '../../db/client';
import { numerosRifa, usuarios, events, campaigns, transactions } from '../../db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { enviarCorreoReserva } from '../../lib/email';

export async function POST({ request }: any) {
  try {
    const body = await request.json();
    const { eventId, numeros, cedula, precioTotal, precioNormal, precioPromo, precioNormalTotal, precioPromoTotal, promociones, cantidadNormal, cantidadPromo } = body;

    if (!eventId || !numeros || !Array.isArray(numeros) || numeros.length === 0 || !cedula) {
      return new Response(
        JSON.stringify({ error: 'Datos incompletos' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verificar que todos los números existen
    const existingNumbers = await db
      .select()
      .from(numerosRifa)
      .where(
        and(
          eq(numerosRifa.eventId, parseInt(eventId)),
          inArray(numerosRifa.numero, numeros)
        )
      );

    if (existingNumbers.length !== numeros.length) {
      return new Response(
        JSON.stringify({ error: 'Algunos números no existen en este evento' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verificar que TODOS los números están disponibles ANTES de reservar cualquiera
    const unavailableNumbers = existingNumbers.filter(n => n.estado !== 'disponible');
    
    if (unavailableNumbers.length > 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Algunos números ya no están disponibles',
          unavailableNumbers: unavailableNumbers.map(n => n.numero),
          requestedCount: numeros.length,
          conflictCount: unavailableNumbers.length
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Si llegamos aquí, todos están disponibles - proceder a reservar
    // Aplicar promoción a los primeros números (múltiplo de 3)
    const updatedNumbers = [];
    const normalCount = cantidadNormal || (numeros.length % 3);
    const promoCount = cantidadPromo || (Math.floor(numeros.length / 3) * 3);
    
    for (let i = 0; i < numeros.length; i++) {
      const numero = numeros[i];
      // Aplicar promoción a los últimos (promoCount) números, normales a los primeros
      const isPromo = i >= normalCount;
      const selectedPrice = isPromo ? precioPromo : precioNormal;
      const tipoPrecio = isPromo ? 'promocion' : 'normal';

      const result = await db
        .update(numerosRifa)
        .set({
          estado: 'reservado',
          numeroIdentificacion: cedula,
          precioSeleccionado: selectedPrice,
          tipoPrecio: tipoPrecio,
          abonado: 0
        })
        .where(
          and(
            eq(numerosRifa.eventId, parseInt(eventId)),
            eq(numerosRifa.numero, numero),
            eq(numerosRifa.estado, 'disponible')
          )
        )
        .returning();

      if (result.length > 0) {
        updatedNumbers.push(result[0]);
      }
    }

    if (updatedNumbers.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Error al reservar los números. Intenta nuevamente.',
          unavailableNumbers: numeros
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    // Obtener información del usuario, evento y campaña
    const usuario = await db.select().from(usuarios).where(eq(usuarios.cedula, cedula)).limit(1);
    const evento = await db.select().from(events).where(eq(events.id, parseInt(eventId))).limit(1);
    const campaignInfo = evento.length > 0
      ? await db.select().from(campaigns).where(eq(campaigns.id, evento[0].campaignId)).limit(1)
      : [];

    // Generar número de transacción (0001, 0002...)
    let transactionNumber = '0001';
    const lastTx = await db.select().from(transactions).orderBy(desc(transactions.id)).limit(1);
    if (lastTx.length > 0) {
      const lastNum = parseInt(lastTx[0].transactionNumber, 10) || 0;
      transactionNumber = String(lastNum + 1).padStart(4, '0');
    }

    // Crear transacción
    const nowIso = new Date().toISOString();
    const nombreCompleto = usuario.length > 0
      ? `${usuario[0].primerNombre} ${usuario[0].segundoNombre || ''} ${usuario[0].primerApellido} ${usuario[0].segundoApellido}`.trim()
      : '';

    await db.insert(transactions).values({
      transactionNumber,
      usuarioCedula: usuario.length > 0 ? usuario[0].cedula : cedula,
      usuarioNombre: nombreCompleto || 'Usuario',
      campaignName: campaignInfo.length > 0 ? campaignInfo[0].name : 'Campaña',
      eventId: parseInt(eventId),
      eventName: evento.length > 0 ? evento[0].name : 'Evento',
      cantidad: updatedNumbers.length,
      promociones: promociones || 0,
      precioTotal: precioTotal,
      createdAt: nowIso,
    });

    // Marcar los números con el número de transacción
    await db
      .update(numerosRifa)
      .set({ transactionNumber })
      .where(
        and(
          eq(numerosRifa.eventId, parseInt(eventId)),
          inArray(numerosRifa.numero, updatedNumbers.map(n => n.numero))
        )
      );

    // Enviar correo si hay datos del usuario y correo disponible
    if (usuario.length > 0 && evento.length > 0 && campaignInfo.length > 0 && usuario[0].correoElectronico) {
      const fechaReserva = new Date().toLocaleDateString('es-CO', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      const fechaRifa = new Date(evento[0].raffleDate).toLocaleDateString('es-CO', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });

      enviarCorreoReserva({
        to: usuario[0].correoElectronico,
        nombreCompleto,
        cedula: usuario[0].cedula,
        transactionNumber,
        campaignName: campaignInfo[0].name,
        eventId: evento[0].id,
        eventName: evento[0].name,
        numeros: updatedNumbers.map(n => n.numero),
        cantidad: updatedNumbers.length,
        promociones: promociones || 0,
        precioNormal: precioNormal || 0,
        precioPromo: precioPromo || 0,
        precioTotal,
        fechaReserva,
        fechaRifa
      }).catch(err => console.error('Error enviando correo:', err));
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `${updatedNumbers.length} número(s) reservado(s) exitosamente`,
        reservedNumbers: updatedNumbers.map(n => n.numero),
        totalPrice: precioTotal,
        transactionNumber,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error reserving numbers:', error);
    return new Response(
      JSON.stringify({ error: 'Error al reservar números' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
