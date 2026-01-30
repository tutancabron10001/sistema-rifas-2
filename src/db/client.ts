import { createClient } from '@libsql/client/web';
import { drizzle } from 'drizzle-orm/libsql/web';

// Debug: mostrar variables disponibles
console.log('🔍 DEBUG - Variables de entorno:');
console.log('TURSO_CONNECTION_URL:', process.env.TURSO_CONNECTION_URL ? '✅ Definida' : '❌ No definida');
console.log('TURSO_AUTH_TOKEN:', process.env.TURSO_AUTH_TOKEN ? '✅ Definida' : '❌ No definida');

const tursoUrl = process.env.TURSO_CONNECTION_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoToken) {
  throw new Error('TURSO_CONNECTION_URL and TURSO_AUTH_TOKEN must be set');
}

const normalizedUrl = tursoUrl
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .replace(/^libsql:\/\//, 'https://')
  .replace(/^wss:\/\//, 'https://')
  .replace(/^ws:\/\//, 'http://');

const normalizedToken = tursoToken
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .replace(/^[Bb]earer\s+/, '')
  .replace(/[\r\n]+/g, '');

// Cliente Turso (solo HTTP/WebSocket, sin binarios nativos)
export const client = createClient({
  url: normalizedUrl,
  authToken: normalizedToken,
});

export const db = drizzle(client);
