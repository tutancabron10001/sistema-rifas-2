import { client, db } from '../db/client';
import { emailOutbox } from '../db/schema';
import { and, eq, inArray, like } from 'drizzle-orm';

export type EmailOutboxKind = 'reserva' | 'pago' | 'abono' | 'proof_rejected';

let ensured: Promise<void> | null = null;

async function ensureOutboxTable() {
  if (!ensured) {
    ensured = (async () => {
      // Self-healing: create table if it doesn't exist (helps in serverless without manual migrations)
      await client.execute(`
        CREATE TABLE IF NOT EXISTS email_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          sent_at TEXT
        );
      `);

      await client.execute(`CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);`);
      await client.execute(`CREATE INDEX IF NOT EXISTS idx_email_outbox_created_at ON email_outbox(created_at);`);
    })();
  }

  await ensured;
}

export async function queueEmail(kind: EmailOutboxKind, payload: unknown) {
  await ensureOutboxTable();

  const nowIso = new Date().toISOString();

  await db.insert(emailOutbox).values({
    kind,
    payloadJson: JSON.stringify(payload),
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    sentAt: null,
  });

  return { queued: true, kind };
}

async function hasQueuedEmail(kind: EmailOutboxKind, transactionNumber: string) {
  await ensureOutboxTable();

  const tx = String(transactionNumber || '').trim();
  if (!tx) return false;

  // NOTE: We store payload as JSON string. We dedupe by matching the transactionNumber field.
  // Transaction numbers are digits/short strings, so LIKE is safe enough here.
  const needle = `%"transactionNumber":"${tx}"%`;

  const rows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.kind, kind),
        inArray(emailOutbox.status, ['pending', 'processing', 'sent']),
        like(emailOutbox.payloadJson, needle)
      )
    )
    .limit(1);

  return rows.length > 0;
}

export async function queueEmailOnce(
  kind: EmailOutboxKind,
  payload: unknown,
  opts: { transactionNumber: string }
) {
  const tx = String(opts?.transactionNumber || '').trim();
  if (tx && (await hasQueuedEmail(kind, tx))) {
    return { queued: false, kind, skipped: true, reason: 'duplicate', transactionNumber: tx };
  }

  await queueEmail(kind, payload);
  return { queued: true, kind, skipped: false, transactionNumber: tx };
}

export async function processEmailOutbox() {
  await ensureOutboxTable();
  
  // Get pending emails (limit to avoid timeout)
  const pending = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.status, 'pending'))
    .limit(10);

  console.log(`[processEmailOutbox] Found ${pending.length} pending emails`);
  
  const results = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [] as Array<{ id: number; error: string }>,
  };

  for (const email of pending) {
    try {
      // Mark as processing
      await db
        .update(emailOutbox)
        .set({ 
          status: 'processing',
          attempts: email.attempts + 1,
          updatedAt: new Date().toISOString()
        })
        .where(eq(emailOutbox.id, email.id));

      const payload = JSON.parse(email.payloadJson);
      
      // Import email functions dynamically to avoid circular dependencies
      const { 
        enviarCorreoReserva, 
        enviarCorreoPago, 
        enviarCorreoAbono,
        enviarCorreoComprobanteRechazado 
      } = await import('./email.ts');

      // Send based on kind
      let sent = false;
      switch (email.kind) {
        case 'reserva':
          await enviarCorreoReserva(payload);
          sent = true;
          break;
        case 'pago':
          await enviarCorreoPago(payload);
          sent = true;
          break;
        case 'abono':
          await enviarCorreoAbono(payload);
          sent = true;
          break;
        case 'proof_rejected':
          await enviarCorreoComprobanteRechazado(payload);
          sent = true;
          break;
        default:
          throw new Error(`Unknown email kind: ${email.kind}`);
      }

      if (sent) {
        // Mark as sent
        await db
          .update(emailOutbox)
          .set({ 
            status: 'sent',
            sentAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastError: null
          })
          .where(eq(emailOutbox.id, email.id));
        
        results.sent++;
        console.log(`[processEmailOutbox] ✅ Sent ${email.kind} email (id=${email.id})`);
      }
      
      results.processed++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[processEmailOutbox] ❌ Failed to send email (id=${email.id}):`, errorMsg);
      
      // Mark as failed (or pending for retry if attempts < 3)
      const newStatus = email.attempts + 1 >= 3 ? 'failed' : 'pending';
      await db
        .update(emailOutbox)
        .set({ 
          status: newStatus,
          lastError: errorMsg,
          updatedAt: new Date().toISOString()
        })
        .where(eq(emailOutbox.id, email.id));
      
      results.failed++;
      results.errors.push({ id: email.id, error: errorMsg });
    }
  }
  
  console.log(`[processEmailOutbox] Results:`, results);
  return results;
}
