// ============================================================
//  EdgeTrader — Konfiguration
//
//  STEG FÖR LIVE-DATA:
//  1. Finnhub (gratis):       https://finnhub.io/register
//  2. Alpha Vantage (gratis): https://www.alphavantage.co/support/#api-key
//  3. Klistra in nycklarna nedan och sätt USE_DEMO_DATA: false
//  4. config.js ligger redan i .gitignore — committa ALDRIG riktiga nycklar
//
//  Open-Meteo (väderdata) kräver INGEN nyckel — fungerar direkt.
// ============================================================

const CONFIG = {
  // ── SÄTT DINA NYCKLAR HÄR ──────────────────────────────────
  FINNHUB_KEY: 'd76o9h9r01qtg3nec6tgd76o9h9r01qtg3nec6u0',        // finnhub.io/register  → gratis, 60 req/min
  ALPHA_VANTAGE_KEY: 'V48V807XJY2RWMMA',  // alphavantage.co      → gratis, 25 req/dag
  // Open-Meteo kräver ingen nyckel ─ fungerar utan konfiguration

  // ── WEBSOCKET — realtids-tick via Finnhub ───────────────────
  // Gratis plan: max 50 symboler. Format: OANDA:XAU_USD, BINANCE:BTCUSDT, AAPL
  WS_SYMBOLS: [
    'OANDA:XAU_USD',    // Guld
    'OANDA:XAG_USD',    // Silver
    'OANDA:NATGAS_USD', // Natural Gas
    'OANDA:CORN_USD',   // Majs
    'OANDA:WHEAT_USD',  // Vete
  ],

  // ── DEMO-LÄGE ───────────────────────────────────────────────
  // true  = simulerad data (fungerar utan nycklar, bra för test)
  // false = live-data (kräver nycklar ovan)
  USE_DEMO_DATA: false,

  // Uppdateringsintervall (millisekunder)
  REFRESH_INTERVAL: 300000, // 5 minuter

  // Geografiska koordinater för väderregioner
  REGIONS: {
    cornbelt: {
      name: 'Corn Belt',
      coords: [{ lat: 41.9, lon: -93.6, name: 'Iowa' }, { lat: 40.6, lon: -89.4, name: 'Illinois' }],
      commodities: ['majs (ZC)', 'etanol', 'soja (ZS)'],
      instruments: ['CORN', 'ZC=F', 'WEAT'],
      description: 'Världs viktigaste majsregion. Torka juni-aug = prishöjning.'
    },
    wheat: {
      name: 'Vete-Plains',
      coords: [{ lat: 38.9, lon: -98.5, name: 'Kansas' }, { lat: 48.5, lon: 32.0, name: 'Ukraina' }],
      commodities: ['vete (ZW)', 'mjöl'],
      instruments: ['ZW=F', 'WEAT'],
      description: 'Frost mars-april = skördebortfall. Ukraina-konflikt förstärker.'
    },
    brazil: {
      name: 'Brasilien',
      coords: [{ lat: -15.8, lon: -47.9, name: 'Cerrado' }, { lat: -23.5, lon: -46.6, name: 'São Paulo' }],
      commodities: ['soja (ZS)', 'kaffe (KC)', 'socker (SB)'],
      instruments: ['ZS=F', 'KC=F', 'SB=F'],
      description: 'El Niño = torka i södra Brasilien. La Niña = torka i nordöst.'
    },
    nordic: {
      name: 'Norden',
      coords: [{ lat: 61.5, lon: 8.5, name: 'Norge' }, { lat: 63.2, lon: 14.0, name: 'Sverige' }],
      commodities: ['el-pris (EUR/MWh)', 'vattenmagasin'],
      instruments: ['ENEL.MI', 'VWS.CO'],
      description: 'Låg snömängd + kall vinter = höga elpriser. Hydro-korrelation r²=0.72.'
    },
    texas: {
      name: 'Texas/Gulf',
      coords: [{ lat: 29.8, lon: -95.4, name: 'Houston' }, { lat: 32.8, lon: -97.3, name: 'Dallas' }],
      commodities: ['natural gas (NG)', 'crude oil (CL)'],
      instruments: ['NG=F', 'CL=F', 'UNG'],
      description: 'Kyla under -5°C i Gulf Coast = demand spike i natural gas.'
    }
  },

  // Edge-strategier med metadata
  EDGES: {
    cornbelt_drought: {
      name: 'Corn Belt torka → majs',
      category: 'weather',
      historicalAccuracy: 0.71,
      avgReturn: 0.048,
      avgHoldDays: 12,
      description: 'Z-score nederbörd < -1.5 under pollination (jun-aug) → long majs',
      signal: 'buy',
      commodity: 'Majs (ZC=F)'
    },
    polar_vortex: {
      name: 'Polar Vortex → Natural Gas',
      category: 'weather',
      historicalAccuracy: 0.74,
      avgReturn: 0.062,
      avgHoldDays: 7,
      description: 'Temp > 2σ under normalt i Midwest 5+ dagar → long natural gas',
      signal: 'buy',
      commodity: 'Natural Gas (UNG)'
    },
    enso_coffee: {
      name: 'ENSO La Niña → kaffe',
      category: 'macro',
      historicalAccuracy: 0.67,
      avgReturn: 0.091,
      avgHoldDays: 45,
      description: 'La Niña index < -0.5 → torka Brasilien → long kaffe 4-8 veckor',
      signal: 'buy',
      commodity: 'Kaffe (KC=F)'
    },
    ukraine_wheat: {
      name: 'Ukraina torka → vete',
      category: 'weather',
      historicalAccuracy: 0.69,
      avgReturn: 0.055,
      avgHoldDays: 18,
      description: 'Torr vår (mar-maj) i södra Ukraina → lägre skörd → long vete',
      signal: 'buy',
      commodity: 'Vete (ZW=F)'
    },
    nordic_hydro: {
      name: 'Nordisk hydro-prediktor',
      category: 'weather',
      historicalAccuracy: 0.72,
      avgReturn: 0.038,
      avgHoldDays: 21,
      description: 'Magasinsnivå < 70% + kall prognos → höga elpriser → long el-ETF',
      signal: 'buy',
      commodity: 'Nordisk el'
    },
    gold_silver_ratio: {
      name: 'Guld/silver-ratio mean reversion',
      category: 'macro',
      historicalAccuracy: 0.73,
      avgReturn: 0.044,
      avgHoldDays: 30,
      description: 'Ratio > 90 → silver undervärderat → long silver. Ratio < 65 → short silver.',
      signal: 'conditional',
      commodity: 'Silver (SLV)'
    },
    congressional: {
      name: 'Kongress-disclosure lag',
      category: 'alternative',
      historicalAccuracy: 0.68,
      avgReturn: 0.031,
      avgHoldDays: 8,
      description: 'Kongressledamöter köper aktie → kopia med 1-3 dagars lag',
      signal: 'copy',
      commodity: 'US-aktier'
    },
    pre_fomc: {
      name: 'Pre-FOMC drift',
      category: 'calendar',
      historicalAccuracy: 0.76,
      avgReturn: 0.021,
      avgHoldDays: 2,
      description: 'S&P500 stiger statistiskt 2 dagar före Fed-möte → long index',
      signal: 'buy',
      commodity: 'OMXS30/S&P500'
    }
  }
};
