import type { APIRoute } from 'astro';
import { db } from '../../../db/client';
import { campaigns, events, numerosRifa } from '../../../db/schema';

export const POST: APIRoute = async ({ redirect }) => {
  try {
    await db.delete(numerosRifa);
    await db.delete(events);
    await db.delete(campaigns);
    return redirect('/admin/campanas');
  } catch (error) {
    return new Response('Error al eliminar campañas: ' + String(error), { status: 500 });
  }
};
