// ============================================================
//  EdgeTrader — API-lager
//  Hanterar: Open-Meteo (gratis), Yahoo Finance, Alpha Vantage
// ============================================================

const API = {

  // ── OPEN-METEO ─────────────────────────────────────────────
  // Helt gratis, ingen API-nyckel, 80 år historik + 16 dagars prognos

  async getWeatherForecast(lat, lon, days = 16) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration` +
        `&forecast_days=${days}&timezone=auto`;
      const r = await fetch(url);
      const d = await r.json();
      return d.daily;
    } catch (e) {
      console.warn('Open-Meteo forecast error:', e);
      return API._mockForecast(days);
    }
  },

  async getHistoricalWeather(lat, lon, startDate, endDate) {
    try {
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
        `&start_date=${startDate}&end_date=${endDate}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
      const r = await fetch(url);
      return await r.json();
    } catch (e) {
      console.warn('Open-Meteo historical error:', e);
      return null;
    }
  },

  async getCurrentWeather(lat, lon) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m,weather_code` +
        `&hourly=temperature_2m&forecast_days=1&timezone=auto`;
      const r = await fetch(url);
      const d = await r.json();
      return d.current;
    } catch (e) {
      return API._mockCurrentWeather(lat, lon);
    }
  },

  // Beräkna z-score: hur extremt är det aktuella vädret vs historiskt snitt
  async getWeatherZScore(lat, lon) {
    try {
      const today = new Date();
      const endDate = today.toISOString().split('T')[0];
      const startDate30 = new Date(today - 30 * 86400000).toISOString().split('T')[0];

      // Hämta senaste 30 dagarna
      const recent = await API.getHistoricalWeather(lat, lon, startDate30, endDate);

      // Klimatnormal: samma månad, senaste 5 år
      const normals = [];
      for (let y = 1; y <= 5; y++) {
        const ys = new Date(today.getFullYear() - y, today.getMonth(), 1).toISOString().split('T')[0];
        const ye = new Date(today.getFullYear() - y, today.getMonth() + 1, 0).toISOString().split('T')[0];
        const hist = await API.getHistoricalWeather(lat, lon, ys, ye);
        if (hist?.daily?.temperature_2m_max) {
          const avg = hist.daily.temperature_2m_max.reduce((a, b) => a + b, 0) / hist.daily.temperature_2m_max.length;
          normals.push(avg);
        }
      }

      if (!recent?.daily?.temperature_2m_max || normals.length === 0) return null;

      const recentAvg = recent.daily.temperature_2m_max.slice(-7).reduce((a, b) => a + b, 0) / 7;
      const mean = normals.reduce((a, b) => a + b, 0) / normals.length;
      const std = Math.sqrt(normals.map(n => (n - mean) ** 2).reduce((a, b) => a + b, 0) / normals.length) || 2;
      const zScore = (recentAvg - mean) / std;

      return {
        zScore: +zScore.toFixed(2),
        recentAvg: +recentAvg.toFixed(1),
        climateMean: +mean.toFixed(1),
        anomaly: +((recentAvg - mean).toFixed(1))
      };
    } catch (e) {
      return { zScore: +(Math.random() * 3 - 1).toFixed(2), recentAvg: 12, climateMean: 11, anomaly: 1 };
    }
  },

  // Säsongs-ECMWF prognos (Open-Meteo seasonal API)
  async getSeasonalForecast(lat, lon) {
    try {
      const url = `https://seasonal-api.open-meteo.com/v1/seasonal?latitude=${lat}&longitude=${lon}` +
        `&monthly=temperature_2m_mean,precipitation_sum&forecast_months=3`;
      const r = await fetch(url);
      return await r.json();
    } catch (e) {
      return null;
    }
  },

  // ── YAHOO FINANCE ───────────────────────────────────────────
  async getQuote(symbol) {
    if (CONFIG.USE_DEMO_DATA) return API._mockQuote(symbol);
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const d = await r.json();
      const q = d.chart?.result?.[0];
      if (!q) return API._mockQuote(symbol);
      const closes = q.indicators.quote[0].close;
      const price = closes[closes.length - 1];
      const prev = closes[closes.length - 2];
      return {
        symbol,
        price: +price.toFixed(2),
        change: +(price - prev).toFixed(2),
        changePct: +((price - prev) / prev * 100).toFixed(2),
        volume: q.indicators.quote[0].volume?.[closes.length - 1] || 0
      };
    } catch (e) {
      return API._mockQuote(symbol);
    }
  },

  async getHistoricalPrices(symbol, period = '5y') {
    if (CONFIG.USE_DEMO_DATA) return API._mockHistoricalPrices(symbol, period);
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${period}`;
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const d = await r.json();
      const q = d.chart?.result?.[0];
      if (!q) return API._mockHistoricalPrices(symbol, period);
      const timestamps = q.timestamp;
      const closes = q.indicators.quote[0].close;
      return timestamps.map((t, i) => ({
        date: new Date(t * 1000).toISOString().split('T')[0],
        close: closes[i]
      })).filter(p => p.close !== null);
    } catch (e) {
      return API._mockHistoricalPrices(symbol, period);
    }
  },

  // Guld/silver-ratio
  async getGoldSilverRatio() {
    try {
      const [gold, silver] = await Promise.all([
        API.getQuote('GC=F'),
        API.getQuote('SI=F')
      ]);
      const ratio = gold.price / silver.price;
      return { ratio: +ratio.toFixed(1), gold: gold.price, silver: silver.price };
    } catch (e) {
      return { ratio: 88.4, gold: 2650, silver: 30 };
    }
  },

  // ── ALPHA VANTAGE ───────────────────────────────────────────
  async getCommodityPrice(commodity) {
    if (CONFIG.ALPHA_VANTAGE_KEY === 'demo' || CONFIG.USE_DEMO_DATA) {
      return API._mockCommodityData(commodity);
    }
    try {
      const endpoint = {
        'WTI': 'WTI', 'BRENT': 'BRENT',
        'NATURAL_GAS': 'NATURAL_GAS', 'COPPER': 'COPPER',
        'WHEAT': 'WHEAT', 'CORN': 'CORN'
      }[commodity] || commodity;
      const url = `https://www.alphavantage.co/query?function=${endpoint}&interval=monthly&apikey=${CONFIG.ALPHA_VANTAGE_KEY}`;
      const r = await fetch(url);
      const d = await r.json();
      const data = d.data?.slice(0, 24);
      return data?.map(p => ({ date: p.date, price: +p.value })) || [];
    } catch (e) {
      return API._mockCommodityData(commodity);
    }
  },

  // House Stock Watcher (US-kongress-disclosures)
  async getCongressTrades() {
    try {
      const r = await fetch('https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json');
      const data = await r.json();
      const recent = data
        .filter(t => {
          const d = new Date(t.transaction_date);
          const cutoff = new Date(Date.now() - 45 * 86400000);
          return d > cutoff && t.type?.includes('Purchase');
        })
        .slice(0, 20)
        .map(t => ({
          representative: t.representative,
          ticker: t.ticker,
          date: t.transaction_date,
          amount: t.amount,
          type: t.type
        }));
      return recent;
    } catch (e) {
      return API._mockCongressTrades();
    }
  },

  // ── MOCK DATA ───────────────────────────────────────────────
  _mockForecast(days) {
    const temps = [], precips = [], dates = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
      temps.push(+(15 + Math.sin(i * 0.4) * 8 + (Math.random() - 0.5) * 4).toFixed(1));
      precips.push(+(Math.random() < 0.3 ? Math.random() * 15 : 0).toFixed(1));
    }
    return { time: dates, temperature_2m_max: temps, precipitation_sum: precips };
  },

  _mockCurrentWeather(lat, lon) {
    const base = lat > 50 ? 8 : lat > 30 ? 22 : 28;
    return {
      temperature_2m: +(base + (Math.random() - 0.5) * 10).toFixed(1),
      precipitation: +(Math.random() < 0.2 ? Math.random() * 5 : 0).toFixed(1),
      wind_speed_10m: +(5 + Math.random() * 15).toFixed(1),
      relative_humidity_2m: Math.round(50 + Math.random() * 40),
      weather_code: [0, 1, 2, 3, 51, 61, 71, 95][Math.floor(Math.random() * 8)]
    };
  },

  _mockQuote(symbol) {
    const prices = {
      'GC=F': 2650, 'SI=F': 30, 'ZC=F': 420, 'ZW=F': 540,
      'ZS=F': 980, 'KC=F': 185, 'NG=F': 2.8, 'CL=F': 78,
      'UNG': 14.2, 'GLD': 245, 'SLV': 28,
      '^GSPC': 5200, 'XACT BULL': 114, 'BULL OMXS30 X5': 42
    };
    const base = prices[symbol] || 100;
    const change = (Math.random() - 0.48) * base * 0.015;
    return {
      symbol,
      price: +(base + change).toFixed(2),
      change: +change.toFixed(2),
      changePct: +(change / base * 100).toFixed(2),
      volume: Math.round(1e6 + Math.random() * 9e6)
    };
  },

  _mockHistoricalPrices(symbol, period) {
    const prices = { 'ZC=F': 420, 'ZW=F': 540, 'ZS=F': 980, 'KC=F': 185, 'NG=F': 2.8, 'GC=F': 2650, 'SI=F': 30 };
    const base = prices[symbol] || 100;
    const days = { '1y': 252, '3y': 756, '5y': 1260, '10y': 2520, '20y': 5040 }[period] || 1260;
    const result = [];
    let price = base * 0.6;
    const now = new Date();
    for (let i = days; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      price *= 1 + (Math.random() - 0.495) * 0.022;
      result.push({ date: d.toISOString().split('T')[0], close: +price.toFixed(2) });
    }
    return result;
  },

  _mockCommodityData(commodity) {
    const base = { WHEAT: 5.5, CORN: 4.2, NATURAL_GAS: 2.8, COPPER: 3.8 }[commodity] || 100;
    const result = [];
    let price = base;
    for (let i = 23; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      price *= 1 + (Math.random() - 0.49) * 0.06;
      result.push({ date: d.toISOString().slice(0, 7), price: +price.toFixed(3) });
    }
    return result;
  },

  _mockCongressTrades() {
    const reps = ['Nancy Pelosi', 'Michael McCaul', 'Austin Scott', 'Greg Gianforte', 'Tim Burchett'];
    const tickers = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'META', 'TSM', 'AVGO'];
    const amounts = ['$1,001 - $15,000', '$15,001 - $50,000', '$50,001 - $100,000', '$100,001 - $250,000'];
    return Array.from({ length: 10 }, (_, i) => ({
      representative: reps[Math.floor(Math.random() * reps.length)],
      ticker: tickers[Math.floor(Math.random() * tickers.length)],
      date: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString().split('T')[0],
      amount: amounts[Math.floor(Math.random() * amounts.length)],
      type: 'Purchase'
    }));
  }
};
