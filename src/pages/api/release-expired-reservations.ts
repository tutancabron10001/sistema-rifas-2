import type { APIRoute } from 'astro';
import { releaseExpiredReservations } from '../../lib/release-expired-reservations';

async function handleRelease(eventId?: string) {
  if (eventId) {
    await releaseExpiredReservations({ eventId: parseInt(eventId) });
  } else {
    // Release for all events if no specific eventId provided
    await releaseExpiredReservations({});
  }

  return new Response(
    JSON.stringify({ success: true, message: 'Expired reservations released' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const eventId = url.searchParams.get('eventId') || undefined;
    return await handleRelease(eventId);
  } catch (error) {
    console.error('Error releasing expired reservations:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const eventId = body?.eventId ? String(body.eventId) : undefined;
    return await handleRelease(eventId);
  } catch (error) {
    console.error('Error releasing expired reservations:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
