const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set. Copy .env.example to .env and fill it in, or set it in your host\'s environment variables.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // required by most managed free Postgres (Supabase/Neon)
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      batch TEXT DEFAULT '',
      hsn TEXT DEFAULT '',
      drug_code TEXT DEFAULT '',
      supplier TEXT DEFAULT '',
      qty INTEGER NOT NULL DEFAULT 0,
      minstock INTEGER NOT NULL DEFAULT 10,
      purchase NUMERIC(12,2) NOT NULL DEFAULT 0,
      sell NUMERIC(12,2) NOT NULL DEFAULT 0,
      expiry DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Safe to run repeatedly — adds the columns if this table already existed before this feature
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS hsn TEXT DEFAULT '';`);
  await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS drug_code TEXT DEFAULT '';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      bill_date TIMESTAMPTZ NOT NULL DEFAULT now(),
      customer TEXT DEFAULT 'Walk-in customer',
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bill_items (
      id SERIAL PRIMARY KEY,
      bill_id TEXT REFERENCES bills(id) ON DELETE CASCADE,
      med_id TEXT,
      name TEXT NOT NULL,
      batch TEXT DEFAULT '',
      qty INTEGER NOT NULL,
      price NUMERIC(12,2) NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_items_expiry ON items(expiry);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(bill_date);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_items_name_batch ON items (lower(name), batch);`);

  console.log('Database schema ready.');
}

module.exports = { pool, initDb };
