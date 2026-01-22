import { db } from '../src/db/client.ts';
import { campaigns, eventos, numeros_rifa, usuarios, transactions } from '../src/db/schema.ts';

console.log('🧹 Limpiando base de datos...\n');

try {
  // Limpiar tablas en orden (por dependencias)
  console.log('Borrando transacciones...');
  await db.delete(transactions);
  console.log('✓ Transacciones eliminadas');

  console.log('Borrando números de rifa...');
  await db.delete(numeros_rifa);
  console.log('✓ Números de rifa eliminados');

  console.log('Borrando eventos...');
  await db.delete(eventos);
  console.log('✓ Eventos eliminados');

  console.log('Borrando usuarios...');
  await db.delete(usuarios);
  console.log('✓ Usuarios eliminados');

  console.log('Borrando campañas...');
  await db.delete(campaigns);
  console.log('✓ Campañas eliminadas');

  console.log('\n✅ ¡Base de datos limpiada exitosamente!');
  console.log('Todas las tablas están vacías y listas para nuevas pruebas.');
  
  process.exit(0);
} catch (error) {
  console.error('❌ Error al limpiar la base de datos:', error.message);
  process.exit(1);
}
