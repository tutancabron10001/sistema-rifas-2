import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import path from 'node:path';
import fs from 'node:fs';

// Debug: mostrar variables disponibles
console.log('🔍 DEBUG - Variables de entorno:');
console.log('TURSO_CONNECTION_URL:', process.env.TURSO_CONNECTION_URL ? '✅ Definida' : '❌ No definida');
console.log('TURSO_AUTH_TOKEN:', process.env.TURSO_AUTH_TOKEN ? '✅ Definida' : '❌ No definida');

// Prioridad: Si existen credenciales de Turso, SIEMPRE usarlas. Si no, usar SQLite local
const tursoUrl = process.env.TURSO_CONNECTION_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

let url: string;
let authToken: string | undefined;

if (tursoUrl && tursoToken) {
  // Usar Turso (desarrollo y producción)
  url = tursoUrl;
  authToken = tursoToken;
  console.log('☁️ Conectado a Turso');
} else {
  // Fallback a SQLite local
  url = `file:${path.resolve(process.cwd(), 'data', 'db.sqlite')}`;
  authToken = undefined;
  console.log('💾 Usando SQLite Local - VARIABLES DE TURSO NO ENCONTRADAS');
  
  // Crear directorio si es necesario
  const filePath = url.replace(/^file:/, '');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Cliente configurado
export const client = createClient(
  authToken
    ? { url, authToken }
    : { url }
);

export const db = drizzle(client);
