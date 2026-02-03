import type { APIRoute } from 'astro';
import { processEmailOutbox } from '../../lib/email-outbox';

const emailOutboxDisabled =
  String(import.meta.env.DISABLE_EMAIL_OUTBOX || process.env.DISABLE_EMAIL_OUTBOX || '') === '1';

async function handleProcess() {
  if (emailOutboxDisabled) {
    return new Response(
      JSON.stringify({ success: true, message: 'Email outbox disabled' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  await processEmailOutbox();
  
  return new Response(
    JSON.stringify({ success: true, message: 'Email outbox processed' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export const GET: APIRoute = async () => {
  try {
    return await handleProcess();
  } catch (error) {
    console.error('Error processing email outbox:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async () => {
  try {
    return await handleProcess();
  } catch (error) {
    console.error('Error processing email outbox:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
