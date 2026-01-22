import type { APIRoute } from 'astro';
import { db } from '../../db/client';
import { numerosRifa, transactions, usuarios, events, campaigns } from '../../db/schema';
import { and, eq } from 'drizzle-orm';
import { enviarCorreoPago } from '../../lib/email';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { numeros } = await request.json();
    console.log('API mark-payment-numbers - Datos recibidos:', { numeros });
    
    if (!numeros || !Array.isArray(numeros) || numeros.length === 0) {
      console.log('Error: Números no proporcionados o inválidos');
      return new Response(JSON.stringify({ error: 'Números no proporcionados' }), { status: 400 });
    }

    let count = 0;
    const numerosPagados: Array<{ numero: number; tipoPrecio: string; precioSeleccionado: number }> = [];
    let transactionNumber = '';
    let eventId = 0;
    let cedula = '';
    
    // Actualizar cada número individualmente y recopilar datos
    for (const item of numeros) {
      const numeroValue = item.numero; // Mantener como string
      const eventIdValue = parseInt(item.eventId, 10);
      
      console.log(`Procesando número ${numeroValue}, eventId ${eventIdValue}`);
      
      if (!numeroValue || !eventIdValue) continue;
      
      // Obtener info del número antes de actualizar (puede estar reservado o abonada)
      const numData = await db.select()
        .from(numerosRifa)
        .where(
          and(
            eq(numerosRifa.numero, numeroValue),
            eq(numerosRifa.eventId, eventIdValue)
          )
        )
        .limit(1);
      
      console.log(`Datos encontrados para número ${numeroValue}:`, numData);
      
      if (numData.length > 0) {
        const numRow = numData[0];
        // Solo procesar si está reservado o abonada
        if (numRow.estado === 'reservado' || numRow.estado === 'abonada') {
          numerosPagados.push({
            numero: numRow.numero,
            tipoPrecio: numRow.tipoPrecio || 'normal',
            precioSeleccionado: numRow.precioSeleccionado || 0,
            abonado: numRow.abonado || 0
          });
          
          // Guardar datos de la transacción del primer número
          if (count === 0) {
            transactionNumber = numRow.transactionNumber || '';
            eventId = eventIdValue;
          }
          
          // Actualizar a pago (funciona para reservado y abonada)
          await db.update(numerosRifa)
            .set({ estado: 'pago' })
            .where(
              and(
                eq(numerosRifa.numero, numeroValue),
                eq(numerosRifa.eventId, eventIdValue)
              )
            );
          
          count++;
        }
      }
    }

    console.log(`${count} números actualizados a estado PAGO`);
    console.log('Números pagados:', numerosPagados);

    // Obtener datos del usuario desde la transacción para el correo
    if (transactionNumber && numerosPagados.length > 0) {
      console.log('Preparando correo para transacción:', transactionNumber);
      
      const txData = await db.select().from(transactions).where(eq(transactions.transactionNumber, transactionNumber)).limit(1);
      console.log('Datos de transacción encontrados:', txData);
      
      if (txData.length > 0) {
        cedula = txData[0].usuarioCedula || '';
        const usuario = await db.select().from(usuarios).where(eq(usuarios.cedula, cedula)).limit(1);
        const evento = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
        const campaign = evento.length > 0 
          ? await db.select().from(campaigns).where(eq(campaigns.id, evento[0].campaignId)).limit(1)
          : [];

      console.log('Datos para correo:', { 
        usuarioEncontrado: usuario.length > 0, 
        eventoEncontrado: evento.length > 0,
        campaignEncontrada: campaign.length > 0,
        correo: usuario[0]?.correoElectronico 
      });

      if (usuario.length > 0 && evento.length > 0 && campaign.length > 0 && usuario[0].correoElectronico) {
        const nombreCompleto = `${usuario[0].primerNombre} ${usuario[0].segundoNombre || ''} ${usuario[0].primerApellido} ${usuario[0].segundoApellido}`.trim();
        const totalPrecio = numerosPagados.reduce((sum, n) => sum + n.precioSeleccionado, 0);
        const totalAbonado = numerosPagados.reduce((sum, n) => sum + (n.abonado || 0), 0);
        const totalPagado = totalPrecio - totalAbonado;
        
        const fechaPago = new Date().toLocaleDateString('es-CO', { 
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

        console.log('Enviando correo a:', usuario[0].correoElectronico);
        
        // Enviar correo de confirmación de pago con factura (sin bloquear)
        enviarCorreoPago({
          to: usuario[0].correoElectronico,
          nombreCompleto,
          cedula: usuario[0].cedula,
          transactionNumber: transactionNumber,
          campaignName: campaign[0].name,
          eventId: evento[0].id,
          eventName: evento[0].name,
          numerosPagados,
          totalPrecio,
          totalAbonado,
          totalPagado,
          fechaPago,
          fechaRifa
        }).then((result) => {
          console.log('Resultado envío de correo:', result);
        }).catch((err) => {
          console.error('Error al enviar correo:', err);
        });
      } else {
        console.log('No se envió correo - datos incompletos');
      }
      } else {
        console.log('No se encontraron datos de transacción');
      }
    } else {
      console.log('No se envió correo - sin transacción o sin números pagados');
    }

    console.log('Respuesta exitosa, count:', count);
    return new Response(JSON.stringify({ success: true, count }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error completo en mark-payment-numbers:', error);
    return new Response(JSON.stringify({ error: 'Error al procesar la solicitud: ' + String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
