const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const cache = new Map();
function getCached(key, ttl) { const e = cache.get(key); return e && Date.now() - e.ts < ttl ? e.data : null; }
function setCache(key, data) { cache.set(key, { data, ts: Date.now() }); }

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return httpsGet(res.headers.location).then(resolve, reject);
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function httpsGetBinary(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return httpsGetBinary(res.headers.location).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload); req.end();
  });
}

// ---- VAPID Keys for Web Push ----
const DATA_DIR = path.join(__dirname, '.data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
let vapidKeys;
try { vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')); }
catch { vapidKeys = webpush.generateVAPIDKeys(); fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys)); }
webpush.setVapidDetails('mailto:jarvis@market.app', vapidKeys.publicKey, vapidKeys.privateKey);

// ---- Persistent Storage ----
const SUBS_FILE = path.join(DATA_DIR, 'subs.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
let pushSubs = [];
let serverAlerts = [];
try { pushSubs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch {}
try { serverAlerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')); } catch {}
function saveSubs() { try { fs.writeFileSync(SUBS_FILE, JSON.stringify(pushSubs)); } catch {} }
function saveAlerts() { try { fs.writeFileSync(ALERTS_FILE, JSON.stringify(serverAlerts)); } catch {} }

// Market Data — Yahoo Finance proxy with caching
app.get('/api/chart/:symbol', async (req, res) => {
  const sym = req.params.symbol, range = req.query.range || '3mo', interval = req.query.interval || '1d';
  const key = `chart_${sym}_${range}_${interval}`;
  const c = getCached(key, 60000);
  if (c) return res.json(c);
  try {
    const suffix = sym.includes('.') || sym.startsWith('^') ? '' : '.NS';
    const raw = await httpsGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym + suffix)}?interval=${interval}&range=${range}`);
    const data = JSON.parse(raw);
    if (data?.chart?.error) throw new Error(data.chart.error.description);
    setCache(key, data); res.json(data);
  } catch (e) { res.status(502).json({ error: 'Market data unavailable: ' + e.message }); }
});

app.post('/api/quotes', async (req, res) => {
  const symbols = req.body.symbols || [], results = {}, toFetch = [];
  for (const s of symbols) { const c = getCached('q_' + s, 60000); if (c) results[s] = c; else toFetch.push(s); }
  if (toFetch.length) {
    await Promise.allSettled(toFetch.map(async sym => {
      try {
        const suffix = sym.includes('.') || sym.startsWith('^') ? '' : '.NS';
        const raw = await httpsGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym + suffix)}?interval=1d&range=5d`);
        const data = JSON.parse(raw);
        const r = data?.chart?.result?.[0];
        if (r) {
          const q = r.indicators?.quote?.[0];
          const entry = { price: r.meta?.regularMarketPrice, prevClose: r.meta?.previousClose || r.meta?.chartPreviousClose,
            high: q?.high?.slice(-1)?.[0], low: q?.low?.slice(-1)?.[0], volume: q?.volume?.slice(-1)?.[0] };
          results[sym] = entry; setCache('q_' + sym, entry);
        }
      } catch {}
    }));
  }
  res.json(results);
});

// News — Google News RSS proxy
app.get('/api/news', async (req, res) => {
  const q = req.query.q || 'Indian stock market NSE BSE NIFTY';
  const key = 'news_' + q, c = getCached(key, 300000);
  if (c) return res.json(c);
  try {
    const raw = await httpsGet(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`);
    const items = [];
    for (const m of (raw.match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, 20)) {
      const t = (m.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
      const l = (m.match(/<link[^>]*>\s*(https?:\/\/[^\s<]+)/) || [])[1] || '';
      const p = (m.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
      const s = (m.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';
      items.push({ title: t.replace(/<[^>]*>/g, '').trim(), link: l.trim(), pubDate: p.trim(), source: s.trim() });
    }
    const result = { items }; setCache(key, result); res.json(result);
  } catch (e) { res.status(502).json({ error: e.message, items: [] }); }
});

// Gemini AI proxy — uses official Google SDK (handles AQ-format keys)
const GEMINI_MODEL_NAMES = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
const SYS_PROMPT = 'You are Jarvis, a friendly AI stock market assistant for Indian markets (NSE/BSE). Rules: explain in simple English for a complete beginner with zero stock knowledge, always mention risks, use Indian Rupees (₹), be concise (under 200 words), never guarantee profits.';

app.post('/api/ai/gemini', async (req, res) => {
  const { apiKey, prompt, context } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'Gemini API key needed. Get free at ai.google.dev' });
  const prefix = apiKey.substring(0, 6);
  console.log(`Gemini request — key prefix: ${prefix}... (${apiKey.length} chars)`);
  const genAI = new GoogleGenerativeAI(apiKey);
  const errors = [];
  for (const modelName of GEMINI_MODEL_NAMES) {
    try {
      console.log(`Trying ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { temperature: 0.7, maxOutputTokens: 800 } });
      const result = await model.generateContent(`${SYS_PROMPT}\n\nMarket Context:\n${context || 'N/A'}\n\nUser: ${prompt}`);
      const text = result.response.text();
      if (text) { console.log(`  Success with ${modelName}`); return res.json({ reply: text, model: modelName }); }
    } catch (e) { errors.push(`${modelName}: ${e.message}`); console.log(`  Error: ${e.message}`); }
  }
  console.log('All models failed:', errors);
  res.status(500).json({ error: `All models failed. Last error: ${errors[errors.length - 1] || 'Unknown'}` });
});

// Key test endpoint — uses official SDK
app.post('/api/ai/test-key', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ valid: false, error: 'No key provided' });
  const prefix = apiKey.substring(0, 6);
  console.log(`Testing key: ${prefix}... (${apiKey.length} chars)`);
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite', generationConfig: { maxOutputTokens: 10 } });
    const result = await model.generateContent('Say hello');
    const text = result.response.text();
    if (text) return res.json({ valid: true, prefix });
    res.json({ valid: false, error: 'Empty response', prefix });
  } catch (e) {
    console.log(`  Test failed: ${e.message}`);
    res.json({ valid: false, error: e.message, prefix, hint: 'Check that the key is correct and the Generative Language API is enabled in your Google Cloud project' });
  }
});

// Claude AI proxy
app.post('/api/ai/claude', async (req, res) => {
  const { apiKey, prompt, context } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'Claude API key required' });
  try {
    const raw = await httpsPost('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514', max_tokens: 800,
      system: 'You are Jarvis, an AI stock market assistant for Indian markets. Explain in simple English for a beginner. Mention risks. Use ₹. Keep responses under 200 words.',
      messages: [{ role: 'user', content: `Context:\n${context || 'N/A'}\n\nQuestion: ${prompt}` }]
    }, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' });
    const data = JSON.parse(raw);
    const text = data?.content?.[0]?.text;
    if (!text) throw new Error(data?.error?.message || 'Empty response');
    res.json({ reply: text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Health Check (keeps Render awake) ----
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', alerts: serverAlerts.length, subs: pushSubs.length, uptime: process.uptime() | 0 });
});

// ---- TTS Proxy (Google Translate) ----
app.get('/api/tts', async (req, res) => {
  const text = (req.query.text || '').substring(0, 200);
  if (!text) return res.status(400).send('No text');
  const key = 'tts_' + text;
  const c = getCached(key, 3600000);
  if (c) { res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=3600' }); return res.send(c); }
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
    const audio = await httpsGetBinary(url);
    setCache(key, audio);
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=3600' });
    res.send(audio);
  } catch {
    res.status(500).json({ error: 'TTS unavailable' });
  }
});

// ---- Push Notification Endpoints ----
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body.subscription;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const idx = pushSubs.findIndex(s => s.endpoint === sub.endpoint);
  if (idx >= 0) pushSubs[idx] = sub; else pushSubs.push(sub);
  saveSubs();
  console.log(`Push subscription registered. Total: ${pushSubs.length}`);
  res.json({ success: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  pushSubs = pushSubs.filter(s => s.endpoint !== req.body.endpoint);
  saveSubs();
  res.json({ success: true });
});

// ---- Server-side Alert Sync ----
app.post('/api/alerts/sync', (req, res) => {
  const alerts = req.body.alerts || [];
  serverAlerts = alerts.filter(a => a.active && !a.triggered).map(a => ({
    id: a.id, symbol: a.symbol, condition: a.condition, targetPrice: a.targetPrice
  }));
  saveAlerts();
  console.log(`Alerts synced. Active: ${serverAlerts.length}`);
  res.json({ success: true, count: serverAlerts.length });
});

app.get('/api/alerts/status', (req, res) => {
  res.json({ activeAlerts: serverAlerts.length, subscribers: pushSubs.length, monitoring: serverAlerts.length > 0 && pushSubs.length > 0 });
});

// ---- Server-side Price Monitor (runs every 5 min) ----
async function monitorAlerts() {
  if (!serverAlerts.length || !pushSubs.length) return;
  const symbols = [...new Set(serverAlerts.map(a => a.symbol))];
  const prices = {};
  await Promise.allSettled(symbols.map(async sym => {
    try {
      const suffix = sym.includes('.') || sym.startsWith('^') ? '' : '.NS';
      const raw = await httpsGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym + suffix)}?interval=1d&range=5d`);
      const data = JSON.parse(raw);
      const p = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (p) prices[sym] = p;
    } catch {}
  }));

  const triggered = [];
  serverAlerts = serverAlerts.filter(alert => {
    const price = prices[alert.symbol];
    if (!price) return true;
    const met = (alert.condition === 'above' && price >= alert.targetPrice) || (alert.condition === 'below' && price <= alert.targetPrice);
    if (met) { triggered.push({ ...alert, currentPrice: price }); return false; }
    return true;
  });

  for (const t of triggered) {
    const payload = JSON.stringify({
      title: `Alert: ${t.symbol}`,
      body: `${t.symbol} ${t.condition === 'above' ? 'rose above' : 'fell below'} ₹${t.targetPrice.toLocaleString('en-IN')} — now ₹${t.currentPrice.toLocaleString('en-IN')}`,
      tag: 'jarvis-alert-' + t.id, url: '/'
    });
    const dead = [];
    for (const sub of pushSubs) {
      try { await webpush.sendNotification(sub, payload); }
      catch (e) { if (e.statusCode === 410 || e.statusCode === 404) dead.push(sub.endpoint); }
    }
    if (dead.length) { pushSubs = pushSubs.filter(s => !dead.includes(s.endpoint)); saveSubs(); }
    console.log(`ALERT TRIGGERED: ${t.symbol} ${t.condition} ₹${t.targetPrice} (now ₹${t.currentPrice})`);
  }
  if (triggered.length) saveAlerts();
}

setInterval(monitorAlerts, 5 * 60 * 1000);
setTimeout(monitorAlerts, 30000);

// Zerodha Kite Connect
let kiteSession = {};
app.get('/api/zerodha/login', (req, res) => {
  const k = req.query.api_key;
  if (!k) return res.status(400).json({ error: 'API key required' });
  res.json({ url: `https://kite.zerodha.com/connect/login?v=3&api_key=${k}` });
});
app.get('/api/zerodha/callback', (req, res) => {
  kiteSession = { apiKey: req.query.api_key, token: req.query.request_token, connected: true, ts: Date.now() };
  res.redirect('/?zerodha=connected');
});
app.get('/api/zerodha/status', (req, res) => res.json({ connected: !!kiteSession.connected }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n  ╔═══════════════════════════════════════╗');
  console.log('  ║   JARVIS v4.0 — AI Market Assistant   ║');
  console.log(`  ║   http://localhost:${PORT}                ║`);
  console.log('  ║   Push Alerts: ACTIVE                  ║');
  console.log('  ╚═══════════════════════════════════════╝\n');
});
