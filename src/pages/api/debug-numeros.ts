import type { APIRoute } from 'astro';
import { db } from '../../db/client';
import { numerosRifa, events } from '../../db/schema';

export const GET: APIRoute = async () => {
  try {
    console.log('=== DEBUG: Leyendo todos los números en BD ===');
    
    // Obtener todos los números
    const allNumbers = await db.select().from(numerosRifa);
    console.log('Total de números en BD:', allNumbers.length);
    console.log('Primeros 10:', allNumbers.slice(0, 10));
    
    // Obtener números específicos
    const eventId1 = await db.select().from(numerosRifa).where(eq(numerosRifa.eventId, 1));
    console.log('Números con eventId=1:', eventId1.length);
    console.log('Primeros del evento 1:', eventId1.slice(0, 5));
    
    // Obtener números reservados
    const reservados = await db.select().from(numerosRifa).where(eq(numerosRifa.estado, 'reservado'));
    console.log('Números reservados:', reservados.length);
    console.log('Primeros reservados:', reservados.slice(0, 5));
    
    // Obtener eventos
    const allEvents = await db.select().from(events);
    console.log('Total eventos:', allEvents.length);
    console.log('Eventos:', allEvents);

    return new Response(JSON.stringify({ 
      allNumbers: allNumbers.length, 
      eventId1Numbers: eventId1.length,
      reservadosNumbers: reservados.length,
      eventos: allEvents,
      sample: {
        allNumbers: allNumbers.slice(0, 3),
        eventId1: eventId1.slice(0, 3),
        reservados: reservados.slice(0, 3)
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error en debug:', error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
};

import { eq } from 'drizzle-orm';
