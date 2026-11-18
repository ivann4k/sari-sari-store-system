require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'client')));

let pool;
const LOW_STOCK = 5;
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Server error' }); });
const isMoney = (v) => typeof v === 'number' && isFinite(v) && v > 0;
const isQty = (v) => Number.isInteger(v) && v >= 0;

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Inventory ----
app.get('/api/products', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM products WHERE name LIKE ? ORDER BY name', [`%${req.query.q || ''}%`]);
  res.json(rows.map((r) => ({ ...r, price: Number(r.price), low: r.stock <= LOW_STOCK })));
}));

app.post('/api/products', wrap(async (req, res) => {
  const { name, price, stock } = req.body;
  if (!name || !String(name).trim() || !isMoney(price) || !isQty(stock))
    return res.status(400).json({ error: 'Valid name, price and stock are required.' });
  const [r] = await pool.query('INSERT INTO products (name, price, stock) VALUES (?,?,?)', [String(name).trim(), price, stock]);
  res.status(201).json({ id: r.insertId });
}));

app.put('/api/products/:id', wrap(async (req, res) => {
  const { name, price } = req.body;
  if (!name || !String(name).trim() || !isMoney(price)) return res.status(400).json({ error: 'Valid name and price required.' });
  const [r] = await pool.query('UPDATE products SET name=?, price=? WHERE id=?', [String(name).trim(), price, req.params.id]);
  r.affectedRows ? res.json({ ok: true }) : res.status(404).json({ error: 'Product not found.' });
}));

app.patch('/api/products/:id/restock', wrap(async (req, res) => {
  const qty = req.body.quantity;
  if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'Quantity must be at least 1.' });
  const [r] = await pool.query('UPDATE products SET stock = stock + ? WHERE id=?', [qty, req.params.id]);
  r.affectedRows ? res.json({ ok: true }) : res.status(404).json({ error: 'Product not found.' });
}));

app.delete('/api/products/:id', wrap(async (req, res) => {
  const [r] = await pool.query('DELETE FROM products WHERE id=?', [req.params.id]);
  r.affectedRows ? res.json({ ok: true }) : res.status(404).json({ error: 'Product not found.' });
}));

// ---- Sales ----
app.post('/api/sales', wrap(async (req, res) => {
  const { items, payment } = req.body;
  if (!Array.isArray(items) || !items.length || typeof payment !== 'number')
    return res.status(400).json({ error: 'Items and payment are required.' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const lines = [];
    let total = 0;
    for (const it of items) {
      if (!Number.isInteger(it.productId) || !Number.isInteger(it.quantity) || it.quantity < 1) throw { status: 400, msg: 'Invalid item.' };
      const [[p]] = await conn.query('SELECT * FROM products WHERE id=? FOR UPDATE', [it.productId]);
      if (!p) throw { status: 404, msg: 'Product not found.' };
      if (p.stock < it.quantity) throw { status: 409, msg: `Not enough stock for ${p.name}. Only ${p.stock} left.` };
      const subtotal = Math.round(Number(p.price) * it.quantity * 100) / 100;
      total += subtotal;
      lines.push({ p, qty: it.quantity, subtotal });
    }
    total = Math.round(total * 100) / 100;
    if (payment < total) throw { status: 400, msg: 'Payment is less than the total.' };
    const change = Math.round((payment - total) * 100) / 100;
    const [s] = await conn.query('INSERT INTO sales (total, payment, change_amount) VALUES (?,?,?)', [total, payment, change]);
    for (const l of lines) {
      await conn.query('INSERT INTO sale_items (sale_id, product_id, product_name, price, quantity, subtotal) VALUES (?,?,?,?,?,?)',
        [s.insertId, l.p.id, l.p.name, l.p.price, l.qty, l.subtotal]);
      await conn.query('UPDATE products SET stock = stock - ? WHERE id=?', [l.qty, l.p.id]);
    }
    await conn.commit();
    res.status(201).json({ id: s.insertId, total, payment, change });
  } catch (e) {
    await conn.rollback();
    if (e.status) return res.status(e.status).json({ error: e.msg });
    throw e;
  } finally { conn.release(); }
}));

app.get('/api/sales', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.id, s.total, s.payment, s.change_amount, s.created_at, COALESCE(SUM(i.quantity),0) AS items
     FROM sales s LEFT JOIN sale_items i ON i.sale_id = s.id GROUP BY s.id ORDER BY s.id DESC LIMIT 100`);
  res.json(rows.map((r) => ({ ...r, total: Number(r.total), payment: Number(r.payment), change_amount: Number(r.change_amount), items: Number(r.items) })));
}));

app.get('/api/reports/daily', wrap(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date().toISOString().slice(0, 10);
  const [[t]] = await pool.query('SELECT COUNT(*) AS transactions, COALESCE(SUM(total),0) AS income FROM sales WHERE DATE(created_at)=?', [date]);
  const [items] = await pool.query(
    `SELECT i.product_name AS name, SUM(i.quantity) AS quantity, SUM(i.subtotal) AS revenue
     FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE DATE(s.created_at)=? GROUP BY i.product_name ORDER BY quantity DESC`, [date]);
  res.json({ date, transactions: t.transactions, income: Number(t.income), items: items.map((i) => ({ name: i.name, quantity: Number(i.quantity), revenue: Number(i.revenue) })) });
}));

// ---- Start ----
(async () => {
  const cfg = { host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true, dateStrings: true };
  pool = mysql.createPool(cfg);
  await pool.query(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'));
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`Sari-Sari Store API running at http://localhost:${port}`));
})().catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
