require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, initDb } = require('./src/db');
const { buildDailyReport } = require('./src/reportUtil');
const { sendReportEmail } = require('./src/mailer');
const { startCronJobs } = require('./src/cronJobs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function newId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

/* ---------------- INVENTORY ---------------- */

app.get('/api/inventory', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM items ORDER BY expiry ASC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const { name, batch, supplier, qty, minstock, purchase, sell, expiry } = req.body;
    if (!name || !expiry) return res.status(400).json({ error: 'name and expiry are required' });
    const id = newId('m');
    const { rows } = await pool.query(
      `INSERT INTO items (id, name, batch, supplier, qty, minstock, purchase, sell, expiry)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, name, batch || '', supplier || '', qty || 0, minstock || 10, purchase || 0, sell || 0, expiry]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const { name, batch, supplier, qty, minstock, purchase, sell, expiry } = req.body;
    const { rows } = await pool.query(
      `UPDATE items SET name=$1, batch=$2, supplier=$3, qty=$4, minstock=$5, purchase=$6, sell=$7, expiry=$8, updated_at=now()
       WHERE id=$9 RETURNING *`,
      [name, batch || '', supplier || '', qty || 0, minstock || 10, purchase || 0, sell || 0, expiry, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM items WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk import — used by the invoice-import screen (PDF-parsed or pre-parsed JSON rows).
// Runs upserts in parallel (bounded by the connection pool) instead of one-at-a-time,
// since looping serially through 200+ rows against a remote database can take minutes.
app.post('/api/inventory/import', async (req, res) => {
  const rows = (req.body.items || []).filter(r => r.name && r.expiry);
  if (!rows.length) return res.status(400).json({ error: 'No valid rows (each needs at least name and expiry).' });

  try {
    // Figure out added vs updated counts up front (cheap: one query, compared in memory)
    const { rows: existingRows } = await pool.query('SELECT lower(name) AS n, batch FROM items');
    const existingSet = new Set(existingRows.map(r => r.n + '|' + (r.batch || '')));
    let added = 0, updated = 0;
    rows.forEach(r => {
      const key = r.name.toLowerCase() + '|' + (r.batch || '');
      if (existingSet.has(key)) updated++; else added++;
    });

    // Run all upserts concurrently — the pg pool queues beyond its connection limit,
    // so this is safe and still far faster than one query at a time.
    await Promise.all(rows.map(row => {
      const id = newId('m');
      return pool.query(
        `INSERT INTO items (id, name, batch, supplier, qty, minstock, purchase, sell, expiry)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (lower(name), batch) DO UPDATE SET
           qty = items.qty + EXCLUDED.qty,
           purchase = EXCLUDED.purchase,
           sell = EXCLUDED.sell,
           expiry = EXCLUDED.expiry,
           supplier = COALESCE(NULLIF(EXCLUDED.supplier, ''), items.supplier),
           updated_at = now()`,
        [id, row.name, row.batch || '', row.supplier || '', Math.trunc(Number(row.qty)) || 0,
         Math.trunc(Number(row.minstock)) || 10, Number(row.purchase) || 0, Number(row.sell) || 0, row.expiry]
      );
    }));

    res.json({ added, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- BILLING ---------------- */

app.get('/api/bills', async (req, res) => {
  try {
    const { rows: bills } = await pool.query('SELECT * FROM bills ORDER BY bill_date DESC LIMIT 100');
    const ids = bills.map(b => b.id);
    let items = [];
    if (ids.length) {
      const { rows } = await pool.query('SELECT * FROM bill_items WHERE bill_id = ANY($1::text[])', [ids]);
      items = rows;
    }
    const withItems = bills.map(b => ({ ...b, items: items.filter(i => i.bill_id === b.id) }));
    res.json(withItems);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bills', async (req, res) => {
  const client = await pool.connect();
  try {
    const { customer, items, subtotal, discount, tax, total } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items required' });

    await client.query('BEGIN');

    for (const it of items) {
      const { rows } = await client.query('SELECT qty FROM items WHERE id=$1 FOR UPDATE', [it.medId]);
      if (!rows.length || rows[0].qty < it.qty) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Not enough stock for ${it.name}` });
      }
      await client.query('UPDATE items SET qty = qty - $1, updated_at = now() WHERE id=$2', [it.qty, it.medId]);
    }

    const billId = newId('b');
    await client.query(
      `INSERT INTO bills (id, customer, subtotal, discount, tax, total) VALUES ($1,$2,$3,$4,$5,$6)`,
      [billId, customer || 'Walk-in customer', subtotal || 0, discount || 0, tax || 0, total || 0]
    );
    for (const it of items) {
      await client.query(
        `INSERT INTO bill_items (bill_id, med_id, name, batch, qty, price) VALUES ($1,$2,$3,$4,$5,$6)`,
        [billId, it.medId, it.name, it.batch || '', it.qty, it.price]
      );
    }

    await client.query('COMMIT');
    const { rows: billRow } = await pool.query('SELECT * FROM bills WHERE id=$1', [billId]);
    res.status(201).json({ ...billRow[0], items });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ---------------- REPORTS ---------------- */

app.get('/api/reports/daily', async (req, res) => {
  try {
    const { data } = await buildDailyReport(req.query.date);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reports/send-now', async (req, res) => {
  try {
    const { html } = await buildDailyReport(req.body.date);
    await sendReportEmail('MedStock — Daily Report', html);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- START ---------------- */

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`MedStock server listening on port ${PORT}`));
    startCronJobs();
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
