// ============================================
// HOTSPOT SERVER - Tanzania WiFi System
// Controls: Huawei AX3S via PC Agent
// Payments: Selcom (Airtel Money + Tigo Pesa)
// ============================================

const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const cron = require('node-cron');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(__dirname));

// ============ DATABASE ============
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ============ PACKAGES ============
const PACKAGES = {
  '1hr':    { name: '1 Saa',     minutes: 60,    price: 300   },
  '3hr':    { name: '3 Saa',     minutes: 180,   price: 700   },
  '12hr':   { name: '12 Saa',    minutes: 720,   price: 1200  },
  'daily':  { name: 'Siku Moja', minutes: 1440,  price: 2000  },
  'weekly': { name: 'Wiki Moja', minutes: 10080, price: 8000  }
};

// ============ DATABASE INIT ============
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(60) UNIQUE,
        mac_address VARCHAR(20),
        phone_number VARCHAR(20),
        package_id VARCHAR(10),
        voucher VARCHAR(20),
        amount INTEGER,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        status VARCHAR(10) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS commands (
        id SERIAL PRIMARY KEY,
        mac_address VARCHAR(20),
        action VARCHAR(10),
        executed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ DB init error:', err.message);
  }
}

// ============ HELPERS ============
function generateVoucher() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function generateTxId() {
  return `HSP-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

// ============ CAPTIVE PORTAL REDIRECTS ============
app.get('/generate_204', (req, res) => res.redirect('/'));
app.get('/hotspot-detect.html', (req, res) => res.redirect('/'));
app.get('/ncsi.txt', (req, res) => res.redirect('/'));
app.get('/connecttest.txt', (req, res) => res.redirect('/'));
app.get('/canonical.html', (req, res) => res.redirect('/'));

// ============ MAIN PORTAL ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'portal.html'));
});

// ============ API: GET PACKAGES ============
app.get('/api/packages', (req, res) => {
  res.json(PACKAGES);
});

// ============ API: INITIATE PAYMENT ============
app.post('/api/pay', async (req, res) => {
  const { phone, package: pkgId, mac } = req.body;

  if (!PACKAGES[pkgId]) {
    return res.status(400).json({ success: false, message: 'Package batili' });
  }

  const txId = generateTxId();
  const pkg = PACKAGES[pkgId];

  try {
    // Save pending session
    await pool.query(
      `INSERT INTO sessions (transaction_id, mac_address, phone_number, package_id, amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [txId, mac || 'pending', phone, pkgId, pkg.price]
    );

    // Call Selcom API for STK push
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const signature = crypto
      .createHmac('sha256', process.env.SELCOM_API_SECRET || 'test')
      .update(`${process.env.SELCOM_VENDOR_ID}${timestamp}`)
      .digest('base64');

    try {
      await axios.post(
        `${process.env.SELCOM_BASE_URL || 'https://apigw.selcommobile.com/v1'}/ussd-push/create-order-minimal`,
        {
          vendor: process.env.SELCOM_VENDOR_ID,
          order_id: txId,
          buyer_phone: phone,
          buyer_email: `${phone}@wifi.tz`,
          buyer_name: 'Mteja',
          amount: pkg.price,
          currency: 'TZS',
          webhook: `${process.env.SERVER_URL}/api/payment/callback`,
          cancel_url: `${process.env.SERVER_URL}/`,
          redirect_url: `${process.env.SERVER_URL}/`
        },
        {
          headers: {
            'Authorization': `SELCOM ${process.env.SELCOM_API_KEY}`,
            'Signature': signature,
            'Timestamp': timestamp,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (selcomErr) {
      console.log('Selcom call (will retry via webhook):', selcomErr.message);
    }

    res.json({
      success: true,
      transaction_id: txId,
      message: `Ombi limetumwa kwa ${phone}. Angalia simu yako ulipe TSh ${pkg.price.toLocaleString()}.`
    });

  } catch (err) {
    console.error('Payment error:', err.message);
    res.status(500).json({ success: false, message: 'Hitilafu. Jaribu tena.' });
  }
});

// ============ API: SELCOM PAYMENT CALLBACK ============
app.post('/api/payment/callback', async (req, res) => {
  console.log('📩 Callback received:', JSON.stringify(req.body));
  res.json({ status: 'received' });

  const { order_id, payment_status, msisdn } = req.body;
  if (payment_status !== 'COMPLETED') return;

  try {
    const result = await pool.query(
      'SELECT * FROM sessions WHERE transaction_id = $1',
      [order_id]
    );
    if (!result.rows.length) return;

    const session = result.rows[0];
    const pkg = PACKAGES[session.package_id];
    const voucher = generateVoucher();
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + pkg.minutes * 60 * 1000);

    await pool.query(
      `UPDATE sessions SET voucher=$1, start_time=$2, end_time=$3, status='active'
       WHERE transaction_id=$4`,
      [voucher, startTime, endTime, order_id]
    );

    // Queue ALLOW command for PC Agent
    await pool.query(
      'INSERT INTO commands (mac_address, action) VALUES ($1, $2)',
      [session.mac_address, 'allow']
    );

    console.log(`✅ Session activated: ${msisdn} until ${endTime}`);
  } catch (err) {
    console.error('Callback error:', err.message);
  }
});

// ============ API: CHECK PAYMENT STATUS ============
app.get('/api/status/:txId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT status, voucher, end_time, package_id FROM sessions WHERE transaction_id=$1',
      [req.params.txId]
    );
    if (!result.rows.length) return res.json({ status: 'not_found' });

    const s = result.rows[0];
    res.json({
      status: s.status,
      voucher: s.voucher,
      package: s.package_id ? PACKAGES[s.package_id]?.name : null,
      expires: s.end_time
    });
  } catch (err) {
    res.status(500).json({ status: 'error' });
  }
});

// ============ PC AGENT API ============
function checkAgentKey(req, res) {
  if (req.headers['x-agent-key'] !== process.env.AGENT_SECRET_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Get pending commands
app.get('/api/agent/commands', async (req, res) => {
  if (!checkAgentKey(req, res)) return;
  try {
    const result = await pool.query(
      'SELECT * FROM commands WHERE executed=FALSE ORDER BY created_at ASC LIMIT 20'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark command done
app.post('/api/agent/commands/:id/done', async (req, res) => {
  if (!checkAgentKey(req, res)) return;
  try {
    await pool.query('UPDATE commands SET executed=TRUE WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ CRON: CHECK EXPIRED SESSIONS (every minute) ============
cron.schedule('* * * * *', async () => {
  try {
    const result = await pool.query(
      `SELECT * FROM sessions WHERE status='active' AND end_time < NOW()`
    );
    for (const session of result.rows) {
      await pool.query(
        'INSERT INTO commands (mac_address, action) VALUES ($1, $2)',
        [session.mac_address, 'block']
      );
      await pool.query(
        `UPDATE sessions SET status='expired' WHERE id=$1`,
        [session.id]
      );
      console.log(`⏰ Expired: ${session.mac_address}`);
    }
  } catch (err) {
    console.error('Cron error:', err.message);
  }
});

// ============ ADMIN DASHBOARD ============
app.get('/admin', (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) {
    return res.status(401).send('<h2>Unauthorized - Weka admin key sahihi</h2>');
  }
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/admin/sessions', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM sessions ORDER BY created_at DESC LIMIT 200'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const today = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as revenue
       FROM sessions WHERE DATE(created_at)=CURRENT_DATE AND status!='pending'`
    );
    const active = await pool.query(
      `SELECT COUNT(*) as count FROM sessions WHERE status='active'`
    );
    const week = await pool.query(
      `SELECT COALESCE(SUM(amount),0) as revenue FROM sessions
       WHERE created_at >= NOW()-INTERVAL '7 days' AND status!='pending'`
    );
    res.json({
      today_sales: today.rows[0].count,
      today_revenue: today.rows[0].revenue,
      active_sessions: active.rows[0].count,
      week_revenue: week.rows[0].revenue
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDB();
  console.log(`🚀 Hotspot server running on port ${PORT}`);
  console.log(`📡 Admin: ${process.env.SERVER_URL}/admin?key=${process.env.ADMIN_KEY}`);
});
