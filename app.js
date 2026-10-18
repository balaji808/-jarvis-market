// ================================================================
// JARVIS v3.0 — Full-Featured AI Market Assistant
// ================================================================

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const fmt = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtCur = n => '₹' + fmt(n);

// ---- STORAGE (IndexedDB) ----
const Store = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('JarvisDB', 3);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('trades')) db.createObjectStore('trades', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async get(key, fallback = null) {
    try {
      const db = await this.open();
      return new Promise(resolve => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : fallback);
        req.onerror = () => resolve(fallback);
      });
    } catch { return fallback; }
  },
  async set(key, val) {
    try {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {}
  },
  async addTrade(trade) {
    try {
      const db = await this.open();
      return new Promise(resolve => {
        const tx = db.transaction('trades', 'readwrite');
        tx.objectStore('trades').add(trade);
        tx.oncomplete = () => resolve();
      });
    } catch {}
  },
  async getTrades() {
    try {
      const db = await this.open();
      return new Promise(resolve => {
        const tx = db.transaction('trades', 'readonly');
        const req = tx.objectStore('trades').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch { return []; }
  }
};

// ---- LIVE DATA ENGINE ----
const LiveData = {
  _available: false,
  _quotes: {},

  async fetchQuotes(symbols) {
    try {
      const yahooSyms = symbols.map(s => Market.stocks[s]?.yahoo || s);
      const symMap = {};
      symbols.forEach((s, i) => { symMap[yahooSyms[i]] = s; });
      const resp = await fetch('/api/quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: yahooSyms })
      });
      if (!resp.ok) throw new Error('Failed');
      const data = await resp.json();
      for (const [ySym, entry] of Object.entries(data)) {
        const internal = symMap[ySym] || ySym;
        this._quotes[internal] = entry;
      }
      this._available = Object.keys(data).length > 0;
    } catch {
      this._available = false;
    }
  },

  getPrice(sym) { return this._quotes[sym]?.price || null; },
  getChange(sym) {
    const q = this._quotes[sym];
    if (!q || !q.prevClose) return null;
    const abs = +(q.price - q.prevClose).toFixed(2);
    const pct = +(abs / q.prevClose * 100).toFixed(2);
    return { abs, pct };
  },
  isAvailable() { return this._available; }
};

// ---- MARKET DATA ENGINE (30 stocks + 4 indices) ----
const Market = {
  stocks: {
    NIFTY:      { name: 'NIFTY 50',          base: 24862, sector: 'Index',          yahoo: '^NSEI',    color: '#00d4ff' },
    SENSEX:     { name: 'BSE SENSEX',         base: 81510, sector: 'Index',          yahoo: '^BSESN',   color: '#7c4dff' },
    BANKNIFTY:  { name: 'Bank NIFTY',         base: 52340, sector: 'Index',          yahoo: '^NSEBANK', color: '#ff9800' },
    NIFTYIT:    { name: 'NIFTY IT',           base: 41205, sector: 'Index',          yahoo: '^CNXIT',   color: '#4caf50' },
    TCS:        { name: 'Tata Consultancy',   base: 4185,  sector: 'IT',             color: '#1a73e8' },
    INFY:       { name: 'Infosys',            base: 1892,  sector: 'IT',             color: '#0277bd' },
    WIPRO:      { name: 'Wipro Ltd',          base: 562,   sector: 'IT',             color: '#6a1b9a' },
    HCLTECH:    { name: 'HCL Technologies',   base: 1825,  sector: 'IT',             color: '#283593' },
    TECHM:      { name: 'Tech Mahindra',      base: 1685,  sector: 'IT',             color: '#1565c0' },
    HDFCBANK:   { name: 'HDFC Bank',          base: 1782,  sector: 'Banking',        color: '#004d8e' },
    ICICIBANK:  { name: 'ICICI Bank',         base: 1272,  sector: 'Banking',        color: '#f57c00' },
    SBIN:       { name: 'State Bank of India',base: 812,   sector: 'Banking',        color: '#1a237e' },
    KOTAKBANK:  { name: 'Kotak Mahindra Bank',base: 1834,  sector: 'Banking',        color: '#e53935' },
    AXISBANK:   { name: 'Axis Bank',          base: 1175,  sector: 'Banking',        color: '#880e4f' },
    RELIANCE:   { name: 'Reliance Industries',base: 2945,  sector: 'Conglomerate',   color: '#e65100' },
    TATAMOTORS: { name: 'Tata Motors',        base: 785,   sector: 'Auto',           color: '#1565c0' },
    MARUTI:     { name: 'Maruti Suzuki',      base: 12450, sector: 'Auto',           color: '#d32f2f' },
    HINDUNILVR: { name: 'Hindustan Unilever', base: 2585,  sector: 'FMCG',           color: '#1b5e20' },
    ITC:        { name: 'ITC Limited',        base: 492,   sector: 'FMCG',           color: '#2e7d32' },
    BHARTIARTL: { name: 'Bharti Airtel',      base: 1685,  sector: 'Telecom',        color: '#d32f2f' },
    SUNPHARMA:  { name: 'Sun Pharmaceutical', base: 1795,  sector: 'Pharma',         color: '#f9a825' },
    BAJFINANCE: { name: 'Bajaj Finance',      base: 7285,  sector: 'NBFC',           color: '#00695c' },
    LT:         { name: 'Larsen & Toubro',    base: 3615,  sector: 'Infrastructure', color: '#0d47a1' },
    ADANIENT:   { name: 'Adani Enterprises',  base: 2945,  sector: 'Infrastructure', color: '#004d40' },
    TITAN:      { name: 'Titan Company',      base: 3685,  sector: 'Consumer',       color: '#bf360c' },
    ASIANPAINT: { name: 'Asian Paints',       base: 2865,  sector: 'Consumer',       color: '#e65100' },
    ONGC:       { name: 'ONGC',               base: 242,   sector: 'Oil & Gas',      color: '#33691e' },
    TATASTEEL:  { name: 'Tata Steel',         base: 142,   sector: 'Metals',         color: '#37474f' },
    JSWSTEEL:   { name: 'JSW Steel',          base: 925,   sector: 'Metals',         color: '#546e7a' },
    NTPC:       { name: 'NTPC Limited',       base: 365,   sector: 'Power',          color: '#1b5e20' },
    POWERGRID:  { name: 'Power Grid Corp',    base: 315,   sector: 'Power',          color: '#2e7d32' },
    COALINDIA:  { name: 'Coal India',         base: 488,   sector: 'Mining',         color: '#3e2723' },
    ZOMATO:     { name: 'Zomato Ltd',         base: 268,   sector: 'Food Tech',      color: '#e23744' },
    ULTRACEMCO: { name: 'UltraTech Cement',   base: 11245, sector: 'Cement',         color: '#5d4037' },
  },

  _cache: {},
  _seed: 42,

  seededRandom() {
    this._seed = (this._seed * 16807 + 0) % 2147483647;
    return (this._seed - 1) / 2147483646;
  },

  generateCandles(symbol, days = 90) {
    const info = this.stocks[symbol];
    if (!info) return [];
    this._seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const candles = [];
    let price = info.base * (0.85 + this.seededRandom() * 0.15);
    const now = new Date();
    for (let i = days; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const vol = info.base * 0.015;
      const trend = 0.001 + this.seededRandom() * 0.001;
      const open = price;
      const changeRange = vol * (0.5 + this.seededRandom());
      const close = open + (this.seededRandom() > 0.45 ? 1 : -1) * changeRange * this.seededRandom() + open * trend;
      const high = Math.max(open, close) + vol * this.seededRandom() * 0.5;
      const low = Math.min(open, close) - vol * this.seededRandom() * 0.5;
      candles.push({ time: d.toISOString().split('T')[0], open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2), volume: Math.floor(500000 + this.seededRandom() * 2000000) });
      price = close;
    }
    return candles;
  },

  getPrice(symbol) {
    const live = LiveData.getPrice(symbol);
    if (live) return live;
    const candles = this.getCandles(symbol);
    if (!candles.length) return this.stocks[symbol]?.base || 0;
    return candles[candles.length - 1].close;
  },

  getCandles(symbol, days = 90) {
    const key = symbol + '_' + days;
    if (!this._cache[key]) this._cache[key] = this.generateCandles(symbol, days);
    return this._cache[key];
  },

  getChange(symbol) {
    const live = LiveData.getChange(symbol);
    if (live) return live;
    const candles = this.getCandles(symbol);
    if (candles.length < 2) return { abs: 0, pct: 0 };
    const prev = candles[candles.length - 2].close;
    const curr = candles[candles.length - 1].close;
    return { abs: +(curr - prev).toFixed(2), pct: +(((curr - prev) / prev) * 100).toFixed(2) };
  },

  isMarketOpen() {
    const now = new Date();
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const h = ist.getHours(), m = ist.getMinutes(), d = ist.getDay();
    return d >= 1 && d <= 5 && ((h === 9 && m >= 15) || (h > 9 && h < 15) || (h === 15 && m <= 30));
  },

  getMarketStatusText() {
    const now = new Date();
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const h = ist.getHours(), m = ist.getMinutes(), d = ist.getDay();
    if (d < 1 || d > 5) return { text: 'Weekend', dot: 'dot-red' };
    if (h === 9 && m < 15) return { text: 'Pre-Open', dot: 'dot-yellow' };
    if ((h === 9 && m >= 15) || (h > 9 && h < 15) || (h === 15 && m <= 30))
      return { text: 'Market Open', dot: 'dot-green' };
    return { text: 'Market Closed', dot: 'dot-red' };
  },

  getTradeableSymbols() {
    return Object.keys(this.stocks).filter(s => this.stocks[s].sector !== 'Index');
  }
};

// ---- TECHNICAL ANALYSIS ENGINE ----
const TA = {
  sma(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
      result.push(+(sum / period).toFixed(2));
    }
    return result;
  },

  ema(data, period) {
    const k = 2 / (period + 1);
    const result = [];
    let prev = null;
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      if (prev === null) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
        prev = sum / period;
      } else {
        prev = data[i].close * k + prev * (1 - k);
      }
      result.push(+prev.toFixed(2));
    }
    return result;
  },

  rsi(data, period = 14) {
    if (data.length < period + 1) return { value: 50, signal: 'Neutral', class: 'signal-neutral' };
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
      const diff = data[i].close - data[i - 1].close;
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / period, avgLoss = losses / period;
    if (avgLoss === 0) return { value: 100, signal: 'Overbought', class: 'signal-sell' };
    const rs = avgGain / avgLoss;
    const rsi = +(100 - 100 / (1 + rs)).toFixed(1);
    return { value: rsi, signal: rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral',
      class: rsi > 70 ? 'signal-sell' : rsi < 30 ? 'signal-buy' : 'signal-neutral' };
  },

  macd(data) {
    const ema12 = this.ema(data, 12), ema26 = this.ema(data, 26);
    const macdLine = [];
    for (let i = 0; i < data.length; i++) {
      if (ema12[i] === null || ema26[i] === null) macdLine.push(null);
      else macdLine.push(+(ema12[i] - ema26[i]).toFixed(2));
    }
    const last = macdLine.filter(v => v !== null);
    if (last.length < 2) return { value: 0, signal: 'Neutral', class: 'signal-neutral' };
    const val = last[last.length - 1], prev = last[last.length - 2];
    return { value: val,
      signal: val > 0 && val > prev ? 'Bullish' : val < 0 && val < prev ? 'Bearish' : 'Neutral',
      class: val > 0 && val > prev ? 'signal-buy' : val < 0 && val < prev ? 'signal-sell' : 'signal-neutral' };
  },

  bollingerBands(data, period = 20) {
    if (data.length < period) return { upper: 0, middle: 0, lower: 0, signal: 'Neutral', class: 'signal-neutral' };
    const slice = data.slice(-period);
    const mean = slice.reduce((s, d) => s + d.close, 0) / period;
    const variance = slice.reduce((s, d) => s + Math.pow(d.close - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    const upper = +(mean + 2 * std).toFixed(2), lower = +(mean - 2 * std).toFixed(2);
    const last = data[data.length - 1].close;
    let signal = 'Within Band', cls = 'signal-neutral';
    if (last >= upper) { signal = 'Near Upper (Overbought)'; cls = 'signal-sell'; }
    if (last <= lower) { signal = 'Near Lower (Oversold)'; cls = 'signal-buy'; }
    return { upper, middle: +mean.toFixed(2), lower, signal, class: cls };
  },

  vwap(data) {
    if (data.length < 5) return { value: 0, signal: 'Neutral', class: 'signal-neutral' };
    const recent = data.slice(-20);
    let cumVP = 0, cumV = 0;
    for (const d of recent) { const tp = (d.high + d.low + d.close) / 3; cumVP += tp * d.volume; cumV += d.volume; }
    const vwap = +(cumVP / cumV).toFixed(2);
    const last = data[data.length - 1].close;
    return { value: vwap,
      signal: last > vwap ? 'Price Above (Bullish)' : 'Price Below (Bearish)',
      class: last > vwap ? 'signal-buy' : 'signal-sell' };
  },

  adx(data, period = 14) {
    if (data.length < period * 2) return { value: 25, signal: 'Moderate Trend', class: 'signal-neutral' };
    let sumDX = 0;
    for (let i = data.length - period; i < data.length; i++) {
      const high = data[i].high, low = data[i].low;
      const pHigh = data[i - 1].high, pLow = data[i - 1].low;
      const plusDM = Math.max(0, high - pHigh), minusDM = Math.max(0, pLow - low);
      const tr = Math.max(high - low, Math.abs(high - data[i - 1].close), Math.abs(low - data[i - 1].close));
      if (tr === 0) continue;
      const di = Math.abs(plusDM - minusDM) / (plusDM + minusDM || 1);
      sumDX += di;
    }
    const adx = +(sumDX / period * 100).toFixed(1);
    const capped = Math.min(adx, 100);
    return { value: capped,
      signal: capped > 50 ? 'Strong Trend' : capped > 25 ? 'Moderate Trend' : 'Weak/No Trend',
      class: capped > 50 ? 'signal-buy' : capped > 25 ? 'signal-neutral' : 'signal-sell' };
  },

  getAll(symbol) {
    const candles = Market.getCandles(symbol);
    return { rsi: this.rsi(candles), macd: this.macd(candles), bb: this.bollingerBands(candles),
      vwap: this.vwap(candles), adx: this.adx(candles), sma20: this.sma(candles, 20), sma50: this.sma(candles, 50), ema12: this.ema(candles, 12) };
  },

  overallSignal(symbol) {
    const ind = this.getAll(symbol);
    let score = 0, total = 0;
    if (ind.rsi.value < 30) score += 2; else if (ind.rsi.value > 70) score -= 2; total += 2;
    if (ind.macd.class === 'signal-buy') score += 2; else if (ind.macd.class === 'signal-sell') score -= 2; total += 2;
    if (ind.bb.class === 'signal-buy') score += 1; else if (ind.bb.class === 'signal-sell') score -= 1; total += 1;
    if (ind.vwap.class === 'signal-buy') score += 1.5; else if (ind.vwap.class === 'signal-sell') score -= 1.5; total += 1.5;
    if (ind.adx.value > 25) score += 0.5; total += 0.5;
    const pct = ((score / total + 1) / 2 * 100);
    if (pct > 65) return { action: 'BUY', confidence: Math.min(95, Math.round(pct)), label: 'Bullish' };
    if (pct < 35) return { action: 'SELL', confidence: Math.min(95, Math.round(100 - pct)), label: 'Bearish' };
    return { action: 'HOLD', confidence: Math.round(50 + Math.abs(pct - 50) * 0.5), label: 'Neutral' };
  }
};

// ---- AI ENGINE (Gemini + Claude) ----
const AI = {
  _config: { geminiKey: '', claudeKey: '', engine: 'gemini' },

  async load() {
    const cfg = await Store.get('config', {});
    this._config.geminiKey = cfg.geminiKey || '';
    this._config.claudeKey = cfg.claudeKey || '';
    this._config.engine = cfg.aiEngine || 'gemini';
  },

  isConfigured() {
    if (this._config.engine === 'gemini') return !!this._config.geminiKey;
    if (this._config.engine === 'claude') return !!this._config.claudeKey;
    return !!this._config.geminiKey || !!this._config.claudeKey;
  },

  getEngineName() {
    if (!this.isConfigured()) return 'Offline';
    if (this._config.engine === 'gemini' && this._config.geminiKey) return 'Gemini';
    if (this._config.engine === 'claude' && this._config.claudeKey) return 'Claude';
    return this._config.geminiKey ? 'Gemini' : 'Claude';
  },

  buildContext() {
    const nifty = Market.getPrice('NIFTY'), nch = Market.getChange('NIFTY');
    const pnl = Portfolio.getPnL();
    const topBuy = (UI.signals || []).filter(s => s.action === 'BUY').slice(0, 3).map(s => `${s.symbol}(${s.confidence}%)`).join(', ');
    return `NIFTY: ${fmt(nifty)} (${nch.pct >= 0 ? '+' : ''}${nch.pct}%), SENSEX: ${fmt(Market.getPrice('SENSEX'))}
Status: ${Market.isMarketOpen() ? 'Open' : 'Closed'} | Live: ${LiveData.isAvailable() ? 'Yes' : 'Simulated'}
Portfolio: ${fmtCur(Portfolio.getTotalValue())} (${pnl.pct >= 0 ? '+' : ''}${pnl.pct}%), ${Portfolio.data.holdings.length} stocks
Top Buys: ${topBuy || 'None'}`;
  },

  async chat(prompt) {
    const context = this.buildContext();
    if (this._config.engine !== 'claude' && this._config.geminiKey) {
      const r = await fetch('/api/ai/gemini', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: this._config.geminiKey, prompt, context }) });
      const d = await r.json(); if (d.error) throw new Error(d.error); return d.reply;
    }
    if (this._config.claudeKey) {
      const r = await fetch('/api/ai/claude', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: this._config.claudeKey, prompt, context }) });
      const d = await r.json(); if (d.error) throw new Error(d.error); return d.reply;
    }
    if (this._config.geminiKey) {
      const r = await fetch('/api/ai/gemini', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: this._config.geminiKey, prompt, context }) });
      const d = await r.json(); if (d.error) throw new Error(d.error); return d.reply;
    }
    return null;
  }
};

// ---- VOICE ASSISTANT (Siri-like) ----
const Voice = {
  _recognition: null,
  _audioCtx: null,
  _speaking: false,
  _enabled: true,
  _supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  _greeted: false,
  _voiceMode: false,
  _unlocked: false,
  _pendingText: null,
  _ackBuffers: [],
  _currentSource: null,

  async init() {
    this._enabled = (await Store.get('voiceEnabled', true)) !== false;
    this._precacheAcks();

    const unlockHandler = () => {
      if (this._unlocked) return;
      this._unlocked = true;
      this._getCtx().resume().catch(() => {});
      if (this._pendingText) {
        const t = this._pendingText;
        this._pendingText = null;
        setTimeout(() => this.speak(t), 300);
      }
      document.removeEventListener('click', unlockHandler, true);
      document.removeEventListener('touchstart', unlockHandler, true);
    };
    document.addEventListener('click', unlockHandler, true);
    document.addEventListener('touchstart', unlockHandler, true);

    if (!this._supported) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._recognition = new SR();
    this._recognition.lang = 'en-IN';
    this._recognition.continuous = false;
    this._recognition.interimResults = true;
    this._recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      const input = $('#chat-input');
      if (input) input.value = transcript;
      const el = $('#voice-transcript');
      if (el) el.textContent = transcript;
      if (e.results[0].isFinal) {
        this._setOverlayState('processing');
        const st = $('#voice-status');
        if (st) st.textContent = 'PROCESSING';
        this.stopListening(true);
        setTimeout(() => { $('#chat-send')?.click(); }, 300);
      }
    };
    this._recognition.onend = () => { if (!this._voiceMode) this.stopListening(); };
    this._recognition.onerror = (e) => {
      const status = $('#voice-status');
      if (status) status.textContent = e.error === 'not-allowed' ? 'MICROPHONE BLOCKED' : 'COULD NOT HEAR';
      this.playTone('error');
      setTimeout(() => this.stopListening(), 2000);
    };
  },

  _getCtx() {
    if (!this._audioCtx) this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return this._audioCtx;
  },

  async _precacheAcks() {
    const phrases = ['Right away, Boss.', 'On it, Boss.', 'Let me check that.', 'Analyzing now.', 'One moment.', 'Looking into it.'];
    for (const p of phrases) {
      try {
        const resp = await fetch('/api/tts?text=' + encodeURIComponent(p));
        if (resp.ok) this._ackBuffers.push(await resp.arrayBuffer());
      } catch {}
    }
  },

  async _playBuffer(arrayBuffer) {
    const ctx = this._getCtx();
    await ctx.resume();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return new Promise((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.playbackRate.value = 1.1;
      source.connect(ctx.destination);
      this._currentSource = source;
      source.onended = () => { this._currentSource = null; resolve(); };
      source.start(0);
    });
  },

  playTone(type) {
    try {
      const ctx = this._getCtx();
      ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (type === 'activate') {
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.12);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(); osc.stop(ctx.currentTime + 0.2);
      } else if (type === 'deactivate') {
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(500, ctx.currentTime + 0.15);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(); osc.stop(ctx.currentTime + 0.2);
      } else if (type === 'response') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(660, ctx.currentTime + 0.08);
        osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.15);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start(); osc.stop(ctx.currentTime + 0.25);
      } else if (type === 'error') {
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(200, ctx.currentTime + 0.3);
        osc.type = 'triangle';
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start(); osc.stop(ctx.currentTime + 0.35);
      }
    } catch {}
  },

  primeWithAck() {
    if (!this._enabled) return;
    this._speaking = true;
    this._responseQueued = false;
    this._showSpeakingState(true);
    const ctx = this._getCtx();
    ctx.resume();
    this.playTone('response');
    if (this._ackBuffers.length) {
      const buf = this._ackBuffers[Math.floor(Math.random() * this._ackBuffers.length)];
      this._playBuffer(buf).then(() => {
        if (!this._responseQueued) { this._speaking = false; this._showSpeakingState(false); }
      }).catch(() => {});
    }
  },

  async queueResponse(text) {
    if (!this._enabled) return;
    const clean = this._cleanForSpeech(text);
    if (!clean) return;
    this._responseQueued = true;
    this._speaking = true;
    this._showSpeakingState(true);
    if (this._voiceMode) { this._setOverlayState('speaking'); const st = $('#voice-status'); if (st) st.textContent = 'SPEAKING'; }
    await this._speakViaServer(clean);
    this._finishSpeaking();
  },

  async speak(text) {
    if (!this._enabled) return;
    if (!this._unlocked) { this._pendingText = text; return; }
    const clean = this._cleanForSpeech(text);
    if (!clean) return;
    this.stop();
    this._speaking = true;
    this._showSpeakingState(true);
    if (this._voiceMode) { this._setOverlayState('speaking'); const st = $('#voice-status'); if (st) st.textContent = 'SPEAKING'; }
    await this._speakViaServer(clean);
    this._finishSpeaking();
  },

  async _speakViaServer(text) {
    const chunks = this._chunkText(text, 190);
    for (const chunk of chunks) {
      if (!this._speaking) break;
      try {
        const resp = await fetch('/api/tts?text=' + encodeURIComponent(chunk));
        if (!resp.ok) throw new Error('TTS fail');
        const buf = await resp.arrayBuffer();
        await this._playBuffer(buf);
      } catch {
        await this._speakFallback(chunk);
      }
    }
  },

  _speakFallback(text) {
    return new Promise(resolve => {
      const synth = window.speechSynthesis;
      if (!synth) { resolve(); return; }
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-IN'; utter.rate = 1.0; utter.pitch = 0.9; utter.volume = 1.0;
      utter.onend = resolve; utter.onerror = resolve;
      synth.speak(utter);
    });
  },

  _chunkText(text, maxLen) {
    const sentences = text.match(/[^.!?]+[.!?]?\s*/g) || [text];
    const chunks = [];
    let current = '';
    for (const s of sentences) {
      if ((current + s).length > maxLen) { if (current) chunks.push(current.trim()); current = s; }
      else current += s;
    }
    if (current) chunks.push(current.trim());
    return chunks;
  },

  _finishSpeaking() {
    this._speaking = false;
    this._showSpeakingState(false);
    if (this._voiceMode) {
      this._voiceMode = false;
      setTimeout(() => { $('#voice-overlay')?.classList.remove('active'); this._setOverlayState(''); }, 600);
    }
  },

  _cleanForSpeech(text) {
    return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/[*#_`~]/g, '').replace(/₹\s?([\d,.]+)/g, '$1 rupees')
      .replace(/\d+\.\s/g, '. ').replace(/https?:\/\/\S+/g, '').replace(/\n{2,}/g, '. ').replace(/\n/g, ', ')
      .replace(/\s{2,}/g, ' ').replace(/\.\s*\./g, '.').trim();
  },

  _getAcknowledgment() {
    const phrases = ['Right away, Boss.', 'Let me check that.', 'On it, Boss.', 'Analyzing now.', 'One moment.', 'Looking into it.'];
    return phrases[Math.floor(Math.random() * phrases.length)];
  },

  startListening() {
    if (!this._recognition) return;
    this.stop();
    this._voiceMode = true;
    this.playTone('activate');
    const overlay = $('#voice-overlay');
    overlay?.classList.add('active');
    this._setOverlayState('listening');
    const st = $('#voice-status');
    if (st) st.textContent = 'LISTENING';
    const tr = $('#voice-transcript');
    if (tr) tr.textContent = '';
    $('#chat-mic')?.classList.add('listening');
    try { this._recognition.start(); } catch {}
  },

  stopListening(keepOverlay = false) {
    try { this._recognition?.stop(); } catch {}
    if (!keepOverlay) {
      this._voiceMode = false;
      $('#voice-overlay')?.classList.remove('active');
      this._setOverlayState('');
      this.playTone('deactivate');
    }
    $('#chat-mic')?.classList.remove('listening');
  },

  _setOverlayState(state) {
    const overlay = $('#voice-overlay');
    if (!overlay) return;
    overlay.classList.remove('listening', 'processing', 'speaking');
    if (state) overlay.classList.add(state);
  },

  _showSpeakingState(active) {
    const indicator = $('#jarvis-speaking');
    if (indicator) indicator.classList.toggle('active', active);
    const logo = $('.topbar-logo svg');
    if (logo) logo.classList.toggle('speaking', active);
  },

  greet() {
    if (this._greeted || !this._enabled) return;
    this._greeted = true;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    this.playTone('response');
    setTimeout(() => this.speak(`${greeting} Boss. Jarvis online. Your market assistant is ready.`), 300);
  },

  toggle() {
    this._enabled = !this._enabled;
    Store.set('voiceEnabled', this._enabled);
    if (!this._enabled) this.stop();
    this.playTone(this._enabled ? 'activate' : 'deactivate');
    return this._enabled;
  },

  stop() {
    this._speaking = false;
    this._voiceMode = false;
    try { this._currentSource?.stop(); } catch {}
    this._currentSource = null;
    window.speechSynthesis?.cancel();
    this._showSpeakingState(false);
    $('#voice-overlay')?.classList.remove('active');
    this._setOverlayState('');
  }
};

// ---- CHART ENGINE ----
const Charts = {
  _instances: {},
  create(containerId, symbol, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    container.innerHTML = '';
    if (this._instances[containerId]) { try { this._instances[containerId].remove(); } catch {} }

    const chart = LightweightCharts.createChart(container, {
      width: container.clientWidth, height: container.clientHeight,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8892a4', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: 'rgba(0,212,255,0.3)', width: 1 }, horzLine: { color: 'rgba(0,212,255,0.3)', width: 1 } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    const candles = Market.getCandles(symbol, options.days || 90);
    if (options.type === 'area') {
      const series = chart.addAreaSeries({ topColor: 'rgba(0,212,255,0.3)', bottomColor: 'rgba(0,212,255,0.02)', lineColor: '#00d4ff', lineWidth: 2 });
      series.setData(candles.map(c => ({ time: c.time, value: c.close })));
    } else {
      const cs = chart.addCandlestickSeries({ upColor: '#00e676', downColor: '#ff5252', borderUpColor: '#00e676', borderDownColor: '#ff5252', wickUpColor: '#00e676', wickDownColor: '#ff5252' });
      cs.setData(candles);
      if (options.showSMA) {
        const ta = TA.getAll(symbol);
        const sma20Data = candles.map((c, i) => ta.sma20[i] !== null ? { time: c.time, value: ta.sma20[i] } : null).filter(Boolean);
        const sma50Data = candles.map((c, i) => ta.sma50[i] !== null ? { time: c.time, value: ta.sma50[i] } : null).filter(Boolean);
        if (sma20Data.length) { chart.addLineSeries({ color: '#ffd740', lineWidth: 1 }).setData(sma20Data); }
        if (sma50Data.length) { chart.addLineSeries({ color: '#ff9800', lineWidth: 1, lineStyle: 2 }).setData(sma50Data); }
      }
      if (options.showVolume) {
        const vs = chart.addHistogramSeries({ color: 'rgba(0,212,255,0.15)', priceFormat: { type: 'volume' }, priceScaleId: '' });
        chart.priceScale('').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
        vs.setData(candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(0,230,118,0.2)' : 'rgba(255,82,82,0.2)' })));
      }
    }
    chart.timeScale().fitContent();
    this._instances[containerId] = chart;
    new ResizeObserver(() => { try { chart.applyOptions({ width: container.clientWidth, height: container.clientHeight }); } catch {} }).observe(container);
    return chart;
  }
};

// ---- ALERTS ENGINE ----
const Alerts = {
  _alerts: [],
  async load() { this._alerts = await Store.get('alerts', []); },
  async save() { await Store.set('alerts', this._alerts); },

  async create(symbol, condition, targetPrice) {
    const alert = { id: Date.now(), symbol, condition, targetPrice: +targetPrice, active: true, triggered: false, createdAt: new Date().toISOString(), triggeredAt: null };
    this._alerts.push(alert);
    await this.save();
    Notify.syncAlerts(this._alerts);
    return alert;
  },

  async remove(id) { this._alerts = this._alerts.filter(a => a.id !== id); await this.save(); Notify.syncAlerts(this._alerts); },

  async check() {
    let changed = false;
    for (const a of this._alerts) {
      if (!a.active || a.triggered) continue;
      const price = Market.getPrice(a.symbol);
      const met = (a.condition === 'above' && price >= a.targetPrice) || (a.condition === 'below' && price <= a.targetPrice);
      if (met) {
        a.triggered = true; a.triggeredAt = new Date().toISOString(); a.triggerPrice = price; changed = true;
        Notify.send(`Price Alert: ${a.symbol}`, `${a.symbol} ${a.condition === 'above' ? 'rose above' : 'fell below'} ${fmtCur(a.targetPrice)}`);
        UI.showToast(`Alert: ${a.symbol} hit ${fmtCur(a.targetPrice)}`);
      }
    }
    if (changed) { await this.save(); UI.renderAlerts(); }
  },

  getActive() { return this._alerts.filter(a => a.active && !a.triggered); },
  getTriggered() { return this._alerts.filter(a => a.triggered); },
};

// ---- NEWS ENGINE ----
const News = {
  _items: [],
  _loading: false,

  async fetch(query = 'Indian stock market NSE BSE') {
    this._loading = true;
    try {
      const resp = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
      if (!resp.ok) throw new Error('Failed');
      const data = await resp.json();
      this._items = (data.items || []).map(item => ({ ...item, sentiment: this.sentiment(item.title), timeAgo: this.timeAgo(item.pubDate) }));
    } catch { this._items = []; }
    this._loading = false;
    return this._items;
  },

  sentiment(title) {
    const t = (title || '').toLowerCase();
    const bull = ['surge','rally','gain','rise','high','bull','growth','profit','boom','soar','jump','strong','record'].filter(w => t.includes(w)).length;
    const bear = ['fall','drop','crash','low','bear','loss','decline','slip','weak','plunge','tumble','fear','crisis'].filter(w => t.includes(w)).length;
    if (bull > bear) return { label: 'Positive', color: 'var(--green)' };
    if (bear > bull) return { label: 'Negative', color: 'var(--red)' };
    return { label: 'Neutral', color: 'var(--yellow)' };
  },

  timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }
};

// ---- SIGNALS ENGINE ----
const Signals = {
  reasons: {
    TCS: { BUY: 'TCS reported strong quarterly results with 8% revenue growth. Big companies globally are spending more on technology. The stock dipped recently due to market nervousness — that\'s a buying opportunity.', SELL: 'TCS has risen sharply and looks overpriced. IT spending may slow if the global economy weakens. Consider booking profits.', HOLD: 'TCS is fairly valued right now. The company is strong but the price reflects that. Wait for a dip.' },
    RELIANCE: { BUY: 'Reliance\'s Jio and retail businesses are growing fast. Oil refining margins are strong. You\'re getting India\'s biggest company at reasonable valuation.', SELL: 'Reliance has run up too fast. Retail faces Amazon/Flipkart competition. Oil price drops could hurt.', HOLD: 'Reliance is doing well across all businesses but fairly priced. Wait for a clearer signal.' },
    HDFCBANK: { BUY: 'HDFC Bank is India\'s safest private bank. After the HDFC merger, the combined entity is massive. Stock has consolidated — usually means about to move up.', SELL: 'Banking sector facing headwinds from potential rate cuts. Valuation premium is narrowing.', HOLD: 'Strong fundamentals but limited upside at current levels. Wait for a better entry.' },
    INFY: { BUY: 'Infosys won several large deals recently. AI and cloud services growing rapidly. Trading below its peers — relatively cheaper.', SELL: 'Infosys guiding for slower growth. Visa issues and AI automation pose long-term risks.', HOLD: 'Stable but not exciting. Large deal wins are good but growth guidance is modest.' },
    ZOMATO: { BUY: 'Zomato turned profitable! More Indians ordering food online monthly. Blinkit quick-delivery growing rapidly. Affordable at current price.', SELL: 'Valuation stretched. Swiggy competition intensifying. Quick commerce margins uncertain.', HOLD: 'Growing but competition is fierce. Wait to see if profitability sustains.' },
    TATAMOTORS: { BUY: 'Tata Motors\' JLR doing well globally. Strong EV push in India. Stock has room to grow as auto sales pick up.', SELL: 'Auto sector facing headwinds. Raw material costs rising. JLR growth may slow in Europe.', HOLD: 'In transition phase. EV strategy promising but execution takes time.' },
    SBIN: { BUY: 'India\'s largest bank with government backing. Asset quality improved significantly. Attractive dividend yield.', SELL: 'Government banks face political lending pressure. NPAs could rise if economy slows.', HOLD: 'Solid but not fast-growing. Good for steady returns, not quick profits.' },
    ITC: { BUY: 'Diversified beyond cigarettes into FMCG, hotels, paper. Strong cash flows and high dividend yield. Reasonably priced.', SELL: 'ESG concerns around tobacco may limit foreign investment. FMCG growth still small relative to cigarettes.', HOLD: 'Classic defensive stock — good in bad markets. Hold for stability and dividends.' },
    WIPRO: { BUY: 'Cheapest among top IT companies. New leadership improving deal wins. Turnaround could mean big returns from low levels.', SELL: 'Underperformed peers for quarters. Organic growth weak. Better IT options available.', HOLD: 'Turnaround still uncertain. Wait for consistent improvement.' },
    ONGC: { BUY: 'Rising oil prices benefit ONGC directly. Government reforms could unlock value. Attractive dividend yield.', SELL: 'Government forces subsidized fuel pricing, eating profits. Stock rallied too fast.', HOLD: 'Tied to oil prices and government policy — both unpredictable. Watch from sidelines.' },
    BHARTIARTL: { BUY: 'Airtel gaining telecom market share steadily. 5G rollout increases revenue per user. Africa operations diversify.', SELL: 'High debt levels concerning. Jio continues aggressive pricing. Capital-intensive business.', HOLD: 'Well-managed but thin margins. Current price reflects the positives.' },
    ICICIBANK: { BUY: 'ICICI Bank has strong retail and digital banking growth. Asset quality at its best in years. Private banking leader at reasonable valuation.', SELL: 'Banking sector faces rate cut headwinds. Premium valuation may not sustain if growth slows.', HOLD: 'Solid bank but priced for perfection. Wait for a pullback.' },
    HINDUNILVR: { BUY: 'India\'s FMCG giant with unmatched distribution reach. Rural recovery and premium products driving growth.', SELL: 'Expensive relative to growth. Input cost inflation squeezing margins.', HOLD: 'Safe defensive stock but expensive. Good for stability, limited upside.' },
    KOTAKBANK: { BUY: 'Best-in-class asset quality and strong deposit franchise. Digital lending growing fast.', SELL: 'Valuation premium hard to justify. Regulatory scrutiny on new cards adds uncertainty.', HOLD: 'Great bank but pricey. Patient investors may wait for better entry.' },
    AXISBANK: { BUY: 'Turnaround continues — improving loan growth and profitability. Undervalued vs HDFC and ICICI.', SELL: 'Integration challenges from acquisitions could drag. Fintech competition eating into retail lending.', HOLD: 'Decent value play in banking. Hold medium-term.' },
    MARUTI: { BUY: 'India\'s largest car maker with strong market share. New SUV launches driving premiumization.', SELL: 'Auto stocks are cyclical. EV transition poses long-term risk to ICE-focused Maruti.', HOLD: 'Market leader but faces disruption. Good for patient long-term investors.' },
    SUNPHARMA: { BUY: 'Specialty portfolio in US growing. Strong domestic market share. R&D pipeline promising.', SELL: 'Pharma facing FDA scrutiny and US pricing pressure. Generic competition intensifying.', HOLD: 'Good quality pharma. Hold if you own, wait for clarity before buying more.' },
    HCLTECH: { BUY: 'Strong deal wins in cloud and digital. Attractive valuation relative to TCS and Infosys.', SELL: 'IT growth moderating. Wage inflation and visa costs are headwinds.', HOLD: 'Solid IT company. Fair value — no rush to buy or sell.' },
    TECHM: { BUY: 'Turnaround story gaining traction. 5G and network services create unique niche.', SELL: 'Recovery still uneven. Telecom vertical faces structural challenges.', HOLD: 'Watch the turnaround progress. Wait for consistent results.' },
    BAJFINANCE: { BUY: 'Dominates consumer lending. Massive customer base and best-in-class underwriting.', SELL: 'NBFC valuations stretched. Rising competition from banks and fintechs.', HOLD: 'Premium company at premium price. Great for long-term, don\'t chase at highs.' },
    LT: { BUY: 'Benefits directly from India\'s infrastructure boom. Strong order book gives multi-year visibility.', SELL: 'Execution risks on large projects. Working capital intensive.', HOLD: 'Solid infrastructure play. Hold through India\'s capex cycle.' },
    ADANIENT: { BUY: 'Expanding aggressively across ports, energy, infrastructure. Massive growth potential.', SELL: 'High debt and governance concerns remain. Concentration risk with one promoter group.', HOLD: 'High risk, high reward. Only for aggressive investors who can handle volatility.' },
    TITAN: { BUY: 'Dominates organized jewelry and watches in India. Trent fashion adds growth. Strong brand.', SELL: 'Sky-high valuation — any earnings miss will punish hard. Gold price volatility affects margins.', HOLD: 'Excellent company but very expensive. Not the right entry point.' },
    ASIANPAINT: { BUY: 'Market leader in decorative paints with pricing power. Distribution network is a massive moat.', SELL: 'Intense competition from Grasim entry. Input costs volatile. Premium valuation at risk.', HOLD: 'Quality company in tough competitive phase. Hold, don\'t add.' },
    TATASTEEL: { BUY: 'Steel prices recovering. India\'s infrastructure spending boosts demand. Low valuations.', SELL: 'Highly cyclical — prices can crash quickly. European ops drag profitability.', HOLD: 'Buy in downturns, not at current levels. Timing matters for metals.' },
    JSWSTEEL: { BUY: 'India\'s most efficient steel producer. Capacity expansion positions well for infra demand.', SELL: 'Global steel oversupply and China dumping concerns.', HOLD: 'Good steel company but watch global prices. Metals need active management.' },
    NTPC: { BUY: 'India\'s power backbone. Green energy pivot adds growth. High dividend yield for steady income.', SELL: 'Power sector faces regulatory risks. Coal dependency creates ESG concerns.', HOLD: 'Safe dividend stock. Not exciting but reliable.' },
    POWERGRID: { BUY: 'Benefits from growing electricity transmission needs. Predictable revenues and strong dividends.', SELL: 'Regulated returns cap upside. Growth requires massive capex.', HOLD: 'Classic defensive stock. Hold for dividends, don\'t expect price growth.' },
    COALINDIA: { BUY: 'Dominates India\'s coal production. Attractive dividend yield. Energy demand growing.', SELL: 'ESG concerns limit institutional interest. Long-term shift to renewables threatens the model.', HOLD: 'Good dividend payer but sunset industry. For income, not growth.' },
    ULTRACEMCO: { BUY: 'India\'s largest cement maker. Housing and infra boom drives demand. Strong pricing power.', SELL: 'Capital intensive. Regional competition pressures prices. Expensive stock.', HOLD: 'Premium cement stock. Good business but valuation reflects the growth story.' },
  },

  generate() {
    return Market.getTradeableSymbols().map(symbol => {
      const info = Market.stocks[symbol];
      const price = Market.getPrice(symbol);
      const change = Market.getChange(symbol);
      const signal = TA.overallSignal(symbol);
      const reasons = this.reasons[symbol] || {};
      const reason = reasons[signal.action] || `${info.name} showing ${signal.label.toLowerCase()} signals in ${info.sector} sector. Based on technical analysis.`;
      const targetPct = signal.action === 'SELL' ? -0.06 : 0.08;
      const slPct = signal.action === 'SELL' ? 0.04 : -0.05;
      return { symbol, name: info.name, action: signal.action, price: +price.toFixed(2),
        target: +(price * (1 + targetPct)).toFixed(2), stopLoss: +(price * (1 + slPct)).toFixed(2),
        confidence: signal.confidence, color: info.color, reason, sector: info.sector, change,
        risk: signal.confidence > 75 ? 'Low' : signal.confidence > 55 ? 'Medium' : 'High' };
    }).sort((a, b) => b.confidence - a.confidence);
  }
};

// ---- SCREENER ENGINE ----
const Screener = {
  filter(opts = {}) {
    let results = Market.getTradeableSymbols().map(sym => {
      const info = Market.stocks[sym];
      return { symbol: sym, name: info.name, sector: info.sector, price: Market.getPrice(sym),
        change: Market.getChange(sym), rsi: TA.rsi(Market.getCandles(sym)), macd: TA.macd(Market.getCandles(sym)),
        signal: TA.overallSignal(sym), color: info.color };
    });
    if (opts.sector && opts.sector !== 'all') results = results.filter(r => r.sector === opts.sector);
    if (opts.signal && opts.signal !== 'all') results = results.filter(r => r.signal.action === opts.signal);
    if (opts.rsi === 'oversold') results = results.filter(r => r.rsi.value < 30);
    else if (opts.rsi === 'overbought') results = results.filter(r => r.rsi.value > 70);
    else if (opts.rsi === 'neutral') results = results.filter(r => r.rsi.value >= 30 && r.rsi.value <= 70);
    switch (opts.sort) {
      case 'change': results.sort((a, b) => (b.change?.pct || 0) - (a.change?.pct || 0)); break;
      case 'price': results.sort((a, b) => a.price - b.price); break;
      case 'name': results.sort((a, b) => a.symbol.localeCompare(b.symbol)); break;
      default: results.sort((a, b) => b.signal.confidence - a.signal.confidence);
    }
    return results;
  },
  getSectors() {
    const s = new Set();
    for (const [, info] of Object.entries(Market.stocks)) { if (info.sector !== 'Index') s.add(info.sector); }
    return [...s].sort();
  }
};

// ---- BACKTEST ENGINE ----
const Backtest = {
  run(symbol, strategy, days = 180) {
    const candles = Market.generateCandles(symbol, days);
    if (candles.length < 50) return null;
    const trades = [];
    let position = null, capital = 100000, maxCap = 100000, maxDD = 0;

    for (let i = 50; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const sig = this.getSignal(strategy, slice);
      if (sig === 'BUY' && !position) {
        position = { entry: candles[i].close, date: candles[i].time, idx: i };
      } else if (sig === 'SELL' && position) {
        const pnl = candles[i].close - position.entry;
        const pnlPct = (pnl / position.entry) * 100;
        capital += (capital * pnlPct / 100);
        trades.push({ entry: position.entry, exit: candles[i].close, entryDate: position.date, exitDate: candles[i].time,
          pnl: +pnl.toFixed(2), pnlPct: +pnlPct.toFixed(2), duration: i - position.idx });
        position = null;
        maxCap = Math.max(maxCap, capital);
        maxDD = Math.max(maxDD, (maxCap - capital) / maxCap * 100);
      }
    }
    if (position) {
      const last = candles[candles.length - 1];
      trades.push({ entry: position.entry, exit: last.close, entryDate: position.date, exitDate: last.time,
        pnl: +(last.close - position.entry).toFixed(2), pnlPct: +((last.close - position.entry) / position.entry * 100).toFixed(2),
        duration: candles.length - 1 - position.idx, open: true });
    }
    const wins = trades.filter(t => t.pnl > 0).length;
    return { trades, totalTrades: trades.length, wins, losses: trades.length - wins,
      winRate: trades.length ? +((wins / trades.length) * 100).toFixed(1) : 0,
      totalReturn: +((capital - 100000) / 1000).toFixed(2),
      maxDrawdown: +maxDD.toFixed(2),
      avgDuration: trades.length ? +(trades.reduce((s, t) => s + t.duration, 0) / trades.length).toFixed(1) : 0 };
  },

  getSignal(strategy, data) {
    switch (strategy) {
      case 'rsi': {
        if (data.length < 16) return null;
        const curr = TA.rsi(data), prev = TA.rsi(data.slice(0, -1));
        if (prev.value >= 30 && curr.value < 30) return 'BUY';
        if (prev.value <= 70 && curr.value > 70) return 'SELL';
        return null;
      }
      case 'macd': {
        const curr = TA.macd(data), prev = TA.macd(data.slice(0, -1));
        if (prev.value <= 0 && curr.value > 0) return 'BUY';
        if (prev.value >= 0 && curr.value < 0) return 'SELL';
        return null;
      }
      case 'sma': {
        const s20 = TA.sma(data, 20), s50 = TA.sma(data, 50);
        const c20 = s20[s20.length - 1], c50 = s50[s50.length - 1];
        const p20 = s20[s20.length - 2], p50 = s50[s50.length - 2];
        if (p20 && p50 && c20 && c50) {
          if (p20 <= p50 && c20 > c50) return 'BUY';
          if (p20 >= p50 && c20 < c50) return 'SELL';
        }
        return null;
      }
      case 'bb': {
        const bb = TA.bollingerBands(data);
        const price = data[data.length - 1].close;
        if (price <= bb.lower) return 'BUY';
        if (price >= bb.upper) return 'SELL';
        return null;
      }
      default: return null;
    }
  }
};

// ---- PORTFOLIO ENGINE ----
const Portfolio = {
  data: { balance: 10000, holdings: [], history: [] },
  async load() { const s = await Store.get('portfolio'); if (s) this.data = s; },
  async save() { await Store.set('portfolio', this.data); },

  async executeTrade(signal, type = 'BUY') {
    const maxPosition = this.data.balance * 0.15;
    const qty = Math.max(1, Math.floor(maxPosition / signal.price));
    const cost = qty * signal.price;
    if (type === 'BUY') {
      if (cost > this.data.balance) return { ok: false, msg: `Not enough balance. Need ${fmtCur(cost)} but have ${fmtCur(this.data.balance)}` };
      this.data.balance -= cost;
      const ex = this.data.holdings.find(h => h.symbol === signal.symbol);
      if (ex) { const tq = ex.qty + qty; ex.buyPrice = +((ex.buyPrice * ex.qty + signal.price * qty) / tq).toFixed(2); ex.qty = tq; }
      else { this.data.holdings.push({ symbol: signal.symbol, name: signal.name, qty, buyPrice: signal.price, currentPrice: signal.price, target: signal.target, stopLoss: signal.stopLoss, date: new Date().toISOString() }); }
      this.data.history.unshift({ type: 'BUY', symbol: signal.symbol, qty, price: signal.price, date: new Date().toISOString() });
    } else {
      const h = this.data.holdings.find(h => h.symbol === signal.symbol);
      if (!h) return { ok: false, msg: `You don't own ${signal.symbol}` };
      const sq = Math.min(h.qty, qty); this.data.balance += sq * signal.price; h.qty -= sq;
      if (h.qty <= 0) this.data.holdings = this.data.holdings.filter(h => h.symbol !== signal.symbol);
      this.data.history.unshift({ type: 'SELL', symbol: signal.symbol, qty: sq, price: signal.price, date: new Date().toISOString() });
    }
    await this.save(); await Store.addTrade(this.data.history[0]);
    return { ok: true, qty, msg: `${type === 'BUY' ? 'Bought' : 'Sold'} ${qty} shares of ${signal.symbol} at ${fmtCur(signal.price)}` };
  },

  getTotalValue() { return this.data.balance + this.data.holdings.reduce((s, h) => s + h.qty * Market.getPrice(h.symbol), 0); },
  getPnL() { const t = this.getTotalValue(); return { abs: +(t - 10000).toFixed(2), pct: +(((t - 10000) / 10000) * 100).toFixed(2) }; }
};

// ---- NOTIFICATION ENGINE ----
const Notify = {
  _pushSub: null,

  async requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  },

  async subscribePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      if (Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker.ready;
      const resp = await fetch('/api/push/vapid-key');
      const { publicKey } = await resp.json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(publicKey)
      });
      this._pushSub = sub;
      await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub })
      });
      console.log('Push notifications subscribed');
    } catch (e) { console.log('Push subscribe error:', e.message); }
  },

  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  },

  async syncAlerts(alerts) {
    try {
      await fetch('/api/alerts/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alerts })
      });
    } catch {}
  },

  send(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: '/favicon.ico', badge: '/favicon.ico', tag: 'jarvis-' + Date.now(), requireInteraction: true });
      n.onclick = () => { window.focus(); n.close(); };
    }
    try { navigator.vibrate?.([200, 100, 200]); } catch {}
    this.playAlert();
    Voice.speak(body);
  },

  playAlert() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(); osc.stop(ctx.currentTime + 0.5);
    } catch {}
  }
};

// ---- UI CONTROLLER ----
const UI = {
  currentSymbol: 'NIFTY',
  watchlist: ['TCS', 'RELIANCE', 'HDFCBANK', 'ZOMATO', 'INFY'],
  signals: [],

  async init() {
    await Store.open().catch(() => {});
    await Portfolio.load();
    await Alerts.load();
    await AI.load();

    const savedWL = await Store.get('watchlist');
    if (savedWL) this.watchlist = savedWL;

    this.setupNav();
    this.setupChat();
    this.setupFilters();
    this.setupWatchlistModal();
    this.setupAlertModal();
    this.updateMarketStatus();

    this.signals = Signals.generate();

    this.renderDashboard();
    this.renderChartPage();
    this.renderSignals();
    this.renderPortfolio();
    this.renderLearn();
    this.renderSettings();

    await Notify.requestPermission();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      Notify.subscribePush().then(() => Notify.syncAlerts(Alerts._alerts));
    }

    this.refreshLiveData();
    setInterval(() => this.updateMarketStatus(), 60000);
    setInterval(() => this.refreshLiveData(), 60000);
    setInterval(() => Alerts.check(), 30000);
    setInterval(() => this.simulatePriceUpdates(), 30000);

    const tag = $('#ai-engine-tag');
    if (tag) tag.textContent = AI.getEngineName();

    setTimeout(() => { const o = $('#loading-overlay'); if (o) o.classList.remove('show'); }, 300);

    if (new URLSearchParams(window.location.search).get('zerodha') === 'connected') {
      this.showToast('Zerodha connected successfully!');
    }
  },

  async refreshLiveData() {
    await LiveData.fetchQuotes(Object.keys(Market.stocks));
    const badge = $('#live-data-badge');
    if (badge) badge.style.display = LiveData.isAvailable() ? 'flex' : 'none';
  },

  simulatePriceUpdates() {
    Portfolio.data.holdings.forEach(h => { h.currentPrice = Market.getPrice(h.symbol); });
    Portfolio.save();
  },

  updateMarketStatus() {
    const status = Market.getMarketStatusText();
    const statusEl = $('#market-status'), dotEl = statusEl?.previousElementSibling;
    if (statusEl) statusEl.textContent = status.text;
    if (dotEl) dotEl.className = 'dot dot-pulse ' + status.dot;
    const liveTag = $('#live-tag');
    if (liveTag) liveTag.style.display = Market.isMarketOpen() ? 'inline' : 'none';
  },

  // ---- NAVIGATION ----
  navigateTo(page) {
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    $$('.page').forEach(p => p.classList.remove('active'));
    const btn = $(`[data-page="${page}"]`);
    if (btn) btn.classList.add('active');
    const el = $(`#page-${page}`);
    if (el) el.classList.add('active');
    if (page === 'charts') { const sel = $('#chart-symbol'); if (sel) sel.value = this.currentSymbol; this.renderChartPage(); }
    else if (page === 'screener') this.renderScreener();
    else if (page === 'news') this.renderNews();
    else if (page === 'alerts') this.renderAlerts();
    else if (page === 'backtest') this.renderBacktest();
  },

  setupNav() {
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.navigateTo(btn.dataset.page));
    });
  },

  // ---- DASHBOARD ----
  renderDashboard() {
    this.renderMarketGrid();
    this.renderDashChart();
    this.renderBriefing();
    this.renderWatchlist();
    this.renderTopSignals();
    const dashTf = $('#dash-tf');
    if (dashTf) $$('.tf-btn', dashTf).forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tf-btn', dashTf).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Charts.create('dash-chart', 'NIFTY', { type: 'area', days: { '1D': 5, '1W': 10, '1M': 30 }[btn.dataset.tf] || 30 });
      });
    });
  },

  renderMarketGrid() {
    const indices = ['NIFTY', 'SENSEX', 'BANKNIFTY', 'NIFTYIT'];
    const grid = $('#market-grid');
    if (!grid) return;
    grid.innerHTML = indices.map(sym => {
      const info = Market.stocks[sym], price = Market.getPrice(sym), ch = Market.getChange(sym), up = ch.pct >= 0;
      return `<div class="market-card" data-symbol="${sym}"><div class="label">${info.name}</div><div class="value">${fmt(price)}</div>
        <div class="change ${up ? 'up' : 'down'}"><svg viewBox="0 0 12 12"><path d="${up ? 'M6 2l4 6H2z' : 'M6 10l4-6H2z'}" fill="currentColor"/></svg>${up ? '+' : ''}${ch.pct}%</div></div>`;
    }).join('');
    $$('.market-card', grid).forEach(card => {
      card.addEventListener('click', () => { this.currentSymbol = card.dataset.symbol; this.navigateTo('charts'); });
    });
  },

  renderDashChart() { Charts.create('dash-chart', 'NIFTY', { type: 'area', days: 5 }); },

  renderBriefing() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
    const el = $('#briefing'), timeEl = $('#briefing-time');
    if (timeEl) timeEl.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const buySignals = this.signals.filter(s => s.action === 'BUY'), topPick = buySignals[0];
    if (el) el.innerHTML = `<div class="briefing-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><h2>${greeting}, Boss</h2></div>
      <p>Market sentiment is <span class="hl">${Market.getChange('NIFTY').pct >= 0 ? 'cautiously positive' : 'under pressure'}</span> today. NIFTY at <span class="hl">${fmt(Market.getPrice('NIFTY'))}</span> (${Market.getChange('NIFTY').pct >= 0 ? '+' : ''}${Market.getChange('NIFTY').pct}%).
      ${topPick ? `Top pick: <span class="hl">${topPick.symbol}</span> (${topPick.confidence}% confidence).` : ''}
      I've found <span class="hl">${buySignals.length} buy</span> and <span class="hl">${this.signals.filter(s => s.action === 'SELL').length} sell</span> signals across ${Market.getTradeableSymbols().length} stocks.
      ${Portfolio.data.holdings.length > 0 ? `Portfolio: ${fmtCur(Portfolio.getTotalValue())} (${Portfolio.getPnL().pct >= 0 ? '+' : ''}${Portfolio.getPnL().pct}%).` : 'Paper trading mode — no real money. Perfect for learning!'}
      ${LiveData.isAvailable() ? '<span class="hl">Live data active.</span>' : 'Using simulated data — add server for live prices.'}
      ${Alerts.getActive().length ? `${Alerts.getActive().length} price alert(s) watching.` : ''}</p>`;
  },

  renderWatchlist() {
    const wl = $('#watchlist');
    if (!wl) return;
    wl.innerHTML = this.watchlist.map(sym => {
      const info = Market.stocks[sym]; if (!info) return '';
      const price = Market.getPrice(sym), ch = Market.getChange(sym), up = ch.pct >= 0;
      return `<div class="watchlist-item" data-symbol="${sym}"><div class="wl-left"><div class="wl-icon" style="background:${info.color}22;color:${info.color}">${sym.slice(0, 2)}</div>
        <div><div class="wl-name">${sym}</div><div class="wl-fullname">${info.name}</div></div></div>
        <div style="display:flex;align-items:center;gap:8px"><div class="wl-right"><div class="wl-price">${fmtCur(price)}</div><div class="wl-change ${up ? 'up' : 'down'}">${up ? '+' : ''}${ch.pct}%</div></div>
        <button class="wl-remove" data-symbol="${sym}" title="Remove">&times;</button></div></div>`;
    }).join('');
    $$('.watchlist-item', wl).forEach(item => {
      item.addEventListener('click', e => { if (e.target.closest('.wl-remove')) return; this.currentSymbol = item.dataset.symbol; this.navigateTo('charts'); });
    });
    $$('.wl-remove', wl).forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.watchlist = this.watchlist.filter(s => s !== btn.dataset.symbol); Store.set('watchlist', this.watchlist); this.renderWatchlist(); });
    });
  },

  renderTopSignals() {
    const el = $('#top-signals'), countEl = $('#signal-count');
    if (!el) return;
    if (countEl) countEl.textContent = this.signals.filter(s => s.action !== 'HOLD').length;
    el.innerHTML = this.signals.slice(0, 3).map(s => this.signalCard(s)).join('');
    this.attachSignalActions(el);
  },

  // ---- CHARTS PAGE ----
  renderChartPage() {
    const sel = $('#chart-symbol');
    if (sel) this.currentSymbol = sel.value || this.currentSymbol;
    Charts.create('main-chart', this.currentSymbol, { showSMA: true, showVolume: true, days: 90 });
    this.renderIndicators();
    this.renderChartAnalysis();
    if (sel && !sel._bound) { sel._bound = true; sel.addEventListener('change', () => { this.currentSymbol = sel.value; this.renderChartPage(); }); }
    const chartTf = $('#chart-tf');
    if (chartTf && !chartTf._bound) {
      chartTf._bound = true;
      chartTf.addEventListener('click', e => {
        const btn = e.target.closest('.tf-btn'); if (!btn) return;
        $$('.tf-btn', chartTf).forEach(b => b.classList.remove('active')); btn.classList.add('active');
        Market._cache = {};
        Charts.create('main-chart', this.currentSymbol, { showSMA: true, showVolume: true, days: { '1D': 5, '1W': 10, '1M': 30, '3M': 90, '1Y': 365 }[btn.dataset.tf] || 90 });
      });
    }
  },

  renderIndicators() {
    const grid = $('#indicators-grid'); if (!grid) return;
    const ind = TA.getAll(this.currentSymbol), price = Market.getPrice(this.currentSymbol);
    const sma20Last = ind.sma20.filter(v => v !== null).pop() || 0;
    const items = [
      { name: 'RSI (14)', value: ind.rsi.value, signal: ind.rsi.signal, class: ind.rsi.class, bar: ind.rsi.value, barColor: ind.rsi.class === 'signal-buy' ? '#00e676' : ind.rsi.class === 'signal-sell' ? '#ff5252' : '#ffd740' },
      { name: 'MACD', value: ind.macd.value, signal: ind.macd.signal, class: ind.macd.class },
      { name: 'Bollinger Bands', value: `${fmt(ind.bb.lower)} — ${fmt(ind.bb.upper)}`, signal: ind.bb.signal, class: ind.bb.class },
      { name: 'VWAP', value: fmt(ind.vwap.value), signal: ind.vwap.signal, class: ind.vwap.class },
      { name: 'ADX (14)', value: ind.adx.value, signal: ind.adx.signal, class: ind.adx.class, bar: ind.adx.value, barColor: '#00d4ff' },
      { name: 'SMA 20', value: fmt(sma20Last), signal: price > sma20Last ? 'Above (Bullish)' : 'Below (Bearish)', class: price > sma20Last ? 'signal-buy' : 'signal-sell' },
    ];
    grid.innerHTML = items.map(i => `<div class="indicator-card"><div class="ind-name">${i.name}</div><div class="ind-value">${i.value}</div><div class="ind-signal ${i.class}">${i.signal}</div>
      ${i.bar !== undefined ? `<div class="ind-bar"><div class="ind-bar-fill" style="width:${Math.min(100, i.bar)}%;background:${i.barColor}"></div></div>` : ''}</div>`).join('');
  },

  renderChartAnalysis() {
    const el = $('#chart-ai-analysis'); if (!el) return;
    const sym = this.currentSymbol, info = Market.stocks[sym], signal = TA.overallSignal(sym);
    const ind = TA.getAll(sym), price = Market.getPrice(sym), change = Market.getChange(sym);
    const reasons = Signals.reasons[sym];
    const reason = reasons ? (reasons[signal.action] || 'Analysis in progress...') :
      `${info.name} showing ${signal.label.toLowerCase()} signals. RSI ${ind.rsi.value} (${ind.rsi.signal}), MACD ${ind.macd.signal.toLowerCase()}. Price ${fmtCur(price)} (${change.pct >= 0 ? '+' : ''}${change.pct}%).`;
    el.innerHTML = `<div class="analysis-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4" fill="#00d4ff" opacity="0.3"/><circle cx="12" cy="12" r="1.5" fill="#00d4ff"/></svg>
      Jarvis Analysis — ${sym} (${signal.action} · ${signal.confidence}%)</div><div class="analysis-body">${reason}</div>`;
  },

  // ---- SIGNALS PAGE ----
  renderSignals(filter = 'all') {
    const el = $('#all-signals'); if (!el) return;
    const filtered = filter === 'all' ? this.signals : this.signals.filter(s => s.action.toLowerCase() === filter);
    el.innerHTML = filtered.length ? filtered.map(s => this.signalCard(s)).join('') : '<div class="empty-state"><p>No signals match this filter</p></div>';
    this.attachSignalActions(el);
  },

  setupFilters() {
    $$('#signal-filters .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => { $$('#signal-filters .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); this.renderSignals(btn.dataset.filter); });
    });
    $$('#news-filters .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => { $$('#news-filters .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); this.renderNews(btn.dataset.q); });
    });
  },

  signalCard(s) {
    const bc = s.action === 'BUY' ? 'badge-buy' : s.action === 'SELL' ? 'badge-sell' : 'badge-hold';
    const cc = s.confidence >= 75 ? 'var(--green)' : s.confidence >= 55 ? 'var(--yellow)' : 'var(--red)';
    return `<div class="suggestion" id="signal-${s.symbol}"><div class="suggestion-header"><div class="suggestion-stock"><div class="stock-icon" style="background:${s.color}22;color:${s.color}">${s.symbol.slice(0, 2)}</div>
      <div><div class="stock-name">${s.symbol} <span style="font-size:12px;color:var(--t3);font-weight:400">${fmtCur(s.price)}</span></div><div class="stock-fullname">${s.name} · ${s.sector}</div></div></div>
      <span class="suggestion-badge ${bc}">${s.action}</span></div>
      <div class="suggestion-reason"><div class="reason-label">Jarvis Analysis (Plain English)</div><p>${s.reason}</p></div>
      <div class="suggestion-meta"><div class="meta-item"><div class="meta-label">Price</div><div class="meta-value">${fmtCur(s.price)}</div></div>
      <div class="meta-item"><div class="meta-label">${s.action === 'SELL' ? 'Expected Drop' : 'Target'}</div><div class="meta-value" style="color:${s.action === 'SELL' ? 'var(--red)' : 'var(--green)'}">${fmtCur(s.target)}</div></div>
      <div class="meta-item"><div class="meta-label">Stop Loss</div><div class="meta-value">${fmtCur(s.stopLoss)}</div></div>
      <div class="meta-item"><div class="meta-label">Risk</div><div class="meta-value">${s.risk}</div></div></div>
      <div class="confidence-row"><span class="confidence-label">AI Confidence</span><div class="confidence-bar"><div class="confidence-fill" style="width:${s.confidence}%;background:${cc}"></div></div><span class="confidence-pct" style="color:${cc}">${s.confidence}%</span></div>
      <div class="suggestion-actions">${s.action !== 'HOLD' ? `<button class="btn btn-approve" data-symbol="${s.symbol}" data-action="approve">Approve ${s.action}</button><button class="btn btn-reject" data-symbol="${s.symbol}" data-action="reject">Skip</button>` : ''}
      <button class="btn btn-ask" data-symbol="${s.symbol}" data-action="ask">Why?</button></div></div>`;
  },

  attachSignalActions(container) {
    $$('.btn', container).forEach(btn => {
      btn.addEventListener('click', async () => {
        const sym = btn.dataset.symbol, action = btn.dataset.action;
        const signal = this.signals.find(s => s.symbol === sym); if (!signal) return;
        if (action === 'approve') {
          const result = await Portfolio.executeTrade(signal, signal.action);
          if (result.ok) {
            const card = $(`#signal-${sym}`);
            if (card) { card.style.borderColor = 'var(--green)'; const acts = $('.suggestion-actions', card); if (acts) acts.innerHTML = `<div style="text-align:center;color:var(--green);font-weight:600;padding:6px;width:100%">Paper Trade: ${result.msg}</div>`; }
            this.showToast(result.msg); Notify.send('Trade Executed', result.msg); this.renderPortfolio(); this.renderBriefing();
          } else this.showToast(result.msg);
        } else if (action === 'reject') { const card = $(`#signal-${sym}`); if (card) { card.style.opacity = '0.3'; card.style.pointerEvents = 'none'; } this.showToast(`Skipped ${sym}`);
        } else if (action === 'ask') {
          this.openChat();
          const ta = TA.getAll(sym);
          this.addChatMessage('jarvis', `Here's my take on ${sym}:\n\n${signal.reason}\n\nTechnical:\n• RSI: ${ta.rsi.value} (${ta.rsi.signal})\n• MACD: ${ta.macd.signal}\n• VWAP: ${ta.vwap.signal}\n\nOverall: ${signal.action} (${signal.confidence}% confidence)`);
        }
      });
    });
  },

  // ---- PORTFOLIO ----
  renderPortfolio() {
    const pf = Portfolio.data, totalVal = Portfolio.getTotalValue(), pnl = Portfolio.getPnL();
    const invested = pf.holdings.reduce((s, h) => s + h.qty * h.buyPrice, 0);
    $('#portfolio-summary').innerHTML = `
      <div class="portfolio-card"><div class="p-label">Total Value</div><div class="p-value">${fmtCur(totalVal)}</div></div>
      <div class="portfolio-card"><div class="p-label">Cash</div><div class="p-value">${fmtCur(pf.balance)}</div></div>
      <div class="portfolio-card"><div class="p-label">Invested</div><div class="p-value">${fmtCur(invested)}</div></div>
      <div class="portfolio-card"><div class="p-label">P&L</div><div class="p-value" style="color:${pnl.abs >= 0 ? 'var(--green)' : 'var(--red)'}">${pnl.abs >= 0 ? '+' : ''}${fmtCur(pnl.abs)}</div><div class="p-change" style="color:${pnl.abs >= 0 ? 'var(--green)' : 'var(--red)'}">${pnl.pct >= 0 ? '+' : ''}${pnl.pct}%</div></div>`;

    const allocEl = $('#allocation-chart');
    if (allocEl) {
      if (!pf.holdings.length) allocEl.innerHTML = '<div class="empty-state"><p>No holdings to show</p></div>';
      else { const total = pf.holdings.reduce((s, h) => s + h.qty * Market.getPrice(h.symbol), 0);
        allocEl.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:10px;width:100%;justify-content:center">${pf.holdings.map(h => {
          const val = h.qty * Market.getPrice(h.symbol), pct = ((val / total) * 100).toFixed(1), color = Market.stocks[h.symbol]?.color || '#00d4ff';
          return `<div style="text-align:center;min-width:80px"><div style="width:60px;height:60px;border-radius:50%;border:3px solid ${color};display:flex;align-items:center;justify-content:center;margin:0 auto 6px;font-size:13px;font-weight:700;color:${color}">${pct}%</div><div style="font-size:12px;font-weight:600">${h.symbol}</div><div style="font-size:11px;color:var(--t3)">${fmtCur(val)}</div></div>`;
        }).join('')}</div>`; }
    }

    const holdEl = $('#holdings-container');
    if (holdEl) holdEl.innerHTML = !pf.holdings.length ? '<div class="empty-state"><h3>No holdings yet</h3><p>Approve a signal to start paper trading!</p></div>'
      : `<table class="holdings-table"><thead><tr><th>Stock</th><th>Qty</th><th>Avg</th><th>Current</th><th>P&L</th></tr></thead><tbody>${pf.holdings.map(h => {
        const curr = Market.getPrice(h.symbol), pl = (curr - h.buyPrice) * h.qty;
        return `<tr><td><strong>${h.symbol}</strong><br><small style="color:var(--t3)">${h.name}</small></td><td>${h.qty}</td><td>${fmtCur(h.buyPrice)}</td><td>${fmtCur(curr)}</td><td style="color:${pl >= 0 ? 'var(--green)' : 'var(--red)'}">${pl >= 0 ? '+' : ''}${fmtCur(pl)}</td></tr>`;
      }).join('')}</tbody></table>`;

    const histEl = $('#trade-history');
    if (histEl) histEl.innerHTML = !pf.history.length ? '<div class="empty-state"><p>No trades yet</p></div>'
      : pf.history.slice(0, 20).map(t => `<div class="market-card" style="margin-bottom:6px;cursor:default"><div style="display:flex;justify-content:space-between;align-items:center"><div><strong style="color:${t.type === 'BUY' ? 'var(--green)' : 'var(--red)'}">${t.type}</strong> ${t.symbol}<div style="font-size:11px;color:var(--t3)">${t.qty} shares @ ${fmtCur(t.price)}</div></div><div style="font-size:11px;color:var(--t3)">${new Date(t.date).toLocaleDateString('en-IN')}</div></div></div>`).join('');
  },

  // ---- SCREENER ----
  renderScreener() {
    const sectorSel = $('#scr-sector');
    if (sectorSel && !sectorSel._populated) {
      sectorSel._populated = true;
      Screener.getSectors().forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sectorSel.appendChild(o); });
      ['scr-sector', 'scr-signal', 'scr-rsi', 'scr-sort'].forEach(id => $(`#${id}`)?.addEventListener('change', () => this.renderScreenerResults()));
    }
    this.renderScreenerResults();
  },

  renderScreenerResults() {
    const results = Screener.filter({ sector: $('#scr-sector')?.value, signal: $('#scr-signal')?.value, rsi: $('#scr-rsi')?.value, sort: $('#scr-sort')?.value });
    const sumEl = $('#screener-summary');
    if (sumEl) { const b = results.filter(r => r.signal.action === 'BUY').length, s = results.filter(r => r.signal.action === 'SELL').length;
      sumEl.innerHTML = `<div style="display:flex;gap:12px;margin:10px 0;font-size:12px;color:var(--t3)"><span>${results.length} stocks</span><span style="color:var(--green)">${b} buy</span><span style="color:var(--red)">${s} sell</span><span style="color:var(--yellow)">${results.length - b - s} hold</span></div>`;
    }
    const el = $('#screener-results'); if (!el) return;
    el.innerHTML = `<table class="holdings-table"><thead><tr><th>Stock</th><th>Price</th><th>Change</th><th>RSI</th><th>Signal</th><th>Conf</th></tr></thead><tbody>${
      results.map(r => {
        const up = r.change?.pct >= 0, bc = r.signal.action === 'BUY' ? 'badge-buy' : r.signal.action === 'SELL' ? 'badge-sell' : 'badge-hold';
        return `<tr class="screener-row" data-symbol="${r.symbol}" style="cursor:pointer"><td><strong>${r.symbol}</strong><br><small style="color:var(--t3)">${r.name} · ${r.sector}</small></td>
          <td>${fmtCur(r.price)}</td><td style="color:${up ? 'var(--green)' : 'var(--red)'}">${up ? '+' : ''}${r.change?.pct || 0}%</td>
          <td><span class="${r.rsi.class}">${r.rsi.value}</span></td><td><span class="suggestion-badge ${bc}" style="font-size:10px;padding:2px 6px">${r.signal.action}</span></td><td>${r.signal.confidence}%</td></tr>`;
      }).join('')}</tbody></table>`;
    $$('.screener-row', el).forEach(row => row.addEventListener('click', () => { this.currentSymbol = row.dataset.symbol; this.navigateTo('charts'); }));
  },

  // ---- NEWS ----
  renderNews(query) {
    const el = $('#news-feed'); if (!el) return;
    el.innerHTML = '<div class="empty-state"><div class="loader-ring" style="margin:0 auto 12px"></div><p>Loading news...</p></div>';
    News.fetch(query).then(items => {
      if (!items.length) { el.innerHTML = '<div class="empty-state"><p>No news available. Make sure the server is running.</p></div>'; return; }
      el.innerHTML = items.map(item => `<div class="news-card"><div class="news-header"><span class="news-source">${item.source || 'News'}</span><span class="news-time">${item.timeAgo}</span></div>
        <a href="${item.link}" target="_blank" rel="noopener" class="news-title">${item.title}</a>
        <div class="news-sentiment"><span class="sentiment-dot" style="background:${item.sentiment.color}"></span><span style="color:${item.sentiment.color};font-size:11px;font-weight:600">${item.sentiment.label}</span></div></div>`).join('');
    });
  },

  // ---- ALERTS ----
  renderAlerts() {
    const active = Alerts.getActive(), triggered = Alerts.getTriggered();
    const activeEl = $('#active-alerts');
    if (activeEl) {
      activeEl.innerHTML = active.length ? active.map(a => `<div class="alert-card"><div class="alert-info"><div class="alert-symbol">${a.symbol}</div>
        <div class="alert-condition">Price goes ${a.condition} ${fmtCur(a.targetPrice)}</div><div class="alert-current">Current: ${fmtCur(Market.getPrice(a.symbol))}</div></div>
        <button class="wl-remove alert-remove" data-id="${a.id}" title="Remove">&times;</button></div>`).join('')
        : '<div class="empty-state"><p>No active alerts. Click + to create one.</p></div>';
      $$('.alert-remove', activeEl).forEach(btn => btn.addEventListener('click', () => { Alerts.remove(parseInt(btn.dataset.id)); this.renderAlerts(); this.showToast('Alert removed'); }));
    }
    const triggeredEl = $('#triggered-alerts');
    if (triggeredEl) {
      triggeredEl.innerHTML = triggered.length ? triggered.map(a => `<div class="alert-card triggered"><div class="alert-info"><div class="alert-symbol">${a.symbol} <span style="color:var(--green);font-size:11px">TRIGGERED</span></div>
        <div class="alert-condition">Price ${a.condition} ${fmtCur(a.targetPrice)} — Hit at ${fmtCur(a.triggerPrice || a.targetPrice)}</div>
        <div class="alert-current">${new Date(a.triggeredAt).toLocaleString('en-IN')}</div></div>
        <button class="wl-remove alert-remove" data-id="${a.id}" title="Remove">&times;</button></div>`).join('')
        : '<div class="empty-state"><p>No triggered alerts yet</p></div>';
      $$('.alert-remove', triggeredEl).forEach(btn => btn.addEventListener('click', () => { Alerts.remove(parseInt(btn.dataset.id)); this.renderAlerts(); }));
    }
  },

  setupAlertModal() {
    const modal = $('#alert-modal'), closeBtn = $('#alert-modal-close'), addBtn = $('#add-alert-btn'), createBtn = $('#alert-create-btn'), symSel = $('#alert-symbol');
    if (!modal || !addBtn) return;
    if (symSel) {
      Market.getTradeableSymbols().forEach(sym => { const o = document.createElement('option'); o.value = sym; o.textContent = `${sym} — ${Market.stocks[sym].name}`; symSel.appendChild(o); });
      symSel.addEventListener('change', () => { const p = $('#alert-current-price'); if (p) p.textContent = `Current: ${fmtCur(Market.getPrice(symSel.value))}`; });
    }
    addBtn.addEventListener('click', () => { modal.classList.add('show'); if (symSel?.value) { const p = $('#alert-current-price'); if (p) p.textContent = `Current: ${fmtCur(Market.getPrice(symSel.value))}`; } });
    closeBtn?.addEventListener('click', () => modal.classList.remove('show'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
    createBtn?.addEventListener('click', async () => {
      const sym = symSel?.value, cond = $('#alert-condition')?.value, price = parseFloat($('#alert-price')?.value);
      if (!sym || !price) { this.showToast('Fill all fields'); return; }
      await Alerts.create(sym, cond, price);
      modal.classList.remove('show'); this.renderAlerts();
      this.showToast(`Alert: ${sym} ${cond} ${fmtCur(price)}`);
      Notify.send('Alert Created', `${sym} ${cond} ${fmtCur(price)}`);
    });
  },

  // ---- BACKTEST ----
  renderBacktest() {
    const symSel = $('#bt-symbol');
    if (symSel && !symSel._populated) {
      symSel._populated = true;
      Market.getTradeableSymbols().forEach(sym => { const o = document.createElement('option'); o.value = sym; o.textContent = `${sym} — ${Market.stocks[sym].name}`; symSel.appendChild(o); });
    }
    const runBtn = $('#bt-run');
    if (runBtn && !runBtn._bound) { runBtn._bound = true; runBtn.addEventListener('click', () => this.runBacktest()); }
  },

  runBacktest() {
    const symbol = $('#bt-symbol')?.value, strategy = $('#bt-strategy')?.value, days = parseInt($('#bt-period')?.value) || 180;
    if (!symbol) { this.showToast('Select a stock'); return; }
    const r = Backtest.run(symbol, strategy, days);
    if (!r) { this.showToast('Not enough data'); return; }
    const el = $('#bt-results'); if (!el) return;
    const retColor = r.totalReturn >= 0 ? 'var(--green)' : 'var(--red)';
    el.innerHTML = `<div class="portfolio-summary">
      <div class="portfolio-card"><div class="p-label">Trades</div><div class="p-value">${r.totalTrades}</div></div>
      <div class="portfolio-card"><div class="p-label">Win Rate</div><div class="p-value" style="color:${r.winRate >= 50 ? 'var(--green)' : 'var(--red)'}">${r.winRate}%</div></div>
      <div class="portfolio-card"><div class="p-label">Return</div><div class="p-value" style="color:${retColor}">${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn}%</div></div>
      <div class="portfolio-card"><div class="p-label">Max Drawdown</div><div class="p-value" style="color:var(--red)">${r.maxDrawdown}%</div></div></div>
      ${r.totalTrades ? `<div class="section-title" style="margin-top:16px">Trade Log (${r.wins}W / ${r.losses}L)</div>
      <table class="holdings-table"><thead><tr><th>Entry</th><th>Exit</th><th>P&L</th><th>Days</th></tr></thead><tbody>${
        r.trades.map(t => `<tr><td>${fmtCur(t.entry)}<br><small style="color:var(--t3)">${t.entryDate}</small></td>
          <td>${fmtCur(t.exit)}${t.open ? ' <small style="color:var(--yellow)">(open)</small>' : ''}<br><small style="color:var(--t3)">${t.exitDate}</small></td>
          <td style="color:${t.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${t.pnl >= 0 ? '+' : ''}${t.pnlPct}%</td><td>${t.duration}d</td></tr>`).join('')
      }</tbody></table>` : '<div class="empty-state"><p>No trades generated by this strategy</p></div>'}
      <div style="font-size:11px;color:var(--t3);margin-top:12px;padding:8px;background:var(--bg3);border-radius:var(--r-sm)">Disclaimer: Backtesting uses simulated historical data. Past performance does not guarantee future results. Always use stop losses and proper risk management.</div>`;
    const chartEl = $('#bt-chart');
    if (chartEl) { chartEl.style.display = 'block'; Charts.create('bt-chart', symbol, { showSMA: strategy === 'sma', showVolume: false, days }); }
  },

  // ---- LEARN ----
  renderLearn() {
    const lessons = [
      { t: 'What is a Stock?', c: `Think of a company as a pizza. If it's divided into 1000 slices (shares), and you buy 10, you own 1% of that company. When the company does well, your slices become more valuable. That's stock trading!` },
      { t: 'What is NSE & BSE?', c: `NSE and BSE are marketplaces where stocks are bought and sold — like Amazon and Flipkart, but for company shares. Most traders use NSE as it handles more volume.` },
      { t: 'What is NIFTY 50?', c: `NIFTY 50 is like a "Top 50 Playlist" of India's biggest companies. If most do well, NIFTY goes up. When people say "market is up," they usually mean NIFTY went up.` },
      { t: 'Buy, Sell & Hold', c: `BUY = You think the price will go UP. SELL = You think it will go DOWN, so sell what you have. HOLD = Wait and watch. Don't do anything yet.` },
      { t: 'What is Stop Loss?', c: `A safety net. Buy at ₹100, set stop loss at ₹90. If it falls to ₹90, it auto-sells — limiting your loss to ₹10. Always use stop loss. Jarvis sets one for every signal.` },
      { t: 'What is RSI?', c: `RSI measures if a stock is "overbought" or "oversold." Above 70 = too expensive (might fall). Below 30 = too cheap (might rise). Between 30-70 = normal.` },
      { t: 'What is MACD?', c: `MACD shows momentum — whether a stock's trend is getting stronger or weaker. "Bullish" = upward momentum. "Bearish" = downward. Think of it as wind direction for stocks.` },
      { t: 'What is Paper Trading?', c: `Practice with fake money. Make trades as if real, but no actual money involved. Like a flight simulator before flying a real plane. Jarvis starts you here!` },
      { t: 'How Much to Start?', c: `In India, you can start with ₹100! Some stocks like Zomato (₹268), IRFC (₹160) let you buy single shares. Start small, learn patterns, increase gradually.` },
      { t: 'Key Risks', c: `1) Stocks can fall. 2) Markets can crash. 3) Companies can fail. That's why Jarvis uses stop losses, diversification, and analysis. But NO system is 100% safe.` },
    ];
    $('#learn-content').innerHTML = lessons.map(l => `<div class="settings-section" style="cursor:pointer" onclick="this.querySelector('.learn-body').style.display=this.querySelector('.learn-body').style.display==='none'?'block':'none'">
      <h3>${l.t}</h3><div class="learn-body" style="display:none"><p style="font-size:13px;line-height:1.7;color:var(--t2)">${l.c}</p></div></div>`).join('');
  },

  // ---- SETTINGS ----
  renderSettings() {
    const cfg = { geminiKey: '', claudeKey: '', aiEngine: 'gemini', notifications: true, budget: 10000, riskLevel: 'low', broker: 'paper', zerodhaApiKey: '', zerodhaSecret: '' };
    Store.get('config', cfg).then(saved => {
      Object.assign(cfg, saved);
      $('#settings-content').innerHTML = `
        <div class="settings-section"><h3>AI Engine</h3>
          <div class="setting-row"><div class="setting-info"><div class="setting-name">Gemini API Key</div><div class="setting-desc">Free from ai.google.dev</div></div><div style="display:flex;gap:6px;align-items:center"><input type="password" class="input-field" id="set-gemini-key" placeholder="Enter key..." value="${cfg.geminiKey}" style="width:140px"><button class="btn" style="flex:none;padding:6px 10px;font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:var(--r-sm)" id="test-gemini-btn">Test</button></div></div>
          <div id="gemini-test-result" style="font-size:11px;padding:4px 8px;display:none;border-radius:var(--r-sm);margin:-4px 0 4px"></div>
          <div class="setting-row"><div class="setting-info"><div class="setting-name">Claude API Key</div><div class="setting-desc">Optional — deeper analysis</div></div><input type="password" class="input-field" id="set-claude-key" placeholder="Enter key..." value="${cfg.claudeKey}" style="width:180px"></div>
          <div class="setting-row"><div class="setting-info"><div class="setting-name">Primary AI</div><div class="setting-desc">Which AI to use</div></div><select class="input-field" id="set-ai-engine" style="width:130px"><option value="gemini" ${cfg.aiEngine === 'gemini' ? 'selected' : ''}>Gemini (Free)</option><option value="claude" ${cfg.aiEngine === 'claude' ? 'selected' : ''}>Claude</option><option value="both" ${cfg.aiEngine === 'both' ? 'selected' : ''}>Both</option></select></div>
        </div>
        <div class="settings-section"><h3>Broker Integration</h3>
          <div class="setting-row"><div class="setting-info"><div class="setting-name">Trading Mode</div><div class="setting-desc">Paper = virtual, Zerodha = real</div></div><select class="input-field" id="set-broker" style="width:150px"><option value="paper" ${cfg.broker === 'paper' ? 'selected' : ''}>Paper Trading</option><option value="zerodha" ${cfg.broker === 'zerodha' ? 'selected' : ''}>Zerodha (Kite)</option></select></div>
          <div id="zerodha-settings" style="display:${cfg.broker === 'zerodha' ? 'block' : 'none'}">
            <div class="setting-row"><div class="setting-info"><div class="setting-name">Zerodha API Key</div><div class="setting-desc">From kite.trade</div></div><input type="password" class="input-field" id="set-zerodha-key" placeholder="API key..." value="${cfg.zerodhaApiKey || ''}" style="width:180px"></div>
            <div class="setting-row"><div class="setting-info"><div class="setting-name">API Secret</div></div><input type="password" class="input-field" id="set-zerodha-secret" placeholder="Secret..." value="${cfg.zerodhaSecret || ''}" style="width:180px"></div>
            <div class="setting-row"><div class="setting-info"><div class="setting-name">Connect</div></div><button class="btn btn-approve" style="flex:none;padding:8px 14px" id="zerodha-connect-btn">Connect Zerodha</button></div>
            <div style="font-size:11px;color:var(--t3);margin-top:8px;padding:8px;background:var(--bg2);border-radius:var(--r-sm)">Kite Connect needs a paid subscription (starts at ₹2000/month). Paper trading is free and great for learning.</div>
          </div>
        </div>
        <div class="settings-section"><h3>Trading</h3>
          <div class="setting-row"><div class="setting-info"><div class="setting-name">Budget</div><div class="setting-desc">Virtual starting money</div></div><input type="number" class="input-field" id="set-budget" value="${cfg.budget}" style="width:110px"></div>
          <div class="setting-row"><div class="setting-info"><div class="setting-name">Risk Level</div></div><select class="input-field" id="set-risk" style="width:130px"><option value="low" ${cfg.riskLevel === 'low' ? 'selected' : ''}>Conservative</option><option value="medium" ${cfg.riskLevel === 'medium' ? 'selected' : ''}>Balanced</option><option value="high" ${cfg.riskLevel === 'high' ? 'selected' : ''}>Aggressive</option></select></div>
        </div>
        <div class="settings-section"><h3>Notifications</h3>
          <div class="setting-row"><div class="setting-info"><div class="setting-name">Push Notifications</div><div class="setting-desc">Alerts for signals & price alerts</div></div><button class="toggle ${cfg.notifications ? 'active' : ''}" id="set-notif"></button></div>
        </div>
        <div class="settings-section"><h3>Data</h3>
          <div class="setting-row"><div class="setting-info"><div class="setting-name">Reset Portfolio</div></div><button class="btn btn-reject" style="flex:none;padding:8px 14px" id="reset-portfolio-btn">Reset</button></div>
          <div class="setting-row"><div class="setting-info"><div class="setting-name">Clear Alerts</div></div><button class="btn btn-reject" style="flex:none;padding:8px 14px" id="reset-alerts-btn">Clear</button></div>
        </div>
        <button class="btn btn-approve" style="width:100%;margin-top:8px" id="save-settings-btn">Save Settings</button>`;

      $('#set-broker')?.addEventListener('change', function() { const z = $('#zerodha-settings'); if (z) z.style.display = this.value === 'zerodha' ? 'block' : 'none'; });
      $$('.toggle', $('#settings-content')).forEach(t => t.addEventListener('click', () => t.classList.toggle('active')));

      $('#save-settings-btn')?.addEventListener('click', () => {
        const n = { geminiKey: $('#set-gemini-key')?.value || '', claudeKey: $('#set-claude-key')?.value || '', aiEngine: $('#set-ai-engine')?.value || 'gemini',
          notifications: $('#set-notif')?.classList.contains('active') ?? true, budget: parseInt($('#set-budget')?.value) || 10000, riskLevel: $('#set-risk')?.value || 'low',
          broker: $('#set-broker')?.value || 'paper', zerodhaApiKey: $('#set-zerodha-key')?.value || '', zerodhaSecret: $('#set-zerodha-secret')?.value || '' };
        Store.set('config', n);
        AI._config.geminiKey = n.geminiKey; AI._config.claudeKey = n.claudeKey; AI._config.engine = n.aiEngine;
        const tag = $('#ai-engine-tag'); if (tag) tag.textContent = AI.getEngineName();
        this.showToast('Settings saved!');
      });
      $('#test-gemini-btn')?.addEventListener('click', async () => {
        const key = $('#set-gemini-key')?.value; const box = $('#gemini-test-result');
        if (!key) { if (box) { box.style.display = 'block'; box.style.background = '#ff4a4a22'; box.style.color = '#ff6b6b'; box.textContent = 'Enter a key first'; } return; }
        if (box) { box.style.display = 'block'; box.style.background = 'var(--bg2)'; box.style.color = 'var(--t2)'; box.textContent = 'Testing key...'; }
        try {
          const r = await fetch('/api/ai/test-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key }) });
          const d = await r.json();
          if (box) { if (d.valid) { box.style.background = '#00e67622'; box.style.color = '#00e676'; box.textContent = 'Key works!'; }
            else { box.style.background = '#ff4a4a22'; box.style.color = '#ff6b6b'; box.innerHTML = d.hint || d.error; } }
        } catch { if (box) { box.style.display = 'block'; box.style.background = '#ff4a4a22'; box.style.color = '#ff6b6b'; box.textContent = 'Server error — is the server running?'; } }
      });
      $('#reset-portfolio-btn')?.addEventListener('click', () => { Portfolio.data = { balance: cfg.budget, holdings: [], history: [] }; Portfolio.save(); this.renderPortfolio(); this.renderBriefing(); this.showToast('Portfolio reset'); });
      $('#reset-alerts-btn')?.addEventListener('click', () => { Alerts._alerts = []; Alerts.save(); this.renderAlerts(); this.showToast('Alerts cleared'); });
      $('#zerodha-connect-btn')?.addEventListener('click', async () => {
        const key = $('#set-zerodha-key')?.value; if (!key) { this.showToast('Enter Zerodha API key first'); return; }
        try { const r = await fetch(`/api/zerodha/login?api_key=${encodeURIComponent(key)}`); const d = await r.json(); if (d.url) window.open(d.url, '_blank'); }
        catch { this.showToast('Failed to connect'); }
      });
    });
  },

  // ---- WATCHLIST MODAL ----
  setupWatchlistModal() {
    const backdrop = $('#modal-backdrop'), closeBtn = $('#modal-close'), searchInput = $('#watchlist-search'), addBtn = $('#add-watchlist-btn');
    if (!backdrop || !addBtn) return;
    addBtn.addEventListener('click', () => { backdrop.classList.add('show'); searchInput?.focus(); this.renderWatchlistOptions(''); });
    closeBtn?.addEventListener('click', () => backdrop.classList.remove('show'));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.classList.remove('show'); });
    searchInput?.addEventListener('input', () => this.renderWatchlistOptions(searchInput.value));
  },

  renderWatchlistOptions(query) {
    const results = $('#watchlist-results'); if (!results) return;
    const q = query.toLowerCase();
    const all = Object.entries(Market.stocks).filter(([sym]) => Market.stocks[sym].sector !== 'Index');
    const filtered = q ? all.filter(([sym, info]) => sym.toLowerCase().includes(q) || info.name.toLowerCase().includes(q)) : all;
    results.innerHTML = filtered.map(([sym, info]) => {
      const inList = this.watchlist.includes(sym);
      return `<div class="stock-option ${inList ? 'in-list' : ''}" data-symbol="${sym}"><div><strong>${sym}</strong> <span style="color:var(--t3);font-size:12px">${info.name}</span></div>
        <span style="font-size:12px;color:${inList ? 'var(--green)' : 'var(--t3)'}">${inList ? 'Added' : 'Add'}</span></div>`;
    }).join('');
    $$('.stock-option', results).forEach(opt => {
      opt.addEventListener('click', () => {
        const sym = opt.dataset.symbol;
        if (!this.watchlist.includes(sym)) { this.watchlist.push(sym); Store.set('watchlist', this.watchlist); this.renderWatchlist(); this.renderWatchlistOptions($('#watchlist-search')?.value || ''); this.showToast(`${sym} added`); }
      });
    });
  },

  // ---- CHAT ----
  setupChat() {
    const fab = $('#chat-fab'), panel = $('#chat-panel'), closeBtn = $('#chat-close'), input = $('#chat-input'), sendBtn = $('#chat-send');
    if (!fab || !panel) return;
    fab.addEventListener('click', () => this.openChat());
    closeBtn?.addEventListener('click', () => panel.classList.remove('open'));

    const send = () => {
      const msg = input?.value.trim(); if (!msg) return;
      this.addChatMessage('user', msg); if (input) input.value = '';
      const isAI = AI.isConfigured();
      this.addChatMessage('typing', isAI ? 'AI is thinking...' : 'Analyzing...');

      // Speak ack phrase NOW during the click gesture — iOS requires this
      Voice.primeWithAck();

      if (isAI) {
        AI.chat(msg).then(reply => { this.removeTyping(); this.addChatMessage('jarvis', reply || 'No response.'); Voice.queueResponse(reply || 'No response.'); })
          .catch(e => { this.removeTyping(); this.addChatMessage('error', 'AI error: ' + e.message); Voice.playTone('error'); setTimeout(() => this.jarvisReplyOffline(msg), 300); });
      } else {
        setTimeout(() => { this.removeTyping(); this.jarvisReplyOffline(msg); }, 500);
      }
    };
    sendBtn?.addEventListener('click', send);
    input?.addEventListener('keypress', e => { if (e.key === 'Enter') send(); });

    const mic = $('#chat-mic'), overlay = $('#voice-overlay'), cancelBtn = $('#voice-cancel');
    if (mic && Voice._supported) {
      mic.addEventListener('click', () => { this.openChat(); Voice.startListening(); });
      cancelBtn?.addEventListener('click', () => Voice.stopListening());
      overlay?.addEventListener('click', (e) => { if (e.target === overlay) Voice.stopListening(); });
    } else if (mic) { mic.style.display = 'none'; }

    const voiceToggle = $('#voice-toggle');
    if (voiceToggle) {
      if (!Voice._enabled) voiceToggle.classList.add('muted');
      voiceToggle.addEventListener('click', () => {
        const on = Voice.toggle();
        voiceToggle.classList.toggle('muted', !on);
        this.showToast(on ? 'Jarvis voice ON' : 'Jarvis voice OFF');
      });
    }

    $('#speaking-stop')?.addEventListener('click', () => Voice.stop());
  },

  openChat() { $('#chat-panel')?.classList.add('open'); $('#chat-input')?.focus(); },

  addChatMessage(role, text) {
    const c = $('#chat-messages'); if (!c) return;
    const div = document.createElement('div'); div.className = 'chat-msg ' + role; div.textContent = text;
    c.appendChild(div); c.scrollTop = c.scrollHeight;
  },

  removeTyping() { const el = $('.chat-msg.typing'); if (el) el.remove(); },

  jarvisReplyOffline(msg) {
    const m = msg.toLowerCase();
    let reply;
    if (m.includes('buy') || m.includes('recommend')) {
      const buys = this.signals.filter(s => s.action === 'BUY').slice(0, 3);
      reply = buys.length ? `Top picks today:\n\n${buys.map((s, i) => `${i + 1}. ${s.symbol} (${fmtCur(s.price)}) — ${s.confidence}%\n   ${s.reason.split('.')[0]}.`).join('\n\n')}\n\nCheck Signals tab for details!` : 'No strong buy signals right now. Sometimes the best trade is no trade!';
    } else if (m.includes('risk') || m.includes('safe') || m.includes('lose')) {
      reply = `Jarvis protects you with:\n1. Stop Loss on every signal\n2. Max 15% per stock\n3. Confidence scoring\n4. Paper trading first\n5. Technical analysis verification\n\nNo system is 100% safe. Never invest what you can't afford to lose.`;
    } else if (m.includes('nifty') || m.includes('market') || m.includes('sensex')) {
      const nch = Market.getChange('NIFTY');
      reply = `Market Update:\nNIFTY: ${fmt(Market.getPrice('NIFTY'))} (${nch.pct >= 0 ? '+' : ''}${nch.pct}%)\nSENSEX: ${fmt(Market.getPrice('SENSEX'))}\nBank NIFTY: ${fmt(Market.getPrice('BANKNIFTY'))}\n\nMood: ${nch.pct >= 0 ? 'Positive' : 'Cautious'}`;
    } else if (m.includes('portfolio') || m.includes('holding') || m.includes('profit')) {
      const pnl = Portfolio.getPnL();
      reply = `Portfolio:\nValue: ${fmtCur(Portfolio.getTotalValue())}\nCash: ${fmtCur(Portfolio.data.balance)}\nP&L: ${pnl.abs >= 0 ? '+' : ''}${fmtCur(pnl.abs)} (${pnl.pct}%)\nHoldings: ${Portfolio.data.holdings.length}`;
    } else if (m.includes('hello') || m.includes('hi') || m.includes('hey')) {
      reply = `Hello, Boss! Try asking:\n• "What should I buy?"\n• "How is the market?"\n• "Show my portfolio"\n• "Is this risky?"\n\nAdd a Gemini API key in Settings for AI-powered answers!`;
    } else {
      reply = `I can help with:\n• "What should I buy?" — recommendations\n• "How is market?" — overview\n• "My portfolio" — holdings\n• "Is this risky?" — risk info\n\nFor smarter answers, add a free Gemini API key in Settings!`;
    }
    this.addChatMessage('jarvis', reply);
    Voice.playTone('response');
    Voice.speak(reply);
  },

  // ---- TOAST ----
  showToast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); },
};

// ---- BOOT ----
document.addEventListener('DOMContentLoaded', async () => {
  await Voice.init();
  UI.init();
  setTimeout(() => Voice.greet(), 1500);
});
