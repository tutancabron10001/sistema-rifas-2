import type { APIRoute } from 'astro';
import { db } from '../../db/client';
import { campaigns, events, numerosRifa } from '../../db/schema';
import { sql } from 'drizzle-orm';

export const GET: APIRoute = async () => {
  try {
    // Check tables
    const tables = await db.execute(sql`SELECT name FROM sqlite_master WHERE type='table'`);
    
    // Get campaigns
    const campaignsList = await db.select().from(campaigns);
    
    // Get events
    const eventsList = await db.select().from(events);

    // Get numeros count
    const numerosCount = await db.execute(sql`SELECT COUNT(*) as total FROM numeros_rifa`);
    const numerosEstado = await db.execute(sql`SELECT estado, COUNT(*) as count FROM numeros_rifa GROUP BY estado`);

    return new Response(JSON.stringify({
      tables: tables.rows,
      campaigns: campaignsList,
      events: eventsList,
      numerosRifa: {
        total: numerosCount.rows[0],
        porEstado: numerosEstado.rows
      },
      dbPath: process.env.DATABASE_URL || 'file:./data/db.sqlite'
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
