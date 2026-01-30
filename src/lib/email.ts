import nodemailer from 'nodemailer';

const emailUser = import.meta.env.EMAIL_USER || process.env.EMAIL_USER;
const emailPass = import.meta.env.EMAIL_PASS || process.env.EMAIL_PASS;

const emailFrom =
  import.meta.env.EMAIL_FROM ||
  process.env.EMAIL_FROM ||
  (emailUser ? `"Sistema de Rifas" <${emailUser}>` : undefined);

if (!emailUser || !emailPass) {
  console.warn('EMAIL_USER o EMAIL_PASS no están configurados. No se podrán enviar correos.');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: emailUser,
    pass: emailPass,
  },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
});

async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!emailFrom) {
    throw new Error('EMAIL_FROM not configured (or EMAIL_USER missing)');
  }

  const t0 = Date.now();
  console.log('[email] Provider=gmail-smtp Enviando a:', to);
  const result = await transporter.sendMail({
    from: emailFrom,
    to,
    subject,
    html,
  });
  console.log('[email] Provider=gmail-smtp Enviado OK en', Date.now() - t0, 'ms');
  return { success: true, provider: 'gmail-smtp', result } as const;
}

interface EmailReservaData {
  to: string;
  nombreCompleto: string;
  cedula: string;
  transactionNumber: string;
  campaignName: string;
  eventId: number;
  eventName: string;
  numeros: string[];
  cantidad: number;
  promociones: number;
  precioNormal: number;
  precioPromo: number;
  precioTotal: number;
  promoSuggestion?: {
    missing: number;
    targetQty: number;
    message: string;
  } | null;
  fechaReserva: string;
  fechaRifa: string;
}

export async function enviarCorreoReserva(data: EmailReservaData) {
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, #ec4899 0%, #be185d 100%);
          color: white;
          padding: 30px;
          text-align: center;
          border-radius: 10px 10px 0 0;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
        }
        .content {
          background: #f9fafb;
          padding: 30px;
          border: 1px solid #e5e7eb;
        }
        .section {
          background: white;
          padding: 20px;
          margin-bottom: 20px;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }
        .section h2 {
          color: #be185d;
          margin-top: 0;
          font-size: 20px;
          border-bottom: 2px solid #ec4899;
          padding-bottom: 10px;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .info-row:last-child {
          border-bottom: none;
        }
        .label {
          font-weight: bold;
          color: #6b7280;
        }
        .value {
          color: #111827;
          text-align: right;
        }
        .numeros-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
          gap: 10px;
          margin-top: 15px;
        }
        .numero {
          background: linear-gradient(135deg, #ec4899 0%, #be185d 100%);
          color: white;
          padding: 10px;
          text-align: center;
          border-radius: 5px;
          font-weight: bold;
          font-size: 16px;
        }
        .total-box {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 8px;
          margin-top: 20px;
        }
        .total-box .amount {
          font-size: 32px;
          font-weight: bold;
          margin: 10px 0;
        }
        .footer {
          background: #374151;
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 0 0 10px 10px;
          font-size: 14px;
        }
        .promo-badge {
          background: #fbbf24;
          color: #78350f;
          padding: 5px 15px;
          border-radius: 20px;
          font-weight: bold;
          display: inline-block;
          margin-top: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🎉 ¡Reserva Confirmada!</h1>
        <p style="margin: 10px 0 0 0;">Tu participación ha sido registrada exitosamente</p>
      </div>
      
      <div class="content">
        <!-- Información del Participante -->
        <div class="section">
          <h2>👤 Información del Participante</h2>
          <div class="info-row">
            <span class="label">Nombre:</span>
            <span class="value">${data.nombreCompleto}</span>
          </div>
          <div class="info-row">
            <span class="label">Cédula:</span>
            <span class="value">${data.cedula}</span>
          </div>
          <div class="info-row">
            <span class="label">Correo:</span>
            <span class="value">${data.to}</span>
          </div>
        </div>

        <!-- Información del Evento -->
        <div class="section">
          <h2>🎫 Información del Evento</h2>
          <div class="info-row">
            <span class="label">Transacción:</span>
            <span class="value">${data.transactionNumber}</span>
          </div>
          <div class="info-row">
            <span class="label">ID Evento:</span>
            <span class="value">${data.eventId}</span>
          </div>
          <div class="info-row">
            <span class="label">Campaña:</span>
            <span class="value">${data.campaignName}</span>
          </div>
          <div class="info-row">
            <span class="label">Evento:</span>
            <span class="value">${data.eventName}</span>
          </div>
          <div class="info-row">
            <span class="label">Fecha de Reserva:</span>
            <span class="value">${data.fechaReserva}</span>
          </div>
          <div class="info-row">
            <span class="label">Fecha del Sorteo:</span>
            <span class="value">${data.fechaRifa}</span>
          </div>
        </div>

        <!-- Números Reservados -->
        <div class="section">
          <h2>🎲 Números Reservados</h2>
          <div class="numeros-grid">
            ${data.numeros.map(num => `<div class="numero">${num}</div>`).join('')}
          </div>
        </div>

        <!-- Detalle de Compra -->
        <div class="section">
          <h2>💰 Detalle de Compra</h2>
          <div class="info-row">
            <span class="label">Cantidad de Boletas:</span>
            <span class="value">${data.cantidad}</span>
          </div>
          ${data.promociones > 0 ? `
          <div class="info-row">
            <span class="label">Promociones Aplicadas:</span>
            <span class="value">${data.promociones} x 3 boletas</span>
          </div>
          <span class="promo-badge">🔥 ¡Promoción Aplicada!</span>
          ` : ''}
          <div class="info-row">
            <span class="label">Precio Normal:</span>
            <span class="value">${data.precioNormal.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
          </div>
          ${data.precioPromo > 0 ? `
          <div class="info-row">
            <span class="label">Precio Promoción:</span>
            <span class="value">${data.precioPromo.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
          </div>
          ` : ''}
        </div>

        ${data.promoSuggestion && data.promoSuggestion.missing > 0 ? `
        <div class="section">
          <h2>⭐ Completa tu Promoción</h2>
          <div style="background: #fef3c7; border: 1px solid #fbbf24; padding: 14px; border-radius: 8px; color: #78350f;">
            <div style="font-weight: bold; margin-bottom: 6px;">Te faltan ${data.promoSuggestion.missing} boleta(s) para completar promoción(es)</div>
            <div style="font-size: 14px;">${data.promoSuggestion.message}</div>
          </div>
        </div>
        ` : ''}

        <!-- Total -->
        <div class="total-box">
          <div>Total a Pagar</div>
          <div class="amount">${data.precioTotal.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</div>
          <div style="font-size: 14px; margin-top: 10px;">Estado: RESERVADO</div>
        </div>
      </div>

      <div class="footer">
        <p style="margin: 0 0 10px 0;"><strong>Sistema de Rifas</strong></p>
        <p style="margin: 0; font-size: 12px; color: #d1d5db;">
          Este es un correo automático, por favor no responder.<br>
          Conserva este correo como comprobante de tu reserva.
        </p>
      </div>
    </body>
    </html>
  `;

  try {
    console.log('[email][reserva] Enviando…');
    await sendEmail({
      to: data.to,
      subject: `RESERVA CONFIRMADA (TRANSACCION ASOCIADA ${data.transactionNumber})`,
      html: htmlContent,
    });
    return { success: true };
  } catch (error) {
    console.error('Error enviando correo:', error);
    return { success: false, error };
  }
}

interface EmailPagoData {
  to: string;
  nombreCompleto: string;
  cedula: string;
  transactionNumber: string;
  campaignName: string;
  eventId: number;
  eventName: string;
  movimientos?: Array<{
    kind: 'abono' | 'pago' | string;
    amount: number;
    createdAt: string;
    url?: string;
  }>;
  numerosPagados: Array<{
    numero: number;
    tipoPrecio: string;
    precioSeleccionado: number;
    abonado?: number;
  }>;
  totalPrecio: number;
  totalAbonado: number;
  totalPagado: number;
  fechaPago: string;
  fechaRifa: string;
}

export async function enviarCorreoPago(data: EmailPagoData) {
  const movimientos = Array.isArray((data as any)?.movimientos) ? ((data as any).movimientos as any[]) : [];
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          padding: 30px;
          text-align: center;
          border-radius: 10px 10px 0 0;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
        }
        .content {
          background: #f9fafb;
          padding: 30px;
          border: 1px solid #e5e7eb;
        }
        .section {
          background: white;
          padding: 20px;
          margin-bottom: 20px;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }
        .section h2 {
          color: #059669;
          margin-top: 0;
          font-size: 20px;
          border-bottom: 2px solid #10b981;
          padding-bottom: 10px;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .info-row:last-child {
          border-bottom: none;
        }
        .label {
          font-weight: bold;
          color: #6b7280;
        }
        .value {
          color: #111827;
          text-align: right;
        }
        .factura-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 15px;
        }
        .factura-table th {
          background: #f3f4f6;
          padding: 10px;
          text-align: left;
          font-weight: bold;
          border-bottom: 2px solid #10b981;
        }
        .factura-table td {
          padding: 10px;
          border-bottom: 1px solid #f3f4f6;
        }
        .factura-table tr:last-child td {
          border-bottom: none;
        }
        .tipo-badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: bold;
        }
        .tipo-normal {
          background: #dbeafe;
          color: #1e40af;
        }
        .tipo-promo {
          background: #fef3c7;
          color: #92400e;
        }
        .total-box {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 8px;
          margin-top: 20px;
        }
        .total-box .amount {
          font-size: 32px;
          font-weight: bold;
          margin: 10px 0;
        }
        .footer {
          background: #374151;
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 0 0 10px 10px;
          font-size: 14px;
        }
        .paid-badge {
          background: #10b981;
          color: white;
          padding: 8px 20px;
          border-radius: 20px;
          font-weight: bold;
          display: inline-block;
          margin-top: 10px;
          font-size: 16px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>✅ ¡Pago Confirmado!</h1>
        <p style="margin: 10px 0 0 0;">Tu pago ha sido registrado exitosamente</p>
      </div>
      
      <div class="content">
        <!-- Información del Participante -->
        <div class="section">
          <h2>👤 Información del Participante</h2>
          <div class="info-row">
            <span class="label">Nombre:</span>
            <span class="value">${data.nombreCompleto}</span>
          </div>
          <div class="info-row">
            <span class="label">Cédula:</span>
            <span class="value">${data.cedula}</span>
          </div>
          <div class="info-row">
            <span class="label">Correo:</span>
            <span class="value">${data.to}</span>
          </div>
        </div>

        <!-- Información del Evento -->
        <div class="section">
          <h2>🎫 Información del Evento</h2>
          <div class="info-row">
            <span class="label">Transacción:</span>
            <span class="value">${data.transactionNumber}</span>
          </div>
          <div class="info-row">
            <span class="label">ID Evento:</span>
            <span class="value">${data.eventId}</span>
          </div>
          <div class="info-row">
            <span class="label">Campaña:</span>
            <span class="value">${data.campaignName}</span>
          </div>
          <div class="info-row">
            <span class="label">Evento:</span>
            <span class="value">${data.eventName}</span>
          </div>
          <div class="info-row">
            <span class="label">Fecha de Pago:</span>
            <span class="value">${data.fechaPago}</span>
          </div>
          <div class="info-row">
            <span class="label">Fecha del Sorteo:</span>
            <span class="value">${data.fechaRifa}</span>
          </div>
        </div>

        ${movimientos.length > 0 ? `
        <div class="section">
          <h2>🧾 Pagos y Abonos (con fecha)</h2>
          <table class="factura-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th style="text-align: right;">Monto</th>
              </tr>
            </thead>
            <tbody>
              ${movimientos
                .slice()
                .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
                .map((m: any) => {
                  let fecha = String(m?.createdAt || '');
                  try {
                    fecha = new Date(String(m.createdAt)).toLocaleString('es-CO', {
                      timeZone: 'America/Bogota',
                      year: 'numeric',
                      month: 'short',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                  } catch {
                    // keep raw
                  }
                  const tipoRaw = String(m?.kind || '').toLowerCase();
                  const tipo = tipoRaw === 'pago' ? 'Pago' : 'Abono';
                  const amtRaw = (m as any)?.amount;
                  const amtNum = typeof amtRaw === 'number' ? amtRaw : Number(amtRaw);
                  const hasAmt = amtRaw !== null && amtRaw !== undefined && Number.isFinite(amtNum);
                  const amtDisplay = hasAmt
                    ? amtNum.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})
                    : '—';
                  return `
                    <tr>
                      <td>${fecha}</td>
                      <td><strong>${tipo}</strong></td>
                      <td style="text-align: right;">${amtDisplay}</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        ` : ''}

        <!-- Factura Detallada -->
        <div class="section">
          <h2>🧾 Factura - Boletas Pagadas</h2>
          <table class="factura-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th style="text-align: right;">Precio</th>
              </tr>
            </thead>
            <tbody>
              ${data.numerosPagados.map(n => `
                <tr>
                  <td><strong>#${n.numero}</strong></td>
                  <td>
                    <span class="tipo-badge ${n.tipoPrecio === 'promocion' ? 'tipo-promo' : 'tipo-normal'}">
                      ${n.tipoPrecio === 'promocion' ? '🔥 Promoción' : '💼 Normal'}
                    </span>
                  </td>
                  <td>
                    <span class="tipo-badge" style="background: #10b981; color: white;">✅ PAGO</span>
                  </td>
                  <td style="text-align: right;">${n.precioSeleccionado.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          ${data.totalAbonado > 0 ? `
            <div style="margin-top: 20px; padding: 15px; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px;">
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #d97706;">
                <span style="font-weight: bold; color: #78350f;">Precio Total:</span>
                <span style="font-weight: bold;">${data.totalPrecio.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #d97706;">
                <span style="color: #78350f;">Abonos Previos:</span>
                <span style="color: #16a34a; font-weight: bold;">-${data.totalAbonado.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 12px 0 0 0; font-size: 18px;">
                <span style="font-weight: bold; color: #78350f;">Pago Realizado:</span>
                <span style="font-weight: bold; color: #16a34a;">${data.totalPagado.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Total Pagado -->
        <div class="total-box">
          <div>${data.totalAbonado > 0 ? 'Transacción Completada' : 'Total Pagado'}</div>
          <div class="amount">${data.totalPrecio.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</div>
          <span class="paid-badge">✅ PAGADO COMPLETO</span>
        </div>
      </div>

      <div class="footer">
        <p style="margin: 0 0 10px 0;"><strong>Sistema de Rifas</strong></p>
        <p style="margin: 0; font-size: 12px; color: #d1d5db;">
          Este es un correo automático, por favor no responder.<br>
          Conserva este correo como comprobante de tu pago y participación en el sorteo.
        </p>
      </div>
    </body>
    </html>
  `;

  try {
    console.log('[email][pago] Enviando…');
    await sendEmail({
      to: data.to,
      subject: `PAGO CONFIRMADO TRANSACCION ${data.transactionNumber}`,
      html: htmlContent,
    });
    return { success: true };
  } catch (error) {
    console.error('Error enviando correo de pago:', error);
    return { success: false, error };
  }
}

interface EmailAbonoData {
  usuarioNombre: string;
  usuarioCorreo: string;
  transactionNumber: string;
  campaignName: string;
  eventName: string;

  movimientos?: Array<{
    kind: 'abono' | 'pago' | string;
    amount: number;
    createdAt: string;
    url?: string;
  }>;

  // Legacy (abono por número)
  numero?: string;
  montoAbono: number;
  totalAbonado?: number;
  precioTotal?: number;
  saldoPendiente?: number;
  tipoPrecio?: string;

  // Nuevo (abono por transacción)
  totalPrecioTx?: number;
  totalAbonadoTx?: number;
  saldoPendienteTx?: number;
  items?: Array<{
    numero: string;
    tipoPrecio: string;
    precioTotal: number;
    abonoPrevio: number;
    abonoAplicado: number;
    abonoNuevo: number;
    saldoPendiente: number;
    estadoFinal: string;
  }>;
}

export async function enviarCorreoAbono(data: EmailAbonoData) {
  const isTxSummary = Array.isArray((data as any).items) && (data as any).items.length > 0;
  const movimientos = Array.isArray((data as any)?.movimientos) ? ((data as any).movimientos as any[]) : [];

  const htmlContent = isTxSummary
    ? `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 680px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
          padding: 30px;
          text-align: center;
          border-radius: 10px 10px 0 0;
        }
        .header h1 { margin: 0; font-size: 28px; }
        .content {
          background: #f9fafb;
          padding: 30px;
          border: 1px solid #e5e7eb;
        }
        .section {
          background: white;
          padding: 20px;
          margin-bottom: 20px;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }
        .section h2 {
          color: #d97706;
          margin-top: 0;
          font-size: 20px;
          border-bottom: 2px solid #f59e0b;
          padding-bottom: 10px;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .info-row:last-child { border-bottom: none; }
        .label { font-weight: bold; color: #6b7280; }
        .value { color: #111827; text-align: right; }
        .abono-box {
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 8px;
          margin-top: 10px;
        }
        .abono-box .amount { font-size: 32px; font-weight: bold; margin: 10px 0; }
        .saldo-box {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: white;
          padding: 15px;
          text-align: center;
          border-radius: 8px;
          margin-top: 12px;
        }
        .saldo-box .amount { font-size: 24px; font-weight: bold; margin: 5px 0; }
        .table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }
        .table th, .table td {
          border: 1px solid #e5e7eb;
          padding: 10px;
          text-align: left;
        }
        .table th {
          background: #fff7ed;
          color: #9a3412;
        }
        .pill {
          display: inline-block;
          padding: 2px 10px;
          border-radius: 999px;
          font-weight: bold;
          font-size: 12px;
          white-space: nowrap;
        }
        .pill-paid { background: #16a34a; color: white; }
        .pill-prepaid { background: #7c3aed; color: white; }
        .pill-partial { background: #f59e0b; color: white; }
        .pill-reserved { background: #374151; color: white; }
        .footer {
          background: #374151;
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 0 0 10px 10px;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>💰 Abono Registrado</h1>
        <p style="margin: 10px 0 0 0;">Transacción #${data.transactionNumber}</p>
      </div>

      <div class="content">
        <div class="section">
          <h2>👤 Datos del Participante</h2>
          <div class="info-row">
            <span class="label">Nombre:</span>
            <span class="value">${data.usuarioNombre}</span>
          </div>
          <div class="info-row">
            <span class="label">Campaña:</span>
            <span class="value">${data.campaignName}</span>
          </div>
          <div class="info-row">
            <span class="label">Evento:</span>
            <span class="value">${data.eventName}</span>
          </div>
        </div>

        <div class="section">
          <h2>📊 Estado de la Transacción</h2>
          <div class="abono-box">
            <div>✨ Abono realizado por el usuario</div>
            <div class="amount">${Number(data.montoAbono).toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</div>
          </div>

          <div style="margin-top: 12px; padding: 12px 14px; background: #fff7ed; border: 1px solid #fb923c; border-radius: 10px; color: #9a3412; font-weight: bold; text-align: center;">
            Estado actual: ABONO (pendiente por completar)
          </div>

          <div class="info-row" style="margin-top: 16px;">
            <span class="label">Total de la Transacción:</span>
            <span class="value">${Number(data.totalPrecioTx || 0).toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
          </div>
          <div class="info-row">
            <span class="label">Total Abonado:</span>
            <span class="value">${Number(data.totalAbonadoTx || 0).toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
          </div>

          <div class="saldo-box">
            <div>Saldo Pendiente</div>
            <div class="amount">${Number(data.saldoPendienteTx || 0).toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</div>
          </div>
        </div>

        ${movimientos.length > 0 ? `
        <div class="section">
          <h2>🧾 Pagos y Abonos (con fecha)</h2>
          <table class="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Monto</th>
              </tr>
            </thead>
            <tbody>
              ${movimientos
                .slice()
                .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
                .map((m: any) => {
                  let fecha = String(m?.createdAt || '');
                  try {
                    fecha = new Date(String(m.createdAt)).toLocaleString('es-CO', {
                      timeZone: 'America/Bogota',
                      year: 'numeric',
                      month: 'short',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                  } catch {
                    // keep raw
                  }
                  const tipoRaw = String(m?.kind || '').toLowerCase();
                  const tipo = tipoRaw === 'pago' ? 'Pago' : 'Abono';
                  const amtRaw = (m as any)?.amount;
                  const amtNum = typeof amtRaw === 'number' ? amtRaw : Number(amtRaw);
                  const hasAmt = amtRaw !== null && amtRaw !== undefined && Number.isFinite(amtNum);
                  const amtDisplay = hasAmt
                    ? amtNum.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})
                    : '—';
                  return `
                    <tr>
                      <td>${fecha}</td>
                      <td><strong>${tipo}</strong></td>
                      <td>${amtDisplay}</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        ` : ''}

        <div class="section">
          <h2>🎫 Boletas de la transacción</h2>
          <table class="table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Tipo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${(data.items || [])
                .map((i) => {
                  const tipo = i.tipoPrecio === 'promocion' ? 'Promoción' : 'Normal';
                  const estadoRaw = String(i.estadoFinal || '').toLowerCase();
                  const estado =
                    estadoRaw === 'pago' || estadoRaw === 'pago_gracia'
                      ? 'PAGADO'
                      : estadoRaw === 'reservado'
                        ? 'RESERVADA'
                        : 'ABONADA';
                  const pillClass =
                    estadoRaw === 'pago' || estadoRaw === 'pago_gracia'
                      ? 'pill-paid'
                      : estadoRaw === 'reservado'
                        ? 'pill-reserved'
                        : 'pill-partial';
                  return `
                    <tr>
                      <td>#${i.numero}</td>
                      <td>${tipo}</td>
                      <td><span class="pill ${pillClass}">${estado}</span></td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="footer">
        <p style="margin: 0 0 10px 0;"><strong>Sistema de Rifas</strong></p>
        <p style="margin: 0;">
          Este es un correo automático, por favor no responder.<br>
          Conserva este correo como comprobante de tu abono.
        </p>
      </div>
    </body>
    </html>
  `
    : `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
          padding: 30px;
          text-align: center;
          border-radius: 10px 10px 0 0;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
        }
        .content {
          background: #f9fafb;
          padding: 30px;
          border: 1px solid #e5e7eb;
        }
        .section {
          background: white;
          padding: 20px;
          margin-bottom: 20px;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }
        .section h2 {
          color: #d97706;
          margin-top: 0;
          font-size: 20px;
          border-bottom: 2px solid #f59e0b;
          padding-bottom: 10px;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .info-row:last-child {
          border-bottom: none;
        }
        .label {
          font-weight: bold;
          color: #6b7280;
        }
        .value {
          color: #111827;
          text-align: right;
        }
        .numero-destacado {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 8px;
          margin: 15px 0;
        }
        .numero-destacado .numero {
          font-size: 48px;
          font-weight: bold;
          margin: 10px 0;
        }
        .abono-box {
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 8px;
          margin-top: 20px;
        }
        .abono-box .amount {
          font-size: 32px;
          font-weight: bold;
          margin: 10px 0;
        }
        .saldo-box {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: white;
          padding: 15px;
          text-align: center;
          border-radius: 8px;
          margin-top: 15px;
        }
        .saldo-box .amount {
          font-size: 24px;
          font-weight: bold;
          margin: 5px 0;
        }
        .footer {
          background: #374151;
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 0 0 10px 10px;
          font-size: 14px;
        }
        .tipo-badge {
          display: inline-block;
          padding: 5px 15px;
          border-radius: 20px;
          font-weight: bold;
          font-size: 12px;
        }
        .tipo-promo {
          background: #ec4899;
          color: white;
        }
        .tipo-normal {
          background: #3b82f6;
          color: white;
        }
        .detalle-abono {
          background: #fef3c7;
          border: 1px solid #f59e0b;
          border-radius: 8px;
          padding: 15px;
          margin: 15px 0;
        }
        .detalle-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px dashed #d97706;
        }
        .detalle-row:last-child {
          border-bottom: none;
        }
        .detalle-row.destacado {
          font-weight: bold;
          font-size: 18px;
          color: #16a34a;
          border-top: 2px solid #d97706;
          margin-top: 10px;
          padding-top: 15px;
        }
        .mini-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
          margin-top: 10px;
        }
        .mini-table th, .mini-table td {
          border: 1px solid #e5e7eb;
          padding: 10px;
          text-align: left;
        }
        .mini-table th {
          background: #fff7ed;
          color: #9a3412;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>💰 Abono Registrado</h1>
        <p style="margin: 10px 0 0 0;">Transacción #${data.transactionNumber}</p>
      </div>

      <div class="content">
        <div class="section">
          <h2>👤 Datos del Participante</h2>
          <div class="info-row">
            <span class="label">Nombre:</span>
            <span class="value">${data.usuarioNombre}</span>
          </div>
          <div class="info-row">
            <span class="label">Campaña:</span>
            <span class="value">${data.campaignName}</span>
          </div>
          <div class="info-row">
            <span class="label">Evento:</span>
            <span class="value">${data.eventName}</span>
          </div>
        </div>

        <div class="section">
          <h2>🎫 Número Abonado</h2>
          <div class="numero-destacado">
            <div style="font-size: 14px;">Boleta</div>
            <div class="numero">#${data.numero || ''}</div>
            <span class="tipo-badge ${data.tipoPrecio === 'promocion' ? 'tipo-promo' : 'tipo-normal'}">
              ${data.tipoPrecio === 'promocion' ? '🔥 Promoción' : '💼 Normal'}
            </span>
          </div>
        </div>

        <div class="section">
          <h2>📊 Detalle del Abono</h2>
          <div class="detalle-abono">
            <div class="detalle-row">
              <span>Precio Total de la Boleta:</span>
              <span>${Number(data.precioTotal || 0).toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
            </div>
            <div class="detalle-row">
              <span>Abono Anterior:</span>
              <span>${(Number(data.totalAbonado || 0) - Number(data.montoAbono || 0)).toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
            </div>
            <div class="detalle-row destacado">
              <span>✨ Abono Realizado:</span>
              <span>${Number(data.montoAbono || 0).toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
            </div>
          </div>

          <div class="abono-box">
            <div>Total Abonado</div>
            <div class="amount">${Number(data.totalAbonado || 0).toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</div>
          </div>

          <div class="saldo-box">
            <div>Saldo Pendiente</div>
            <div class="amount">${Number(data.saldoPendiente || 0).toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</div>
          </div>
        </div>

        ${movimientos.length > 0 ? `
        <div class="section">
          <h2>🧾 Pagos y Abonos (con fecha)</h2>
          <table class="mini-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Monto</th>
              </tr>
            </thead>
            <tbody>
              ${movimientos
                .slice()
                .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
                .map((m: any) => {
                  let fecha = String(m?.createdAt || '');
                  try {
                    fecha = new Date(String(m.createdAt)).toLocaleString('es-CO', {
                      timeZone: 'America/Bogota',
                      year: 'numeric',
                      month: 'short',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                  } catch {
                    // keep raw
                  }
                  const tipoRaw = String(m?.kind || '').toLowerCase();
                  const tipo = tipoRaw === 'pago' ? 'Pago' : 'Abono';
                  const amtRaw = (m as any)?.amount;
                  const amtNum = typeof amtRaw === 'number' ? amtRaw : Number(amtRaw);
                  const hasAmt = amtRaw !== null && amtRaw !== undefined && Number.isFinite(amtNum);
                  const amtDisplay = hasAmt
                    ? amtNum.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})
                    : '—';
                  return `
                    <tr>
                      <td>${fecha}</td>
                      <td><strong>${tipo}</strong></td>
                      <td>${amtDisplay}</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        ` : ''}
      </div>

      <div class="footer">
        <p style="margin: 0 0 10px 0;"><strong>Sistema de Rifas</strong></p>
        <p style="margin: 0;">
          Este es un correo automático, por favor no responder.<br>
          Conserva este correo como comprobante de tu abono.
        </p>
      </div>
    </body>
    </html>
  `;

  try {
    console.log('[email][abono] Enviando…');
    await sendEmail({
      to: data.usuarioCorreo,
      subject: `ABONO TRANSACCION ${data.transactionNumber}`,
      html: htmlContent,
    });
    return { success: true };
  } catch (error) {
    console.error('Error enviando correo de abono:', error);
    return { success: false, error };
  }
}

interface EmailProofRejectedData {
  to: string;
  nombreCompleto: string;
  cedula: string;
  transactionNumber: string;
  campaignName: string;
  eventId: number;
  eventName: string;
  proof: {
    kind: string;
    amount: number | null;
    url: string;
    createdAt: string;
  };
  reason?: string | null;
  rejectedAt: string;
}

export async function enviarCorreoComprobanteRechazado(data: EmailProofRejectedData) {
  const kind = String(data?.proof?.kind || '').toUpperCase();
  const amt = data?.proof?.amount != null && Number.isFinite(Number(data.proof.amount))
    ? Number(data.proof.amount)
    : null;
  const reason = data?.reason ? String(data.reason) : '';

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: white; padding: 24px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; }
        .section { background: white; padding: 16px; margin-bottom: 14px; border-radius: 10px; border: 1px solid #e5e7eb; }
        .section h2 { color: #b91c1c; margin: 0 0 10px 0; font-size: 18px; }
        .row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
        .row:last-child { border-bottom: none; }
        .label { font-weight: bold; color: #6b7280; }
        .value { color: #111827; text-align: right; }
        .cta { background: #fff7ed; border: 1px solid #fed7aa; padding: 12px; border-radius: 10px; color: #9a3412; }
        a { color: #2563eb; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1 style="margin:0; font-size:22px;">Comprobante rechazado</h1>
        <p style="margin:8px 0 0 0; font-size:14px; opacity:0.95;">Tu comprobante fue revisado y no pudo ser validado.</p>
      </div>
      <div class="content">
        <div class="section">
          <h2>Detalles</h2>
          <div class="row"><span class="label">Transacción</span><span class="value">#${data.transactionNumber}</span></div>
          <div class="row"><span class="label">Evento</span><span class="value">${data.eventName}</span></div>
          <div class="row"><span class="label">Tipo</span><span class="value">${kind || 'COMPROBANTE'}${amt != null ? ` • ${amt.toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 })}` : ''}</span></div>
          <div class="row"><span class="label">Fecha de envío</span><span class="value">${data.proof?.createdAt ? new Date(data.proof.createdAt).toLocaleString('es-CO') : ''}</span></div>
        </div>

        ${reason ? `
        <div class="section">
          <h2>Motivo</h2>
          <div class="cta">${escapeHtml(reason)}</div>
        </div>
        ` : ''}

        ${data.proof?.url ? `
        <div class="section">
          <h2>Enlace del comprobante</h2>
          <div><a href="${data.proof.url}" target="_blank" rel="noopener noreferrer">Ver comprobante</a></div>
        </div>
        ` : ''}

        <div class="section">
          <h2>¿Qué hacer ahora?</h2>
          <div class="cta">
            Por favor envía un comprobante legible y correspondiente a tu transacción.
            Si crees que fue un error, responde a este mensaje o comunícate con soporte.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await sendEmail({
      to: data.to,
      subject: `Comprobante rechazado • Transacción #${data.transactionNumber}`,
      html: htmlContent,
    });
    return { success: true };
  } catch (error) {
    console.error('Error enviando correo de comprobante rechazado:', error);
    return { success: false, error };
  }
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
