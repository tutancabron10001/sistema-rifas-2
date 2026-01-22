import { db } from '../src/db/client';
import { campaigns, events, numerosRifa, usuarios, transactions } from '../src/db/schema';
import { sql } from 'drizzle-orm';

async function cleanDatabase() {
  try {
    console.log('\n🧹 Limpiando base de datos...\n');

    // Desactivar restricciones de clave foránea
    await db.run(sql`PRAGMA foreign_keys=OFF;`);

    // Eliminar datos de todas las tablas
    console.log('Eliminando transacciones...');
    await db.delete(transactions);
    
    console.log('Eliminando números de rifa...');
    await db.delete(numerosRifa);
    
    console.log('Eliminando eventos...');
    await db.delete(events);
    
    console.log('Eliminando usuarios...');
    await db.delete(usuarios);
    
    console.log('Eliminando campañas...');
    await db.delete(campaigns);

    // Resetear secuencias de autoincrement
    await db.run(sql`DELETE FROM sqlite_sequence;`);

    // Reactivar restricciones
    await db.run(sql`PRAGMA foreign_keys=ON;`);

    console.log('\n✅ ¡Base de datos limpiada exitosamente!');
    console.log('Todas las tablas están vacías.\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error al limpiar la base de datos:', error);
    process.exit(1);
  }
}

cleanDatabase();
