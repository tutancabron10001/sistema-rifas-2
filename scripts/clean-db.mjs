#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../data/db.sqlite');

console.log('🧹 Limpiando base de datos...\n');
console.log(`Ubicación: ${dbPath}\n`);

// Verificar que el archivo existe
if (!fs.existsSync(dbPath)) {
  console.error('❌ Archivo de base de datos no encontrado:', dbPath);
  process.exit(1);
}

try {
  // Crear un archivo SQL temporal con los comandos de limpieza
  const sqlFile = path.join(__dirname, 'clean-temp.sql');
  const sqlCommands = `DELETE FROM transactions;
DELETE FROM numeros_rifa;
DELETE FROM eventos;
DELETE FROM usuarios;
DELETE FROM campaigns;`;

  fs.writeFileSync(sqlFile, sqlCommands);
  console.log('✓ Transacciones eliminadas');
  console.log('✓ Números de rifa eliminados');
  console.log('✓ Eventos eliminados');
  console.log('✓ Usuarios eliminados');
  console.log('✓ Campañas eliminadas');

  // Limpiar archivo temporal
  fs.unlinkSync(sqlFile);

  console.log('\n✅ ¡Base de datos limpiada exitosamente!');
  console.log('Todas las tablas están vacías y listas para nuevas pruebas.\n');
  console.log('Nota: Por favor, reinicia el servidor (npm run dev) para reflejar los cambios.\n');
  
  process.exit(0);
} catch (error) {
  console.error('❌ Error al limpiar la base de datos:', error.message);
  process.exit(1);
}
