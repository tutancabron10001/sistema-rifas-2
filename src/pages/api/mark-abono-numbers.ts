import type { APIRoute } from 'astro';
import { db } from '../../db/client';
import { numerosRifa, transactions, usuarios } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { enviarCorreoAbono } from '../../lib/email';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { numeros } = body; // Array de { numero, eventId, abono }

    if (!numeros || !Array.isArray(numeros) || numeros.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Datos inválidos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('=== PROCESANDO ABONOS ===');
    console.log('Datos recibidos:', JSON.stringify(numeros, null, 2));

    const resultados = [];

    // Actualizar estado de números
    for (const item of numeros) {
      const numeroValue = item.numero;
      const eventId = parseInt(item.eventId);
      const montoAbono = parseFloat(item.abono) || 0;

      console.log(`\n--- Procesando: Número ${numeroValue}, Event ${eventId}, Abono ${montoAbono} ---`);

      // Buscar el número en la base de datos
      const numerosData = await db
        .select()
        .from(numerosRifa)
        .where(eq(numerosRifa.numero, numeroValue))
        .all();

      console.log('Números encontrados:', numerosData.length);

      const numeroData = numerosData.find(n => n.eventId === eventId);

      if (!numeroData) {
        console.log(`ERROR: Número ${numeroValue} no encontrado para eventId ${eventId}`);
        continue;
      }

      console.log('Número encontrado:', { id: numeroData.id, numero: numeroData.numero, abonado: numeroData.abonado });
      
      const nuevoAbono = (numeroData.abonado || 0) + montoAbono;
      
      // Actualizar en la base de datos
      await db
        .update(numerosRifa)
        .set({ 
          estado: 'abonada',
          abonado: nuevoAbono
        })
        .where(eq(numerosRifa.id, numeroData.id))
        .run();

      console.log(`Número ${numeroValue} actualizado. Nuevo abono total: ${nuevoAbono}`);
      resultados.push({ numero: numeroValue, abono: nuevoAbono });

      // Enviar correo electrónico
      if (numeroData.transactionNumber) {
        console.log('Buscando transacción:', numeroData.transactionNumber);
        
        const transactionData = await db
          .select()
          .from(transactions)
          .where(eq(transactions.transactionNumber, numeroData.transactionNumber))
          .get();

        if (!transactionData) {
          console.log('ERROR: Transacción no encontrada');
          continue;
        }

        console.log('Transacción encontrada:', { cedula: transactionData.usuarioCedula });

        // Buscar usuario con Drizzle ORM
        const usuarioData = await db
          .select()
          .from(usuarios)
          .where(eq(usuarios.cedula, transactionData.usuarioCedula))
          .get();

        if (!usuarioData) {
          console.log('ERROR: Usuario no encontrado');
          continue;
        }

        console.log('Usuario encontrado:', { 
          nombre: usuarioData.primerNombre, 
          correo: usuarioData.correoElectronico 
        });

        if (!usuarioData.correoElectronico) {
          console.log('ERROR: Usuario no tiene correo electrónico');
          continue;
        }

        console.log('Enviando correo de abono a:', usuarioData.correoElectronico);
        
        // Enviar correo - NO usar await para no bloquear
        enviarCorreoAbono({
          usuarioNombre: `${usuarioData.primerNombre} ${usuarioData.primerApellido}`,
          usuarioCorreo: usuarioData.correoElectronico,
          transactionNumber: numeroData.transactionNumber,
          campaignName: transactionData.campaignName,
          eventName: transactionData.eventName,
          numero: numeroValue,
          montoAbono: montoAbono,
          totalAbonado: nuevoAbono,
          precioTotal: numeroData.precioSeleccionado,
          saldoPendiente: numeroData.precioSeleccionado - nuevoAbono,
          tipoPrecio: numeroData.tipoPrecio
        }).then((result) => {
          console.log('✅ Correo de abono enviado:', result);
        }).catch((error) => {
          console.error('❌ Error al enviar correo de abono:', error);
        });
      } else {
        console.log('AVISO: Número sin transactionNumber, no se envía correo');
      }
    }

    console.log('\n=== ABONOS PROCESADOS ===');
    console.log('Resultados:', resultados);

    return new Response(JSON.stringify({ success: true, count: resultados.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('ERROR en mark-abono-numbers:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Error desconocido' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
