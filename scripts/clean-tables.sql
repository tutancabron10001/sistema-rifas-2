-- Script para limpiar la base de datos
-- Ejecutar con: sqlite3 data/db.sqlite < scripts/clean-tables.sql

DELETE FROM transactions;
DELETE FROM numeros_rifa;
DELETE FROM eventos;
DELETE FROM usuarios;
DELETE FROM campaigns;

-- Mostrar confirmación
SELECT 'Base de datos limpiada exitosamente!' as status;
SELECT 'Campañas:' as tabla, COUNT(*) as registros FROM campaigns
UNION ALL
SELECT 'Usuarios' as tabla, COUNT(*) as registros FROM usuarios
UNION ALL
SELECT 'Eventos' as tabla, COUNT(*) as registros FROM eventos
UNION ALL
SELECT 'Números Rifa' as tabla, COUNT(*) as registros FROM numeros_rifa
UNION ALL
SELECT 'Transacciones' as tabla, COUNT(*) as registros FROM transactions;
