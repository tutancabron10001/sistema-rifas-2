-- Add transaction_number column to numeros_rifa
ALTER TABLE numeros_rifa ADD COLUMN transaction_number text;

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id integer PRIMARY KEY AUTOINCREMENT,
    transaction_number text NOT NULL UNIQUE,
    usuario_cedula text NOT NULL,
    usuario_nombre text NOT NULL,
    campaign_name text NOT NULL,
    event_id integer NOT NULL,
    event_name text NOT NULL,
    cantidad integer NOT NULL,
    promociones integer NOT NULL DEFAULT 0,
    precio_total real NOT NULL,
    created_at text NOT NULL
);
