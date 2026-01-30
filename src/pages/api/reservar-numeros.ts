import { client, db } from '../../db/client';
import { numerosRifa, usuarios, events, campaigns, transactions, transactionProofs, transactionMovements } from '../../db/schema';
import { eq, and, inArray, desc, gt, isNotNull, sql } from 'drizzle-orm';
import { queueEmail } from '../../lib/email-outbox';
import { releaseExpiredReservations } from '../../lib/release-expired-reservations';
import { v2 as cloudinary } from 'cloudinary';
import { ensureTransactionProofsTable } from '../../lib/transaction-proofs';
import { ensurePromoPackColumns, getPromoWindowIso, promoPackSize } from '../../lib/promo-pack';
import { finalizePromoPacks } from '../../lib/finalize-promo-packs';
import { ensureTransactionMovementsTable } from '../../lib/transaction-movements';
import { getTxLedgerSummary } from '../../lib/tx-ledger';

cloudinary.config({
  cloud_name: import.meta.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME,
  api_key: import.meta.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY,
  api_secret: import.meta.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRET,
});

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB
const RESERVATION_TTL_MS = 5 * 60 * 1000;

function uploadBufferToCloudinary(buffer: Buffer, folder: string) {
  return new Promise<{ secureUrl: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve({ secureUrl: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

function inferMinAbono(hasPromo: boolean, _cantidad: number) {
  // Regla de negocio: abono mínimo para boletas normales $10.000 COP,
  // y para promociones $20.000 COP.
  return hasPromo ? 20000 : 10000;
}

function computeAdjustedUnitForGraceCompletion(opts: {
  promoUnit: number;
  packSize: number;
  existingQty: number;
  normalUnit: number;
  missing: number;
}) {
  const promoTotal = (Number(opts.promoUnit || 0) || 0) * (Number(opts.packSize || 0) || 0);
  const existingTotal = (Number(opts.existingQty || 0) || 0) * (Number(opts.normalUnit || 0) || 0);
  const missing = Math.max(1, Number(opts.missing || 0) || 1);
  const raw = (promoTotal - existingTotal) / missing;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

export async function POST({ request }: any) {
  try {
    const contentType = String(request.headers.get('content-type') || '');
    let body: any;
    let proofKind: 'pago' | 'abono' | null = null;
    let proofAmount: number | null = null;
    let proofFile: File | null = null;
    let abonoAllocations: number[] | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      body = {
        eventId: String(form.get('eventId') ?? '').trim(),
        numeros: (() => {
          const raw = String(form.get('numeros') ?? '[]');
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })(),
        cedula: String(form.get('cedula') ?? '').trim(),
        precioTotal: Number(String(form.get('precioTotal') ?? '0')),
        precioNormal: Number(String(form.get('precioNormal') ?? '0')),
        precioPromo: Number(String(form.get('precioPromo') ?? '0')),
        precioNormalTotal: Number(String(form.get('precioNormalTotal') ?? '0')),
        precioPromoTotal: Number(String(form.get('precioPromoTotal') ?? '0')),
        promociones: Number(String(form.get('promociones') ?? '0')),
        cantidadNormal: Number(String(form.get('cantidadNormal') ?? '0')),
        cantidadPromo: Number(String(form.get('cantidadPromo') ?? '0')),
      };

      const kindRaw = String(form.get('kind') ?? '').trim();
      if (kindRaw === 'pago' || kindRaw === 'abono') {
        proofKind = kindRaw;
      }

      const amountRaw = form.get('amount');
      const amountStr = amountRaw == null ? '' : String(amountRaw).trim();
      proofAmount = amountStr === '' ? null : Number(amountStr);

      const allocRaw = String(form.get('abonoAllocations') ?? '').trim();
      if (allocRaw) {
        try {
          const parsed = JSON.parse(allocRaw);
          if (Array.isArray(parsed)) {
            abonoAllocations = parsed.map((x) => Number(x)).map((n) => (Number.isFinite(n) ? n : 0));
          }
        } catch {
          abonoAllocations = null;
        }
      }

      const file = form.get('file');
      proofFile = file instanceof File ? file : null;
    } else {
      body = await request.json();
      const alloc = (body as any)?.abonoAllocations;
      if (Array.isArray(alloc)) {
        abonoAllocations = alloc.map((x: any) => Number(x)).map((n: number) => (Number.isFinite(n) ? n : 0));
      }
    }

    const { eventId, numeros, cedula, precioTotal, precioNormal, precioPromo, precioNormalTotal, precioPromoTotal, promociones, cantidadNormal, cantidadPromo } = body;

    if (!eventId || !numeros || !Array.isArray(numeros) || numeros.length === 0 || !cedula) {
      return new Response(
        JSON.stringify({ error: 'Datos incompletos' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

  // Load event/campaign early (needed for promo pack rules)
  const evento = await db.select().from(events).where(eq(events.id, parseInt(eventId))).limit(1);
  if (evento.length === 0) {
    return new Response(JSON.stringify({ error: 'Evento no encontrado' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  const eventRow = evento[0];
  const campaignInfo = await db.select().from(campaigns).where(eq(campaigns.id, eventRow.campaignId)).limit(1);

  // Load user early (we need the real name for transactions)
  const usuario = await db.select().from(usuarios).where(eq(usuarios.cedula, cedula)).limit(1);
  const nombreCompleto = usuario.length > 0
    ? `${usuario[0].primerNombre} ${usuario[0].segundoNombre || ''} ${usuario[0].primerApellido} ${usuario[0].segundoApellido}`.trim()
    : 'Usuario';

  await ensurePromoPackColumns();
  // Consistency hook: finalize promo packs at cutoff window (raffle - 1 day)
  try {
    await finalizePromoPacks({ eventId: parseInt(eventId) });
  } catch (e) {
    console.warn('Promo finalize skipped:', e);
  }

  const nowIso = new Date().toISOString();
  const packSize = promoPackSize();
  const promoEligible = Number(eventRow.price || 0) > 20000 && eventRow.promoPrice != null;
  const promoUnit = Number(eventRow.promoPrice || 0) || 0;

  // Detect active promo window: user has an open grace period to complete to next multiple of 3
  const promoTxCandidate = promoEligible
    ? await db
        .select({
          transactionNumber: transactions.transactionNumber,
          promoExpiresAt: transactions.promoExpiresAt,
          cantidad: transactions.cantidad,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.eventId, parseInt(eventId)),
            eq(transactions.usuarioCedula, cedula),
            isNotNull(transactions.promoExpiresAt),
            gt(transactions.promoExpiresAt, nowIso),
            gt(transactions.cantidad, 0)
          )
        )
        .orderBy(desc(transactions.promoExpiresAt))
        .limit(1)
        .then((rows) => (rows.length ? rows[0] : null))
    : null;

  let promoJoinTxNumber: string | null = null;
  let promoJoinTargetQty = 0;
  let promoJoinRequiredAdditional = 0;
  if (promoTxCandidate && promoEligible) {
    promoJoinTxNumber = String(promoTxCandidate.transactionNumber);
    const qty = Math.max(0, Number(promoTxCandidate.cantidad ?? 0) || 0);
    const targetQty = Math.ceil(qty / packSize) * packSize;
    promoJoinTargetQty = targetQty;
    promoJoinRequiredAdditional = Math.max(0, targetQty - qty);
    if (promoJoinRequiredAdditional <= 0) {
      promoJoinTxNumber = null;
    }
  }

  // Nota: ABONO ahora se permite incluso si se crean múltiples transacciones.
  // Para discriminar montos por transacción con una sola imagen, el cliente envía abonoAllocations[].

  // Validación temprana: si ABONO y se esperan múltiples transacciones, exigir montos por transacción.
  if (proofKind === 'abono') {
    const selectionCount = Array.isArray(numeros) ? numeros.length : 0;
    let expectedTxCount = 1;

    if (promoJoinTxNumber && promoEligible && promoJoinRequiredAdditional > 0) {
      const graceFill = Math.min(selectionCount, promoJoinRequiredAdditional);
      const remaining = Math.max(0, selectionCount - graceFill);
      const promoChunks = Math.floor(remaining / packSize);
      const normalLeft = remaining % packSize;
      expectedTxCount = 1 + promoChunks + normalLeft;
    } else if (promoEligible) {
      const promoChunks = Math.floor(selectionCount / packSize);
      const normalLeft = selectionCount % packSize;
      expectedTxCount = promoChunks + (normalLeft > 0 ? 1 : 0);
      if (expectedTxCount <= 0) expectedTxCount = 1;
    }

    if (expectedTxCount > 1) {
      if (!abonoAllocations) {
        return new Response(
          JSON.stringify({
            error: 'Para abonar con varias transacciones debes indicar el monto por transacción (con una sola imagen).',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (Array.isArray(abonoAllocations) && abonoAllocations.length < expectedTxCount) {
        return new Response(
          JSON.stringify({
            error: `Faltan montos para discriminar por transacción (esperadas: ${expectedTxCount}).`,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
  }

  // Nota: la ventana de gracia promo YA NO inicia al reservar.
  // Inicia cuando el admin valida dinero (transaction_movements).

    if (proofKind) {
      if (!proofFile) {
        return new Response(JSON.stringify({ error: 'Archivo requerido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (proofFile.size > MAX_FILE_BYTES) {
        return new Response(JSON.stringify({ error: 'Archivo muy grande (máx 8MB)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (proofKind === 'abono') {
        // Validación detallada se hace luego de conocer cuántas transacciones se crean.
        // Para una sola transacción se acepta amount; para múltiples, se debe enviar abonoAllocations.
        if (abonoAllocations == null) {
          if (proofAmount == null || !Number.isFinite(proofAmount)) {
            return new Response(JSON.stringify({ error: 'amount requerido para abono' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          }
          if (proofAmount <= 0) {
            return new Response(JSON.stringify({ error: 'amount inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          }
        }
      }
    }

    // Consistency rule: always release expired reservations BEFORE checking availability.
    try {
      await releaseExpiredReservations({ eventId: parseInt(eventId) });
    } catch (e) {
      console.warn('Auto-release skipped:', e);
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
    // Nota: reservedAt (UTC ISO) is used only for auto-release logic.
    const updatedNumbers: any[] = [];
    const transactionsCreated: Array<{
      transactionNumber: string;
      kind: 'grace_promo_fill' | 'promo' | 'normal';
      reservedNumbers: string[];
      cantidad: number;
      promociones: number;
      precioTotal: number;
      precioUnitario: number;
      tipoPrecio: 'normal' | 'promocion';
    }> = [];
    const uxNotifications: string[] = [];
    let promoCompletions = 0;
		const newTxNumbers: string[] = [];
      // Timer de expiración solo cuando realmente dejamos boletas en estado 'reservado'.
      let shouldReturnReservationTimer = !proofKind;

    // Transaction number allocator (may create multiple tx in one request during grace)
    const lastTx = await db.select().from(transactions).orderBy(desc(transactions.id)).limit(1);
    let lastNum = lastTx.length > 0 ? (parseInt(lastTx[0].transactionNumber, 10) || 0) : 0;
    const allocTxNumber = () => {
      lastNum += 1;
      return String(lastNum).padStart(4, '0');
    };

    const reservedAtIso = new Date().toISOString();
    // Proof uploads must NOT drive ticket state.
    const nextEstado: 'reservado' = 'reservado';

    const reserveIntoTransaction = async (opts: {
      transactionNumber: string;
      numeros: string[];
      tipoPrecio: 'normal' | 'promocion';
      precioUnitario: number;
      promociones: number;
      kind: 'grace_promo_fill' | 'promo' | 'normal';
    }) => {
      if (!opts.numeros.length) return;

      const precioUnitario = Number(opts.precioUnitario || 0) || 0;
      const precioTotal = opts.numeros.length * precioUnitario;

      await db.insert(transactions).values({
        transactionNumber: opts.transactionNumber,
        usuarioCedula: cedula,
        usuarioNombre: nombreCompleto,
        campaignName: campaignInfo.length > 0 ? campaignInfo[0].name : 'Campaña',
        eventId: parseInt(eventId),
        eventName: eventRow.name || 'Evento',
        cantidad: opts.numeros.length,
        promociones: opts.promociones,
        precioTotal,
        // @ts-ignore optional columns
        promoStartedAt: null,
        // @ts-ignore optional columns
        promoExpiresAt: null,
        // @ts-ignore optional columns
        promoFinalizedAt: null,
        createdAt: nowIso,
      });
			newTxNumbers.push(opts.transactionNumber);

      for (const numero of opts.numeros) {
        const result = await db
          .update(numerosRifa)
          .set({
            estado: nextEstado,
            numeroIdentificacion: cedula,
            precioSeleccionado: precioUnitario,
            tipoPrecio: opts.tipoPrecio,
            abonado: 0,
            reservedAt: reservedAtIso,
            promoHold: 0,
            transactionNumber: opts.transactionNumber,
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

      transactionsCreated.push({
        transactionNumber: opts.transactionNumber,
        kind: opts.kind,
        reservedNumbers: [...opts.numeros],
        cantidad: opts.numeros.length,
        promociones: opts.promociones,
        precioTotal,
        precioUnitario,
        tipoPrecio: opts.tipoPrecio,
      });

      // Ventana promo se setea al validar dinero (movimientos), no aquí.
    };

    // Branch: if there is an active grace window transaction, do the new split behavior.
    // Regla (Jan 2026): la gracia SOLO se aplica cuando los números añadidos COMPLETAN la promo.
    // Si el usuario agrega menos de los necesarios, eso va como operación normal (nueva transacción).
    console.log(`[reservar-numeros] promoJoinTxNumber=${promoJoinTxNumber}, promoEligible=${promoEligible}, promoJoinRequiredAdditional=${promoJoinRequiredAdditional}, numeros.length=${numeros.length}`);
    if (promoJoinTxNumber && promoEligible && promoJoinRequiredAdditional > 0 && numeros.length >= promoJoinRequiredAdditional) {
      console.log(`[reservar-numeros] ✅ Entrando a branch de completar gracia`);
      const graceTxNumber = promoJoinTxNumber;
      const existingQty = Math.max(0, (promoJoinTargetQty - promoJoinRequiredAdditional) || 0);
      const missing = promoJoinRequiredAdditional;
      const selected = [...numeros];

      const graceFill = selected.slice(0, Math.min(selected.length, missing));
      let remaining = selected.slice(graceFill.length);

      // Always reserve the first N (up to missing) into the EXISTING grace transaction
      if (graceFill.length > 0) {
        const normalUnit = Number(eventRow.price || 0) || 0;
        const willComplete = graceFill.length === missing;
        const unitForFill = willComplete ? promoUnit : normalUnit;
        const tipoForFill: 'normal' | 'promocion' = willComplete ? 'promocion' : 'normal';

        for (const numero of graceFill) {
          const result = await db
            .update(numerosRifa)
            .set({
              estado: nextEstado,
              numeroIdentificacion: cedula,
              precioSeleccionado: unitForFill,
              tipoPrecio: tipoForFill,
              abonado: 0,
              reservedAt: reservedAtIso,
              promoHold: 0,
              transactionNumber: graceTxNumber,
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

        const newQty = existingQty + graceFill.length;

        if (willComplete) {
          // Regla: si el usuario está COMPLETANDO promo dentro de gracia, no permitir "solo reservar"
          // cuando aún no se cumple el mínimo promo (20.000) con dinero VALIDADO.
          if (!proofKind) {
            try {
              await ensureTransactionMovementsTable();
              const ledger = await getTxLedgerSummary(graceTxNumber, { includePaidRowsCredit: false });
              const creditedPrev =
                (Number(ledger.abonoLedgerTotal ?? 0) || 0) + (Number(ledger.pagoLedgerTotal ?? 0) || 0);
              const minAdditional = Math.max(0, 20000 - creditedPrev);
              if (minAdditional > 0) {
                return new Response(
                  JSON.stringify({
                    error: `Para completar la promoción debes registrar comprobante (pago/abono). Abono mínimo adicional: ${minAdditional}`,
                  }),
                  { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
              }
            } catch (e) {
              console.warn('No se pudo validar mínimo promo (reserva):', e);
            }
          }

          // Decisión de estado para promo completada:
          // - La boleta entra como ABONADA solo si la transacción cumple el mínimo (20.000) VALIDADO en movements.
          // - Si no cumple, permanece RESERVADA (con TTL) hasta que un movement válido la convierta.
          let promoMinMetByMovements = false;
          try {
            await ensureTransactionMovementsTable();
            const ledger = await getTxLedgerSummary(graceTxNumber, { includePaidRowsCredit: false });
            const creditedPrev =
              (Number(ledger.abonoLedgerTotal ?? 0) || 0) + (Number(ledger.pagoLedgerTotal ?? 0) || 0);
            promoMinMetByMovements = creditedPrev + 0.5 >= 20000;
          } catch (e) {
            // Best-effort only: if we can't compute it, keep reservations conservative.
            promoMinMetByMovements = false;
          }

					// Si entra como ABONADA por movements, no hay TTL que mostrar.
					if (!proofKind && promoMinMetByMovements) {
						shouldReturnReservationTimer = false;
					}

          if (!proofKind && !promoMinMetByMovements) {
            uxNotifications.push(
              '⏳ Atención: las boletas que quedaron en RESERVA tienen 5 minutos para que el admin valide un ABONO/PAGO por el saldo restante. Si no, pasarán a DISPONIBLE automáticamente.'
            );
          }

          // Completed: mark the whole tx as promo-priced and close grace window
          try {
            // IMPORTANT: preserve actual paid amount for direct-paid numbers BEFORE we rewrite promo pricing.
            // This prevents losing credit (e.g., paid 25k then promo unit becomes 20k).
            await client.execute({
              sql: `UPDATE numeros_rifa
                    SET paid_amount = precio_seleccionado
                    WHERE event_id = ?
                      AND transaction_number = ?
                      AND estado in ('pago','pago_gracia')
                      AND (paid_amount is null or paid_amount = 0)`,
              args: [parseInt(eventId), graceTxNumber],
            });

            const unpaidEstado = promoMinMetByMovements ? 'abonada' : 'reservado';
            const keepReservedAtFlag = promoMinMetByMovements ? 0 : 1;

            // La conversión a promo NO depende del comprobante, sino de movements.
            // - Si cumple mínimo: reservadas -> abonada y se limpia reserved_at (no expira).
            // - Si no cumple: se mantiene reservado y reserved_at (sí expira).
            // Nota: nunca degradar pago/pago_gracia ni abonada existente.
            await client.execute({
              sql: `UPDATE numeros_rifa
                    SET tipo_precio = 'promocion',
                        precio_seleccionado = ?,
                        reserved_at = CASE
                          WHEN estado = 'reservado' AND ? = 1 THEN reserved_at
                          ELSE NULL
                        END,
                        estado = CASE
                          WHEN estado in ('pago','pago_gracia') THEN estado
                          WHEN estado = 'abonada' THEN 'abonada'
                          ELSE ?
                        END
                    WHERE event_id = ?
                      AND transaction_number = ?`,
              args: [Number(promoUnit || 0) || 0, keepReservedAtFlag, unpaidEstado, parseInt(eventId), graceTxNumber],
            });
          } catch (e) {
            console.warn('Could not promo-mark existing grace tx numbers:', e);
          }

          const newPromos = Math.floor(newQty / packSize);
          const newTotal = newQty * promoUnit;
          try {
            await db
              .update(transactions)
              .set({
                cantidad: newQty,
                promociones: newPromos,
                precioTotal: newTotal,
                usuarioNombre: nombreCompleto,
                // @ts-ignore optional columns
                promoExpiresAt: nowIso,
              })
              .where(eq(transactions.transactionNumber, graceTxNumber));
          } catch (e) {
            console.warn('Could not update existing grace tx (complete):', e);
          }

          promoCompletions += 1;
          uxNotifications.push('Promoción completada: se asociaron boletas a tu transacción en gracia.');
        } else {
          // Partial: keep normal pricing and keep grace window open (promoExpiresAt unchanged)
          const newTotal = newQty * normalUnit;
          try {
            await db
              .update(transactions)
              .set({
                cantidad: newQty,
                promociones: 0,
                precioTotal: newTotal,
                usuarioNombre: nombreCompleto,
              })
              .where(eq(transactions.transactionNumber, graceTxNumber));
          } catch (e) {
            console.warn('Could not update existing grace tx (partial):', e);
          }

          uxNotifications.push(`Boleta(s) agregada(s) a tu transacción en gracia. Te falta(n) ${missing - graceFill.length} para completar la promoción.`);
        }

        // Include full tx numbers so UI/admin clearly sees association
        try {
          const graceTxNums = await db
            .select({ numero: numerosRifa.numero })
            .from(numerosRifa)
            .where(
              and(
                eq(numerosRifa.eventId, parseInt(eventId)),
                eq(numerosRifa.transactionNumber, graceTxNumber)
              )
            );

          const totalPriceForTx = willComplete ? (newQty * promoUnit) : (newQty * normalUnit);

          transactionsCreated.push({
            transactionNumber: graceTxNumber,
            kind: 'grace_promo_fill',
            reservedNumbers: graceTxNums.map((r) => String(r.numero)),
            cantidad: newQty,
            promociones: willComplete ? Math.floor(newQty / packSize) : 0,
            precioTotal: totalPriceForTx,
            precioUnitario: willComplete ? promoUnit : normalUnit,
            tipoPrecio: willComplete ? 'promocion' : 'normal',
          });
        } catch (e) {
          console.warn('Could not read grace tx numbers for response:', e);
        }
      }

      // Remaining numbers: create promo chunks of 3 as separate transactions
      while (promoEligible && remaining.length >= packSize) {
        const chunk = remaining.slice(0, packSize);
        remaining = remaining.slice(packSize);
        const txPromo = allocTxNumber();
        await reserveIntoTransaction({
          transactionNumber: txPromo,
          numeros: chunk,
          tipoPrecio: 'promocion',
          precioUnitario: promoUnit,
          promociones: 1,
          kind: 'promo',
        });
        promoCompletions += 1;
      }

      if (promoCompletions > 1) {
        uxNotifications.push(`Se completaron ${promoCompletions} promociones.`);
      }

      // Any leftover (1-2) => each becomes its own normal transaction
      if (remaining.length > 0) {
        const txNorm = allocTxNumber();
        await reserveIntoTransaction({
          transactionNumber: txNorm,
          numeros: remaining,
          tipoPrecio: 'normal',
          precioUnitario: Number(eventRow.price || 0) || 0,
          promociones: 0,
          kind: 'normal',
        });
      }
    } else {
      // Behavior (sin gracia activa): asignar transacciones por bloques (promo de 3 + sobrantes normales)
      const selected = [...numeros];
      let remaining = [...selected];
      const normalUnit = Number(eventRow.price || 0) || 0;

      // Promo chunks of 3 (each chunk is its own promo transaction)
      while (promoEligible && remaining.length >= packSize) {
        const chunk = remaining.slice(0, packSize);
        remaining = remaining.slice(packSize);
        const txPromo = allocTxNumber();
        await reserveIntoTransaction({
          transactionNumber: txPromo,
          numeros: chunk,
          tipoPrecio: 'promocion',
          precioUnitario: promoUnit,
          promociones: 1,
          kind: 'promo',
        });
        promoCompletions += 1;
      }

      // Leftover (1-2) as ONE normal transaction (so grace window works naturally)
      if (remaining.length > 0) {
        const txNorm = allocTxNumber();
        await reserveIntoTransaction({
          transactionNumber: txNorm,
          numeros: remaining,
          tipoPrecio: 'normal',
          precioUnitario: normalUnit,
          promociones: 0,
          kind: 'normal',
        });
      }

      if (promoCompletions > 0) {
        uxNotifications.push(`Se crearon ${promoCompletions} transacción(es) con promoción.`);
      }
    }

    if (updatedNumbers.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Error al reservar los números. Intenta nuevamente.',
          unavailableNumbers: numeros,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
      const txNumsFromCreated = transactionsCreated
        .map((t) => t.transactionNumber)
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '');

      const txNumsFromUpdated = updatedNumbers
        .map((n: any) => n?.transactionNumber)
        .filter((x: any): x is string => typeof x === 'string' && x.trim() !== '');

      const txNumsForResult = [
        ...txNumsFromCreated,
        ...txNumsFromUpdated,
        ...(promoJoinTxNumber ? [promoJoinTxNumber] : []),
      ];

      const txNumsUnique = Array.from(new Set(txNumsForResult));
      const primaryTransactionNumber = txNumsUnique.length > 0 ? txNumsUnique[0] : '';

      // Optional: attach proof (pago/abono) in the SAME request
    let proofUrl: string | null = null;
    let abonoByTransaction: Array<{
      transactionNumber: string;
      amount: number;
      minAdditional: number;
      creditedPrev: number;
      txTotal: number;
      isPrepaid: boolean;
    }> = [];
    let reservationExpiresAt: string | null = null;
    // For plain reservations (no proof), numbers auto-release after TTL ONLY when the transaction has no confirmed credit.
    // If the user is re-arming a promo under a transaction that already has a paid/validated ticket,
    // we must NOT show an expiration countdown (system won't release those numbers).
    if (shouldReturnReservationTimer) {
      reservationExpiresAt = new Date(Date.now() + RESERVATION_TTL_MS).toISOString();
    }
    if (proofKind && proofFile) {
      try {
        await ensureTransactionProofsTable();

        const buffer = Buffer.from(await proofFile.arrayBuffer());
        const folder = `sistema-rifas/comprobantes/${primaryTransactionNumber}`;
        const uploaded = await uploadBufferToCloudinary(buffer, folder);


          // Con una sola imagen, podemos registrar comprobante por transacción.
          // Para ABONO: permitir montos por transacción (abonoAllocations) o un solo monto si solo hay una transacción.
					const isMultiTx = txNumsUnique.length > 1;

          if (proofKind === 'abono') {
            // Si hay múltiples transacciones y no viene allocations, no sabemos cómo discriminar.
            if (txNumsUnique.length > 1 && !abonoAllocations) {
              return new Response(
                JSON.stringify({
                  error: 'Para abonar con varias transacciones debes indicar el monto por transacción.',
                }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
              );
            }

            const alloc = abonoAllocations
              ? abonoAllocations
              : [Number(proofAmount ?? 0) || 0];

            if (!Array.isArray(alloc) || alloc.length === 0) {
              return new Response(JSON.stringify({ error: 'Monto de abono inválido' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              });
            }

            if (alloc.length < txNumsUnique.length) {
              return new Response(
                JSON.stringify({
                  error: 'Faltan montos de abono para discriminar por transacción.',
                }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
              );
            }

            // Load prior credited amounts per transaction from the admin ledger (transaction_movements)
            // so minimums can be computed as "additional required".
            await ensureTransactionMovementsTable();
            const creditedByTx = new Map<string, number>();
            const ledgerRows = await Promise.all(
              txNumsUnique.map(async (txNum) => {
                const ledger = await getTxLedgerSummary(txNum, { includePaidRowsCredit: false });
                const creditedPrev =
                  (Number(ledger.abonoLedgerTotal ?? 0) || 0) + (Number(ledger.pagoLedgerTotal ?? 0) || 0);
                return { txNum, creditedPrev };
              })
            );
            for (const r of ledgerRows) {
              const key = String(r.txNum ?? '').trim();
              if (!key) continue;
              creditedByTx.set(key, Number(r.creditedPrev ?? 0) || 0);
            }

            // Validar por transacción y registrar solo las que tengan monto > 0
            for (let i = 0; i < txNumsUnique.length; i++) {
              const txNum = txNumsUnique[i];
              const amt = Number(alloc[i] ?? 0) || 0;
              if (!Number.isFinite(amt) || amt <= 0) {
                if (isMultiTx) {
                  return new Response(
                    JSON.stringify({ error: 'Debes indicar el abono para cada transacción.' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                  );
                }
                continue;
              }

              const txMeta = transactionsCreated.find((t) => t.transactionNumber === txNum);
              if (!txMeta) {
                return new Response(
                  JSON.stringify({ error: 'No se pudo determinar la transacción para discriminar el abono' }),
                  { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
              }

              const isPromoTx = (Number(txMeta.promociones ?? 0) || 0) > 0 || txMeta.tipoPrecio === 'promocion' || txMeta.kind === 'promo';
              const minBase = inferMinAbono(isPromoTx, txMeta.cantidad);
              const creditedPrev = Number(creditedByTx.get(txNum) ?? 0) || 0;
              const minAdditional = Math.max(0, minBase - creditedPrev);
              const max = Number(txMeta?.precioTotal ?? 0) || 0;

              if (amt + 0.000001 < minAdditional) {
                return new Response(
                  JSON.stringify({ error: `Abono mínimo por transacción: ${minAdditional}` }),
                  { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
              }
              if (max > 0 && amt > max + 0.000001) {
                return new Response(
                  JSON.stringify({ error: `El abono no puede superar el total de la transacción (${max})` }),
                  { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
              }

              await db.insert(transactionProofs).values({
                transactionNumber: txNum,
                kind: 'abono',
                amount: Math.trunc(amt),
                cloudinaryPublicId: uploaded.publicId,
                cloudinaryUrl: uploaded.secureUrl,
                createdAt: new Date().toISOString(),
              });

              // Nota (Jan 2026): no cambiar estados basado en comprobantes.
              // El estado abonada/pago se actualiza SOLO cuando el admin valida dinero (transaction_movements).
				const isPrepaid = false;

				abonoByTransaction.push({
					transactionNumber: txNum,
					amount: Math.trunc(amt),
					minAdditional: Math.trunc(minAdditional),
					creditedPrev: Math.trunc(creditedPrev),
					txTotal: Math.trunc(max),
					isPrepaid,
				});
            }
          } else {
            // PAGO: asociar el mismo comprobante a todas.
            for (const txNum of txNumsUnique) {
              // Importante: en `transaction_proofs` el pago debe guardar el saldo pendiente
              // (total - abonos/pagos validados) para que el módulo "Abonos y pagos" refleje lo que faltaba.
              let saldoForProof: number | null = null;
              try {
                await ensureTransactionMovementsTable();
                const ledger = await getTxLedgerSummary(txNum, { includePaidRowsCredit: false });
                saldoForProof = Math.max(0, Math.trunc(Number(ledger.saldoPendiente ?? 0) || 0));
              } catch (e) {
                // Best-effort only: if we can't compute it, keep null.
                console.warn('No se pudo calcular saldo pendiente para proof de pago:', e);
              }
              await db.insert(transactionProofs).values({
                transactionNumber: txNum,
                kind: proofKind,
                amount: saldoForProof,
                cloudinaryPublicId: uploaded.publicId,
                cloudinaryUrl: uploaded.secureUrl,
                createdAt: new Date().toISOString(),
              });
            }
          }

        proofUrl = uploaded.secureUrl;
      } catch (err) {
        console.error('Error attaching proof during reservar-numeros:', err);

        // Best-effort rollback so we don't end up with a reservation without proof.
        try {
          const eventoForRollback = await db.select().from(events).where(eq(events.id, parseInt(eventId))).limit(1);
          const fallbackPrice = eventoForRollback.length > 0 ? (eventoForRollback[0].price || 0) : 0;

					// Only delete transactions that were CREATED in this request (avoid touching the existing grace tx)
					if (newTxNumbers.length > 0) {
						await db.delete(transactions).where(inArray(transactions.transactionNumber, newTxNumbers));
					}
          await db
            .update(numerosRifa)
            .set({
              estado: 'disponible',
              numeroIdentificacion: null,
              transactionNumber: null,
              reservedAt: null,
              abonado: 0,
              tipoPrecio: 'normal',
              precioSeleccionado: fallbackPrice,
            })
            .where(
              and(
                eq(numerosRifa.eventId, parseInt(eventId)),
                inArray(numerosRifa.numero, updatedNumbers.map(n => n.numero))
              )
            );
        } catch (rollbackErr) {
          console.error('Rollback failed after proof error:', rollbackErr);
        }

        return new Response(JSON.stringify({ error: 'Error subiendo comprobante' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Encolar correo (async, desacoplado del request)
    if (usuario.length > 0 && evento.length > 0 && campaignInfo.length > 0 && usuario[0].correoElectronico) {
      const fechaReserva = new Date().toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const fechaRifa = new Date(evento[0].raffleDate).toLocaleDateString('es-CO', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric' 
      });

      try {
			// Enviar 1 correo por cada transacción creada para mantener compatibilidad y trazabilidad.
			for (const tx of transactionsCreated) {
				const computedTotal = Number(tx.precioTotal || 0) || 0;
				const packSizeForSuggestion = promoPackSize();
				const qtyForSuggestion = tx.cantidad;
				const missingForSuggestion = promoEligible ? ((packSizeForSuggestion - (qtyForSuggestion % packSizeForSuggestion)) % packSizeForSuggestion) : 0;
				await queueEmail('reserva', {
					to: usuario[0].correoElectronico,
					nombreCompleto,
					cedula: usuario[0].cedula,
					transactionNumber: tx.transactionNumber,
					campaignName: campaignInfo[0].name,
					eventId: evento[0].id,
					eventName: evento[0].name,
					numeros: tx.reservedNumbers.map((n) => Number(n)),
					cantidad: tx.cantidad,
					promociones: tx.promociones || 0,
					precioNormal: precioNormal || 0,
					precioPromo: precioPromo || 0,
					precioTotal: computedTotal,
					promoSuggestion: promoEligible && missingForSuggestion > 0 ? {
						missing: missingForSuggestion,
						targetQty: qtyForSuggestion + missingForSuggestion,
            message: `Ventana para completar promoción: te falta(n) ${missingForSuggestion} boleta(s). Tienes 5 minutos para agregarlas.`,
					} : null,
					fechaReserva,
					fechaRifa,
				});
			}
      } catch (err) {
        console.error('Error encolando correo:', err);
      }
    }

    const computedTotal = transactionsCreated.reduce((s, tx) => s + (Number(tx.precioTotal || 0) || 0), 0);

    // Promo suggestion is ONLY for a NEW grace window started by this request.
    // Nota: la ventana inicia cuando el admin valida dinero, pero el usuario puede ver la sugerencia.
    let promoSuggestion: { missing: number; targetQty: number; message: string } | null = null;
    if (promoEligible && !promoJoinTxNumber) {
      const candidate = (transactionsCreated || []).find((tx: any) => {
        const kind = String((tx as any)?.kind || '');
        const qty = Number((tx as any)?.cantidad ?? 0) || 0;
        const promos = Number((tx as any)?.promociones ?? 0) || 0;
        return kind === 'normal' && promos <= 0 && qty > 0 && (qty % packSize) !== 0;
      });
      if (candidate) {
        const qty = Number((candidate as any)?.cantidad ?? 0) || 0;
        const missing = ((packSize - (qty % packSize)) % packSize);
        if (missing > 0) {
          promoSuggestion = {
            missing,
            targetQty: qty + missing,
            message: `Ventana para completar promoción: te falta(n) ${missing} boleta(s). Cuando el admin valide tu pago/abono, tendrás 5 minutos para agregarlas y quedar todo en una sola transacción.`,
          };
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `${updatedNumbers.length} número(s) reservado(s) exitosamente`,
        reservedNumbers: updatedNumbers.map(n => n.numero),
        totalPrice: computedTotal,
			transactionNumber: primaryTransactionNumber,
        proofKind,
        proofUrl,
			reservationExpiresAt,
			reservationTtlMs: RESERVATION_TTL_MS,
			abonoByTransaction: proofKind === 'abono' ? abonoByTransaction : [],
        transactionsCreated,
			uxNotifications,
			promoCompletions,
      promoSuggestion,
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
