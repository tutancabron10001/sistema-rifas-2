PRAGMA foreign_keys=OFF;

DELETE FROM transactions;
DELETE FROM numeros_rifa;
DELETE FROM eventos;
DELETE FROM usuarios;
DELETE FROM campaigns;

-- Reset autoincrement
DELETE FROM sqlite_sequence;

PRAGMA foreign_keys=ON;
