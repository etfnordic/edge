// ============================================================
//  EdgeTrader — API-lager  (live-data version)
//
//  Datakällor:
//    Open-Meteo   — väder, prognos, historik (GRATIS, ingen nyckel)
//    Finnhub      — aktier, råvaror, forex, WebSocket-ticker (GRATIS nyckel)
//    Alpha Vantage— råvaruhistorik: vete, majs, natgas, koppar (GRATIS nyckel)
//    House Stock  — kongress-disclosures (GRATIS, ingen nyckel)
//
//  Sätt dina nycklar i config.js:
//    FINNHUB_KEY      → finnhub.io/register  (gratis, 60 req/min)
//    ALPHA_VANTAGE_KEY→ alphavantage.co      (gratis, 25 req/dag)
// ============================================================

const API = {

  // ── INTERN CACHE (minskar API-anrop) ───────────────────────
  _cache: {},
  _cacheGet(key) {
    const e = API._cache[key];
    if (e && Date.now() - e.ts < e.ttl) return e.data;
    return null;
  },
  _cacheSet(key, data, ttlMs) {
    API._cache[key] = { data, ts: Date.now(), ttl: ttlMs };
  },

  // ── FINNHUB — AKTIEKURS (REST) ──────────────────────────────
  // Dokumentation: https://finnhub.io/docs/api/quote
  // CORS: Ja. Gratis: 60 req/min.
  async getFinnhubQuote(symbol) {
    const cacheKey = `fh_quote_${symbol}`;
    const cached = API._cacheGet(cacheKey);
    if (cached) return cached;

    if (!CONFIG.FINNHUB_KEY || CONFIG.FINNHUB_KEY === 'DIN_NYCKEL_HÄR') {
      return API._mockQuote(symbol);
    }

    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${CONFIG.FINNHUB_KEY}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();

      // Finnhub returnerar: c=current, d=change, dp=changePct, h=high, l=low, o=open, pc=prevClose
      if (!d.c || d.c === 0) return API._mockQuote(symbol);

      const result = {
        symbol,
        price: d.c,
        change: d.d,
        changePct: d.dp,
        high: d.h,
        low: d.l,
        open: d.o,
        prevClose: d.pc,
        source: 'finnhub-live'
      };
      API._cacheSet(cacheKey, result, 60_000); // cache 1 min
      return result;
    } catch (e) {
      console.warn(`Finnhub quote fel (${symbol}):`, e.message);
      return API._mockQuote(symbol);
    }
  },

  // Alias som resten av koden använder
  async getQuote(symbol) {
    return API.getFinnhubQuote(symbol);
  },

  // ── FINNHUB — FLERA SYMBOLER PÅ EN GÅNG ────────────────────
  async getMultipleQuotes(symbols) {
    // Sekventiell fetch med liten delay för att respektera rate limit
    const results = {};
    for (const sym of symbols) {
      results[sym] = await API.getFinnhubQuote(sym);
      await new Promise(r => setTimeout(r, 120)); // 120ms spacing → max ~8/sek
    }
    return results;
  },

  // ── FINNHUB — RÅVARUPRISER ──────────────────────────────────
  // Finnhub stödjer forexsymboler och CFDs för råvaror
  // Gratis plan: OANDA:XAU_USD (guld), OANDA:XAG_USD (silver), etc.
  async getCommodityQuote(finnhubSymbol) {
    return API.getFinnhubQuote(finnhubSymbol);
  },

  // Guld/silver via Finnhub forex-endpoint
  async getGoldSilverRatio() {
    const cacheKey = 'gold_silver_ratio';
    const cached = API._cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const [gold, silver] = await Promise.all([
        API.getFinnhubQuote('OANDA:XAU_USD'),
        API.getFinnhubQuote('OANDA:XAG_USD')
      ]);

      // Fallback till kända råvarors senaste priser om Finnhub ej returnerar
      const goldPrice = (gold.price > 100) ? gold.price : 2650;
      const silverPrice = (silver.price > 1) ? silver.price : 30;
      const ratio = goldPrice / silverPrice;

      const result = {
        ratio: +ratio.toFixed(1),
        gold: goldPrice,
        silver: silverPrice,
        goldChange: gold.changePct || 0,
        silverChange: silver.changePct || 0,
        source: gold.source || 'mock'
      };
      API._cacheSet(cacheKey, result, 120_000);
      return result;
    } catch (e) {
      return { ratio: 88.4, gold: 2650, silver: 30, source: 'mock' };
    }
  },

  // ── FINNHUB — MARKNADSNYHETER ───────────────────────────────
  async getMarketNews(category = 'general') {
    const cacheKey = `news_${category}`;
    const cached = API._cacheGet(cacheKey);
    if (cached) return cached;

    if (!CONFIG.FINNHUB_KEY || CONFIG.FINNHUB_KEY === 'DIN_NYCKEL_HÄR') {
      return [];
    }

    try {
      const url = `https://finnhub.io/api/v1/news?category=${category}&token=${CONFIG.FINNHUB_KEY}`;
      const r = await fetch(url);
      const data = await r.json();
      const result = data.slice(0, 10).map(n => ({
        headline: n.headline,
        summary: n.summary,
        source: n.source,
        url: n.url,
        datetime: new Date(n.datetime * 1000).toLocaleDateString('sv-SE')
      }));
      API._cacheSet(cacheKey, result, 300_000); // cache 5 min
      return result;
    } catch (e) {
      return [];
    }
  },

  // ── FINNHUB WEBSOCKET — REALTIDS-TICK ──────────────────────
  // Dokumentation: https://finnhub.io/docs/api/websocket-trades
  // Gratis plan: 50 symboler. Pris uppdateras tick-by-tick.
  _ws: null,
  _wsCallbacks: {},
  _wsConnected: false,

  connectWebSocket(onTrade) {
    if (!CONFIG.FINNHUB_KEY || CONFIG.FINNHUB_KEY === 'DIN_NYCKEL_HÄR') {
      console.log('WebSocket: ingen Finnhub-nyckel, hoppar över.');
      return;
    }

    try {
      API._ws = new WebSocket(`wss://ws.finnhub.io?token=${CONFIG.FINNHUB_KEY}`);

      API._ws.onopen = () => {
        API._wsConnected = true;
        console.log('Finnhub WebSocket ansluten.');
        // Prenumerera på symboler direkt
        for (const sym of CONFIG.WS_SYMBOLS) {
          API._ws.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
        }
      };

      API._ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'trade' && msg.data) {
            msg.data.forEach(trade => {
              if (onTrade) onTrade({
                symbol: trade.s,
                price: trade.p,
                volume: trade.v,
                timestamp: trade.t
              });
            });
          }
        } catch (e) {}
      };

      API._ws.onerror = (e) => console.warn('WebSocket fel:', e);
      API._ws.onclose = () => {
        API._wsConnected = false;
        console.log('WebSocket stängd. Återansluter om 10s...');
        setTimeout(() => API.connectWebSocket(onTrade), 10_000);
      };
    } catch (e) {
      console.warn('WebSocket kunde inte starta:', e);
    }
  },

  disconnectWebSocket() {
    if (API._ws) {
      API._ws.close();
      API._ws = null;
    }
  },

  // ── ALPHA VANTAGE — RÅVARUHISTORIK ─────────────────────────
  // Dokumentation: https://www.alphavantage.co/documentation/#commodities
  // Gratis: 25 req/dag. CORS: Ja.
  // Stödjer: WTI, BRENT, NATURAL_GAS, COPPER, WHEAT, CORN, SUGAR, COFFEE
  async getCommodityHistory(commodity) {
    const cacheKey = `av_${commodity}`;
    const cached = API._cacheGet(cacheKey);
    if (cached) return cached;

    if (!CONFIG.ALPHA_VANTAGE_KEY || CONFIG.ALPHA_VANTAGE_KEY === 'DIN_NYCKEL_HÄR') {
      return API._mockCommodityHistory(commodity);
    }

    // Alpha Vantage funktionsnamn per råvara
    const fnMap = {
      WTI: 'WTI', BRENT: 'BRENT', NATURAL_GAS: 'NATURAL_GAS',
      COPPER: 'COPPER', WHEAT: 'WHEAT', CORN: 'CORN',
      SUGAR: 'SUGAR', COFFEE: 'COFFEE', ALUMINUM: 'ALUMINUM'
    };
    const fn = fnMap[commodity];
    if (!fn) return API._mockCommodityHistory(commodity);

    try {
      const url = `https://www.alphavantage.co/query?function=${fn}&interval=monthly&apikey=${CONFIG.ALPHA_VANTAGE_KEY}`;
      const r = await fetch(url);
      const d = await r.json();

      // Alpha Vantage returnerar { name, interval, unit, data: [{date, value}] }
      if (!d.data || d.data.length === 0) return API._mockCommodityHistory(commodity);

      const result = d.data
        .slice(0, 36) // senaste 3 år
        .map(p => ({ date: p.date, price: parseFloat(p.value) }))
        .filter(p => !isNaN(p.price))
        .reverse(); // kronologisk ordning

      API._cacheSet(cacheKey, result, 3_600_000); // cache 1 timme
      return result;
    } catch (e) {
      console.warn(`Alpha Vantage fel (${commodity}):`, e.message);
      return API._mockCommodityHistory(commodity);
    }
  },

  // Alpha Vantage — aktuellt pris för råvara (senaste månaden)
  async getCommodityPrice(commodity) {
    const history = await API.getCommodityHistory(commodity);
    if (!history.length) return null;
    const latest = history[history.length - 1];
    const prev = history[history.length - 2];
    return {
      commodity,
      price: latest.price,
      date: latest.date,
      change: prev ? +(latest.price - prev.price).toFixed(3) : 0,
      changePct: prev ? +((latest.price - prev.price) / prev.price * 100).toFixed(2) : 0,
      history
    };
  },

  // ── OPEN-METEO — VÄDERPROGNOS ───────────────────────────────
  // Dokumentation: https://open-meteo.com/en/docs
  // GRATIS, ingen nyckel, CORS ok, 16 dagars prognos, 80 år historik
  async getWeatherForecast(lat, lon, days = 16) {
    const cacheKey = `wx_fc_${lat}_${lon}_${days}`;
    const cached = API._cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const url = `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,` +
        `et0_fao_evapotranspiration,wind_speed_10m_max` +
        `&forecast_days=${days}&timezone=auto`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      API._cacheSet(cacheKey, d.daily, 1_800_000); // cache 30 min
      return d.daily;
    } catch (e) {
      console.warn('Open-Meteo prognos fel:', e.message);
      return API._mockForecast(days);
    }
  },

  async getCurrentWeather(lat, lon) {
    const cacheKey = `wx_cur_${lat}_${lon}`;
    const cached = API._cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const url = `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,precipitation,wind_speed_10m,` +
        `relative_humidity_2m,weather_code,apparent_temperature` +
        `&timezone=auto`;
      const r = await fetch(url);
      const d = await r.json();
      API._cacheSet(cacheKey, d.current, 600_000); // cache 10 min
      return d.current;
    } catch (e) {
      return API._mockCurrentWeather(lat, lon);
    }
  },

  // Open-Meteo historisk data — ERA5 reanalys (1940–nu)
  async getHistoricalWeather(lat, lon, startDate, endDate) {
    const cacheKey = `wx_hist_${lat}_${lon}_${startDate}_${endDate}`;
    const cached = API._cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const url = `https://archive-api.open-meteo.com/v1/archive` +
        `?latitude=${lat}&longitude=${lon}` +
        `&start_date=${startDate}&end_date=${endDate}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
      const r = await fetch(url);
      const d = await r.json();
      API._cacheSet(cacheKey, d.daily, 86_400_000); // cache 24h (historik ändras ej)
      return d.daily;
    } catch (e) {
      return null;
    }
  },

  // Beräkna z-score: hur extremt är aktuell temperatur vs klimatnormal
  async getWeatherZScore(lat, lon) {
    const cacheKey = `wx_z_${lat}_${lon}`;
    const cached = API._cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const today = new Date();
      const fmt = d => d.toISOString().split('T')[0];

      // Senaste 7 dagarna
      const start7 = new Date(today - 7 * 86400000);
      const recent = await API.getHistoricalWeather(lat, lon, fmt(start7), fmt(today));

      // Klimatnormal: samma 30-dagsperiod, 5 år bakåt
      const normals = [];
      for (let y = 1; y <= 5; y++) {
        const ys = new Date(today.getFullYear() - y, today.getMonth(), 1);
        const ye = new Date(today.getFullYear() - y, today.getMonth() + 1, 0);
        const hist = await API.getHistoricalWeather(lat, lon, fmt(ys), fmt(ye));
        if (hist?.temperature_2m_max?.length) {
          const avg = hist.temperature_2m_max.reduce((a, b) => a + b, 0) / hist.temperature_2m_max.length;
          normals.push(avg);
          await new Promise(r => setTimeout(r, 200)); // respektera rate limit
        }
      }

      if (!recent?.temperature_2m_max || normals.length < 2) {
        // Returnera simulerad z-score om vi ej får tillräcklig data
        return { zScore: +(Math.random() * 2 - 1).toFixed(2), recentAvg: 15, climateMean: 14, anomaly: 1, source: 'estimated' };
      }

      const recentAvg = recent.temperature_2m_max.reduce((a, b) => a + b, 0) / recent.temperature_2m_max.length;
      const mean = normals.reduce((a, b) => a + b, 0) / normals.length;
      const std = Math.sqrt(normals.map(n => (n - mean) ** 2).reduce((a, b) => a + b, 0) / normals.length) || 2;
      const zScore = (recentAvg - mean) / std;

      const result = {
        zScore: +zScore.toFixed(2),
        recentAvg: +recentAvg.toFixed(1),
        climateMean: +mean.toFixed(1),
        anomaly: +(recentAvg - mean).toFixed(1),
        source: 'open-meteo-live'
      };
      API._cacheSet(cacheKey, result, 3_600_000); // cache 1h
      return result;
    } catch (e) {
      return { zScore: 0, recentAvg: 15, climateMean: 15, anomaly: 0, source: 'error' };
    }
  },

  // ── HISTORICAL PRICES FÖR BACKTEST ─────────────────────────
  // Finnhub candles (kräver nyckel) — fallback till genererad data
  async getHistoricalPrices(symbol, period = '5y') {
    const cacheKey = `hist_${symbol}_${period}`;
    const cached = API._cacheGet(cacheKey);
    if (cached) return cached;

    if (!CONFIG.FINNHUB_KEY || CONFIG.FINNHUB_KEY === 'DIN_NYCKEL_HÄR') {
      return API._mockHistoricalPrices(symbol, period);
    }

    try {
      const days = { '1y': 365, '3y': 1095, '5y': 1825, '10y': 3650, '20y': 7300 }[period] || 1825;
      const to = Math.floor(Date.now() / 1000);
      const from = to - days * 86400;

      // Finnhub stock candles endpoint
      const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${CONFIG.FINNHUB_KEY}`;
      const r = await fetch(url);
      const d = await r.json();

      if (d.s !== 'ok' || !d.c) return API._mockHistoricalPrices(symbol, period);

      const result = d.t.map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        close: d.c[i],
        open: d.o[i],
        high: d.h[i],
        low: d.l[i],
        volume: d.v[i]
      }));

      API._cacheSet(cacheKey, result, 3_600_000);
      return result;
    } catch (e) {
      console.warn(`Historisk data fel (${symbol}):`, e.message);
      return API._mockHistoricalPrices(symbol, period);
    }
  },

  // ── KONGRESS-DISCLOSURES ─────────────────────────────────────
  // House Stock Watcher: gratis, ingen nyckel, CORS ok
  async getCongressTrades() {
    const cacheKey = 'congress_trades';
    const cached = API._cacheGet(cacheKey);
    if (cached) return cached;

    try {
      const r = await fetch('https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json');
      const data = await r.json();
      const cutoff = new Date(Date.now() - 45 * 86400000);

      const result = data
        .filter(t => new Date(t.transaction_date) > cutoff && t.type?.includes('Purchase') && t.ticker !== '--')
        .slice(0, 30)
        .map(t => ({
          representative: t.representative,
          ticker: t.ticker,
          date: t.transaction_date,
          amount: t.amount,
          type: t.type,
          district: t.district
        }));

      API._cacheSet(cacheKey, result, 3_600_000); // cache 1h
      return result;
    } catch (e) {
      console.warn('Kongress-data fel:', e.message);
      return API._mockCongressTrades();
    }
  },

  // ── MOCK-DATA (fallback när API ej är konfigurerat) ─────────
  _mockForecast(days) {
    const temps = [], precips = [], dates = [], tmin = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
      const t = +(15 + Math.sin(i * 0.4) * 8 + (Math.random() - 0.5) * 4).toFixed(1);
      temps.push(t);
      tmin.push(+(t - 5 - Math.random() * 3).toFixed(1));
      precips.push(+(Math.random() < 0.3 ? Math.random() * 15 : 0).toFixed(1));
    }
    return { time: dates, temperature_2m_max: temps, temperature_2m_min: tmin, precipitation_sum: precips };
  },

  _mockCurrentWeather(lat, lon) {
    const base = lat > 50 ? 8 : lat > 30 ? 22 : 28;
    return {
      temperature_2m: +(base + (Math.random() - 0.5) * 10).toFixed(1),
      apparent_temperature: +(base - 2 + (Math.random() - 0.5) * 8).toFixed(1),
      precipitation: +(Math.random() < 0.2 ? Math.random() * 5 : 0).toFixed(1),
      wind_speed_10m: +(5 + Math.random() * 15).toFixed(1),
      relative_humidity_2m: Math.round(50 + Math.random() * 40),
      weather_code: [0, 1, 2, 3, 51, 61, 71, 95][Math.floor(Math.random() * 8)]
    };
  },

  _mockQuote(symbol) {
    const bases = {
      'OANDA:XAU_USD': 2650, 'OANDA:XAG_USD': 30,
      'AAPL': 185, 'MSFT': 420, 'NVDA': 875,
      'ZC=F': 420, 'ZW=F': 540, 'ZS=F': 980,
      'KC=F': 185, 'NG=F': 2.8, 'CL=F': 78,
      'UNG': 14.2, 'GLD': 245, 'SLV': 28,
      'XACT BULL': 114, 'BULL OMXS30 X5': 42
    };
    const base = bases[symbol] || 100;
    const change = (Math.random() - 0.48) * base * 0.015;
    return {
      symbol, price: +(base + change).toFixed(2),
      change: +change.toFixed(2), changePct: +(change / base * 100).toFixed(2),
      source: 'mock'
    };
  },

  _mockHistoricalPrices(symbol, period) {
    const bases = { 'ZC=F': 420, 'ZW=F': 540, 'ZS=F': 980, 'KC=F': 185, 'NG=F': 2.8, 'GC=F': 2650 };
    const base = bases[symbol] || 100;
    const days = { '1y': 252, '3y': 756, '5y': 1260, '10y': 2520, '20y': 5040 }[period] || 1260;
    const result = [];
    let price = base * 0.6;
    for (let i = days; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      price *= 1 + (Math.random() - 0.495) * 0.022;
      result.push({ date: d.toISOString().split('T')[0], close: +price.toFixed(2) });
    }
    return result;
  },

  _mockCommodityHistory(commodity) {
    const bases = { WHEAT: 5.5, CORN: 4.2, NATURAL_GAS: 2.8, COPPER: 3.8, COFFEE: 1.9, SUGAR: 0.22 };
    const base = bases[commodity] || 100;
    const result = [];
    let price = base;
    for (let i = 35; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      price *= 1 + (Math.random() - 0.49) * 0.06;
      result.push({ date: d.toISOString().slice(0, 7) + '-01', price: +price.toFixed(3) });
    }
    return result;
  },

  _mockCongressTrades() {
    const reps = ['Nancy Pelosi', 'Michael McCaul', 'Austin Scott', 'Tim Burchett'];
    const tickers = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META'];
    const amounts = ['$1,001 - $15,000', '$15,001 - $50,000', '$50,001 - $100,000'];
    return Array.from({ length: 8 }, () => ({
      representative: reps[Math.floor(Math.random() * reps.length)],
      ticker: tickers[Math.floor(Math.random() * tickers.length)],
      date: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString().split('T')[0],
      amount: amounts[Math.floor(Math.random() * amounts.length)],
      type: 'Purchase'
    }));
  }
};
