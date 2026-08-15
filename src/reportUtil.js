const { pool } = require('./db');

function fmtMoney(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

async function buildDailyReport(dateStr) {
  const date = dateStr || new Date().toISOString().slice(0, 10);

  const { rows: items } = await pool.query('SELECT * FROM items ORDER BY expiry ASC');
  const { rows: dayBills } = await pool.query(
    `SELECT * FROM bills WHERE bill_date::date = $1::date ORDER BY bill_date DESC`,
    [date]
  );
  const billIds = dayBills.map(b => b.id);
  let dayBillItems = [];
  if (billIds.length) {
    const { rows } = await pool.query(
      `SELECT * FROM bill_items WHERE bill_id = ANY($1::text[])`,
      [billIds]
    );
    dayBillItems = rows;
  }

  const revenue = dayBills.reduce((s, b) => s + Number(b.total), 0);
  const soldMap = {};
  let cost = 0;
  dayBillItems.forEach(bi => {
    soldMap[bi.name] = (soldMap[bi.name] || 0) + bi.qty;
    const inv = items.find(it => it.id === bi.med_id);
    if (inv) cost += Number(inv.purchase) * bi.qty;
  });
  const profit = revenue - cost;
  const topSelling = Object.entries(soldMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const todayDate = new Date(date);
  const daysUntil = (expiry) => Math.round((new Date(expiry) - todayDate) / 86400000);

  const expired = items.filter(it => daysUntil(it.expiry) < 0);
  const soon = items.filter(it => { const d = daysUntil(it.expiry); return d >= 0 && d <= 30; });
  const low = items.filter(it => Number(it.qty) <= Number(it.minstock));
  const stockValue = items.reduce((s, it) => s + Number(it.qty) * Number(it.purchase), 0);

  const data = { date, billCount: dayBills.length, revenue, profit, topSelling, stockValue, itemCount: items.length, expired, soon, low };

  const html = `
    <div style="font-family:sans-serif; max-width:600px; margin:0 auto;">
      <h2 style="margin-bottom:4px;">MedStock — Daily Report</h2>
      <p style="color:#555; margin-top:0;">${new Date(date).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })}</p>
      <p><strong>${dayBills.length}</strong> bill(s), revenue <strong>${fmtMoney(revenue)}</strong>, est. profit <strong>${fmtMoney(profit)}</strong>.</p>

      <h3>Top selling</h3>
      ${topSelling.length ? '<ul>' + topSelling.map(([n,q]) => `<li>${n} — ${q} units</li>`).join('') + '</ul>' : '<p>No sales recorded.</p>'}

      <h3>Stock value (current)</h3>
      <p>${fmtMoney(stockValue)} across ${items.length} SKUs.</p>

      <h3 style="color:${expired.length ? '#A23B2E' : '#333'};">Expired (${expired.length})</h3>
      ${expired.length ? '<ul>' + expired.map(it => `<li>${it.name} — batch ${it.batch||'—'}, qty ${it.qty}, expired ${Math.abs(daysUntil(it.expiry))} days ago</li>`).join('') + '</ul>' : '<p>None.</p>'}

      <h3 style="color:${soon.length ? '#B8791E' : '#333'};">Expiring within 30 days (${soon.length})</h3>
      ${soon.length ? '<ul>' + soon.map(it => `<li>${it.name} — batch ${it.batch||'—'}, qty ${it.qty}, ${daysUntil(it.expiry)} days left</li>`).join('') + '</ul>' : '<p>None.</p>'}

      <h3>Low stock (${low.length})</h3>
      ${low.length ? '<ul>' + low.map(it => `<li>${it.name} — ${it.qty} left (threshold ${it.minstock})</li>`).join('') + '</ul>' : '<p>All above reorder threshold.</p>'}
    </div>
  `;

  return { data, html };
}

module.exports = { buildDailyReport };
