import nodemailer from 'nodemailer';

const emailUser = import.meta.env.EMAIL_USER || process.env.EMAIL_USER;
const emailPass = import.meta.env.EMAIL_PASS || process.env.EMAIL_PASS;

if (!emailUser || !emailPass) {
  console.warn('EMAIL_USER o EMAIL_PASS no están configurados. No se podrán enviar correos.');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: emailUser,
    pass: emailPass,
  },
});

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

  const mailOptions = {
    from: `"Sistema de Rifas" <${emailUser}>`,
    to: data.to,
    subject: `RESERVA CONFIRMADA (TRANSACCION ASOCIADA ${data.transactionNumber})`,
    html: htmlContent,
  };

  try {
    await transporter.sendMail(mailOptions);
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

        <!-- Factura Detallada -->
        <div class="section">
          <h2>🧾 Factura - Boletas Pagadas</h2>
          <table class="factura-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Tipo</th>
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

  const mailOptions = {
    from: `"Sistema de Rifas" <${emailUser}>`,
    to: data.to,
    subject: `PAGO CONFIRMADO TRANSACCION ${data.transactionNumber}`,
    html: htmlContent,
  };

  try {
    console.log('Intentando enviar correo de pago a:', data.to);
    const resultado = await transporter.sendMail(mailOptions);
    console.log('Correo de pago enviado exitosamente:', resultado);
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
  numero: string;
  montoAbono: number;
  totalAbonado: number;
  precioTotal: number;
  saldoPendiente: number;
  tipoPrecio: string;
}

export async function enviarCorreoAbono(data: EmailAbonoData) {
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
            <div class="numero">#${data.numero}</div>
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
              <span>${data.precioTotal.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
            </div>
            <div class="detalle-row">
              <span>Abono Anterior:</span>
              <span>${(data.totalAbonado - data.montoAbono).toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
            </div>
            <div class="detalle-row destacado">
              <span>✨ Abono Realizado:</span>
              <span>${data.montoAbono.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</span>
            </div>
          </div>

          <div class="abono-box">
            <div>Total Abonado</div>
            <div class="amount">${data.totalAbonado.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</div>
          </div>

          <div class="saldo-box">
            <div>Saldo Pendiente</div>
            <div class="amount">${data.saldoPendiente.toLocaleString('es-CO', {style: 'currency', currency: 'COP', minimumFractionDigits: 0})}</div>
          </div>
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
  `;

  const mailOptions = {
    from: `"Sistema de Rifas" <${emailUser}>`,
    to: data.usuarioCorreo,
    subject: `ABONO TRANSACCION ${data.transactionNumber}`,
    html: htmlContent,
  };

  try {
    console.log('Intentando enviar correo de abono a:', data.usuarioCorreo);
    const resultado = await transporter.sendMail(mailOptions);
    console.log('Correo de abono enviado exitosamente:', resultado);
    return { success: true };
  } catch (error) {
    console.error('Error enviando correo de abono:', error);
    return { success: false, error };
  }
}
