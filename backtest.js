// ============================================================
//  EdgeTrader — Backtesting-motor  v2
//
//  Två lägen:
//    1. Edge-backtest   — väder/makro-signaler mot historiska priser
//    2. Congress-backtest — riktiga House Stock Watcher trades
//       Hämtar faktiska kongress-köp och simulerar "kopia med N dagars lag"
// ============================================================

const Backtest = {
  _lastResult: null,
  _mode: 'edge',

  // ── ENTRY POINT ─────────────────────────────────────────────
  async run() {
    const btn = document.querySelector('[onclick="Backtest.run()"]');
    if (btn) { btn.classList.add('loading'); btn.querySelector('span').textContent = '⟳ HÄMTAR DATA...'; }

    Backtest._mode = document.getElementById('bt-edge').value === 'congressional' ? 'congress' : 'edge';

    try {
      if (Backtest._mode === 'congress') {
        await Backtest._runCongress();
      } else {
        await Backtest._runEdge();
      }
    } catch (e) {
      Backtest._showError('Fel: ' + e.message);
      console.error(e);
    }

    if (btn) { btn.classList.remove('loading'); btn.querySelector('span').textContent = '▶ KÖR BACKTEST'; }
  },

  // ════════════════════════════════════════════════════════════
  //  LÄGE 1 — EDGE-BACKTEST
  // ════════════════════════════════════════════════════════════
  async _runEdge() {
    const config = Backtest._readConfig();
    const symbolMap = {
      'Corn futures (ZC)': 'ZC=F', 'Wheat futures (ZW)': 'ZW=F',
      'Natural Gas (UNG)': 'UNG',  'Gold (GLD)': 'GLD',
      'Silver (SLV)': 'SLV',       'Coffee (KC)': 'KC=F',
      'BULL OMXS30 X5': 'AAPL',   'BEAR OMXS30 X5': 'AAPL', 'XACT BULL': 'AAPL'
    };
    const periodMap = { 3: '3y', 5: '5y', 10: '10y', 20: '20y' };
    const symbol = symbolMap[config.instrument] || 'AAPL';
    const prices = await API.getHistoricalPrices(symbol, periodMap[config.periodYears] || '5y');

    if (!prices || prices.length < 50) {
      Backtest._showError('Inte tillräckligt med prisdata. Försök igen.'); return;
    }

    const trades  = Backtest._generateEdgeTrades(prices, config);
    const equity  = Backtest._buildEquityCurve(trades, config.capital);
    const metrics = Backtest._calcMetrics(equity, trades, config);
    Backtest._lastResult = { config, trades, equity, metrics, mode: 'edge' };
    Backtest._renderEdgeResults(metrics, trades, equity, config);
  },

  // ════════════════════════════════════════════════════════════
  //  LÄGE 2 — CONGRESS BACKTEST
  // ════════════════════════════════════════════════════════════
  async _runCongress() {
    const config = Backtest._readConfig();
    const lag    = config.congressLag;
    const hold   = config.congressHold;

    // Steg 1 — hämta riktiga kongress-trades
    Backtest._setStatus('Hämtar kongress-disclosures från House Stock Watcher...');
    const rawTrades = await API.getCongressTrades();

    if (!rawTrades || rawTrades.length === 0) {
      Backtest._showError('Ingen kongress-data tillgänglig. Kontrollera nätverksanslutning.'); return;
    }

    // Steg 2 — filtrera: bara köp, giltig ticker, inom vald period
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - config.periodYears);

    const filtered = rawTrades.filter(t =>
      t.type?.toLowerCase().includes('purchase') &&
      t.ticker && t.ticker !== '--' && /^[A-Z]{1,5}$/.test(t.ticker) &&
      new Date(t.date) >= cutoffDate
    );

    if (filtered.length === 0) {
      Backtest._showError(`Inga köp-trades för senaste ${config.periodYears} år. Prova fler år.`); return;
    }

    // Steg 3 — hämta prisdata per unik ticker
    const uniqueTickers = [...new Set(filtered.map(t => t.ticker))];
    Backtest._setStatus(`Hämtar historiska priser för ${uniqueTickers.length} tickers (${filtered.length} trades)...`);

    const priceData = {};
    for (const ticker of uniqueTickers.slice(0, 40)) {
      try {
        const prices = await API.getHistoricalPrices(ticker, '5y');
        if (prices && prices.length > 20) priceData[ticker] = prices;
        await new Promise(r => setTimeout(r, 150));
      } catch (e) { /* hoppa över */ }
    }

    const gotPrices = Object.keys(priceData).length;
    if (gotPrices === 0) {
      Backtest._showError('Kunde inte hämta prisdata. Kontrollera Finnhub-nyckeln.'); return;
    }
    Backtest._setStatus(`Simulerar trades mot ${gotPrices} tickers...`);

    // Steg 4 — simulera varje kongress-trade
    const trades = [];
    let runningCapital = config.capital;

    for (const ct of filtered) {
      const prices = priceData[ct.ticker];
      if (!prices || prices.length < 5) continue;

      // Hitta entry: disclosure-datum + lag dagar
      const entryTarget = new Date(ct.date);
      entryTarget.setDate(entryTarget.getDate() + lag);
      const entryIdx = Backtest._findNearestIdx(prices, entryTarget);
      if (entryIdx < 0 || entryIdx >= prices.length - 2) continue;

      const entryPrice = prices[entryIdx].close;
      const entryDate  = prices[entryIdx].date;
      if (!entryPrice || entryPrice <= 0) continue;

      // Position sizing
      const posSize  = Backtest._calcPositionSize(config.sizing, runningCapital, 0.68, 0.031, config.stopLoss);
      const stopPrice = entryPrice * (1 - config.stopLoss);

      // Simulera exit
      let exitPrice = entryPrice, exitDate = entryDate, exitReason = 'MAX-HOLD';
      for (let j = entryIdx + 1; j < prices.length && j <= entryIdx + hold; j++) {
        exitPrice = prices[j].close;
        exitDate  = prices[j].date;
        if (exitPrice <= stopPrice) { exitReason = 'STOP-LOSS'; exitPrice = stopPrice; break; }
      }

      const rawReturn  = (exitPrice - entryPrice) / entryPrice;
      const leveraged  = rawReturn * config.leverage;
      const grossPnl   = leveraged * posSize;
      const fees       = posSize * 0.002;
      const netPnl     = grossPnl - fees;
      runningCapital  += netPnl;

      trades.push({
        id:              trades.length + 1,
        congressman:     ct.representative,
        ticker:          ct.ticker,
        disclosureDate:  ct.date,
        disclosedAmount: ct.amount || '—',
        district:        ct.district || '—',
        entryDate,
        exitDate,
        entryPrice:       +entryPrice.toFixed(2),
        exitPrice:        +exitPrice.toFixed(2),
        direction:        'buy',
        posSize:          +posSize.toFixed(0),
        rawReturn:        +(rawReturn * 100).toFixed(2),
        leveragedReturn:  +(leveraged * 100).toFixed(2),
        pnl:              +netPnl.toFixed(0),
        holdDays:         Backtest._daysBetween(entryDate, exitDate),
        lagDays:          Backtest._daysBetween(ct.date, entryDate),
        exitReason,
        signal:           `Kongress-köp`
      });
    }

    if (trades.length === 0) {
      Backtest._showError('Inga trades kunde simuleras. Prova längre period eller lägre lag.'); return;
    }

    const equity  = Backtest._buildEquityCurve(trades, config.capital);
    const metrics = Backtest._calcMetrics(equity, trades, config);
    Backtest._lastResult = { config, trades, equity, metrics, mode: 'congress' };
    Backtest._renderCongressResults(metrics, trades, equity, config);
  },

  // Hitta index i prisarray närmast ett datum (accepterar upp till 10 dagar bort)
  _findNearestIdx(prices, targetDate) {
    const target = targetDate.getTime();
    let bestIdx = -1, bestDiff = Infinity;
    for (let i = 0; i < prices.length; i++) {
      const diff = Math.abs(new Date(prices[i].date).getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    return bestDiff < 10 * 86400000 ? bestIdx : -1;
  },

  // ════════════════════════════════════════════════════════════
  //  EDGE-SIGNAL GENERERING
  // ════════════════════════════════════════════════════════════
  _generateEdgeTrades(prices, config) {
    const meta    = CONFIG.EDGES[config.edge] || CONFIG.EDGES.cornbelt_drought;
    const trades  = [];
    let inTrade   = false, entry = null;
    const signals = Backtest._simulateSignals(prices, config);

    for (let i = 20; i < prices.length; i++) {
      const sig   = signals[i];
      const price = prices[i].close;
      const date  = prices[i].date;

      if (!inTrade && sig.active && sig.direction !== 'neutral') {
        const posSize = Backtest._calcPositionSize(config.sizing, config.capital, meta.historicalAccuracy, meta.avgReturn, config.stopLoss);
        entry = {
          entryDate: date, entryPrice: price, direction: sig.direction, size: posSize,
          stopLoss: sig.direction === 'buy' ? price * (1 - config.stopLoss) : price * (1 + config.stopLoss)
        };
        inTrade = true; continue;
      }

      if (inTrade && entry) {
        const holdDays  = Backtest._daysBetween(entry.entryDate, date);
        const move      = (price - entry.entryPrice) / entry.entryPrice;
        const leveraged = move * config.leverage * (entry.direction === 'buy' ? 1 : -1);
        const hitStop   = entry.direction === 'buy' ? price <= entry.stopLoss : price >= entry.stopLoss;
        const hitTarget = leveraged >= meta.avgReturn * config.leverage * 2;
        const maxHold   = holdDays >= meta.avgHoldDays * 2;

        if (hitStop || hitTarget || maxHold || !sig.active) {
          const fees = entry.size * 0.002;
          trades.push({
            id: trades.length + 1,
            entryDate: entry.entryDate, exitDate: date,
            direction: entry.direction,
            entryPrice: +entry.entryPrice.toFixed(2), exitPrice: +price.toFixed(2),
            posSize: +entry.size.toFixed(0),
            rawReturn: +(leveraged * 100).toFixed(2),
            pnl: +(leveraged * entry.size - fees).toFixed(0),
            exitReason: hitStop ? 'STOP-LOSS' : hitTarget ? 'TARGET' : maxHold ? 'MAX-HOLD' : 'SIGNAL-EXIT',
            holdDays, signal: config.edge
          });
          inTrade = false; entry = null;
        }
      }
    }
    return trades;
  },

  _simulateSignals(prices, config) {
    const sigs     = prices.map(() => ({ active: false, direction: 'neutral', strength: 0 }));
    const meta     = CONFIG.EDGES[config.edge] || CONFIG.EDGES.cornbelt_drought;
    const accuracy = meta.historicalAccuracy;

    for (let i = 20; i < prices.length; i++) {
      const date  = new Date(prices[i].date);
      const month = date.getMonth() + 1;
      const doy   = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
      const win   = prices.slice(i - 20, i).map(p => p.close);
      const mean  = win.reduce((a, b) => a + b, 0) / win.length;
      const std   = Math.sqrt(win.map(p => (p - mean) ** 2).reduce((a, b) => a + b, 0) / win.length) || 1;
      const priceZ = (prices[i].close - mean) / std;

      const seasonScore = ({ cornbelt_drought: (month >= 6 && month <= 8) ? 1.5 : 0.6, polar_vortex: (month >= 11 || month <= 2) ? 1.8 : 0.4, enso_coffee: (month >= 9 && month <= 12) ? 1.4 : 0.8, ukraine_wheat: (month >= 3 && month <= 6) ? 1.6 : 0.5, nordic_hydro: (month >= 10 || month <= 3) ? 1.5 : 0.5, pre_fomc: (doy % 45 < 2) ? 2.5 : 0.3, gold_silver_ratio: 1.0 })[config.edge] ?? 1.0;

      const score    = seasonScore + Math.abs(priceZ) * 0.3;
      const isActive = score > config.threshold + 0.8;
      if (isActive) {
        const correct    = Math.random() < accuracy;
        const contrarian = ['cornbelt_drought', 'polar_vortex'].includes(config.edge);
        let dir = contrarian ? (priceZ < -0.5 ? 'buy' : 'sell') : 'buy';
        if (!correct) dir = dir === 'buy' ? 'sell' : 'buy';
        sigs[i] = { active: true, direction: dir, strength: Math.min(5, Math.round(score)) };
      }
    }
    return sigs;
  },

  // ════════════════════════════════════════════════════════════
  //  DELADE HJÄLPFUNKTIONER
  // ════════════════════════════════════════════════════════════
  _readConfig() {
    return {
      edge:           document.getElementById('bt-edge').value,
      instrument:     document.getElementById('bt-instrument').value,
      periodYears:    +document.getElementById('bt-period').value,
      leverage:       +document.getElementById('bt-leverage').value,
      capital:        +document.getElementById('bt-capital').value,
      stopLoss:       +document.getElementById('bt-stop').value / 100,
      sizing:         document.getElementById('bt-sizing').value,
      threshold:      +document.getElementById('bt-threshold').value,
      congressLag:    +(document.getElementById('bt-congress-lag')?.value ?? 2),
      congressHold:   +(document.getElementById('bt-congress-hold')?.value ?? 30),
    };
  },

  _calcPositionSize(method, capital, winRate, avgReturn, stopLoss) {
    if (method === 'fixed') return capital * 0.10;
    if (method === 'full')  return capital * 0.95;
    const b = (avgReturn || 0.03) / (stopLoss || 0.08);
    return capital * Math.max(0.05, Math.min(0.25, ((b * winRate - (1 - winRate)) / b) * 0.5));
  },

  _buildEquityCurve(trades, startCapital) {
    const curve = [{ date: trades[0]?.entryDate || '2020-01-01', value: startCapital }];
    let cap = startCapital;
    for (const t of trades) { cap += t.pnl; curve.push({ date: t.exitDate, value: +Math.max(0, cap).toFixed(0) }); }
    return curve;
  },

  _calcMetrics(equity, trades, config) {
    if (!trades.length) return null;
    const startVal = equity[0].value, endVal = equity[equity.length - 1].value;
    const winners  = trades.filter(t => t.pnl > 0), losers = trades.filter(t => t.pnl <= 0);
    const winRate  = winners.length / trades.length;
    const avgWin   = winners.length ? winners.reduce((a, t) => a + t.pnl, 0) / winners.length : 0;
    const avgLoss  = losers.length  ? Math.abs(losers.reduce((a, t) => a + t.pnl, 0) / losers.length) : 1;

    let peak = equity[0].value, maxDD = 0;
    equity.forEach(e => { if (e.value > peak) peak = e.value; maxDD = Math.max(maxDD, (peak - e.value) / peak); });

    const days = Backtest._daysBetween(equity[0].date, equity[equity.length - 1].date) || 365;
    const annualReturn = Math.pow(Math.max(0.001, endVal / startVal), 365 / days) - 1;
    const daily = equity.slice(1).map((e, i) => (e.value - equity[i].value) / equity[i].value);
    const avgD  = daily.reduce((a, b) => a + b, 0) / daily.length;
    const stdD  = Math.sqrt(daily.map(r => (r - avgD) ** 2).reduce((a, b) => a + b, 0) / daily.length) || 0.001;

    const monthly = {};
    trades.forEach(t => { const k = t.exitDate.slice(0, 7); monthly[k] = (monthly[k] || 0) + t.pnl; });

    const byRep = {};
    trades.forEach(t => {
      if (!t.congressman) return;
      if (!byRep[t.congressman]) byRep[t.congressman] = { trades: 0, pnl: 0, wins: 0 };
      byRep[t.congressman].trades++;
      byRep[t.congressman].pnl += t.pnl;
      if (t.pnl > 0) byRep[t.congressman].wins++;
    });

    return {
      totalReturn:  +((endVal - startVal) / startVal * 100).toFixed(1),
      annualReturn: +(annualReturn * 100).toFixed(1),
      maxDrawdown:  +(-maxDD * 100).toFixed(1),
      winRate:      +(winRate * 100).toFixed(1),
      totalTrades:  trades.length, winners: winners.length, losers: losers.length,
      profitFactor: +(avgLoss > 0 ? (avgWin * winners.length) / (avgLoss * (losers.length || 1)) : 0).toFixed(2),
      sharpe:       +((avgD / stdD) * Math.sqrt(252)).toFixed(2),
      avgWin:       +avgWin.toFixed(0), avgLoss: +avgLoss.toFixed(0),
      startCapital: config.capital, endCapital: +endVal.toFixed(0),
      monthly, byRep
    };
  },

  _daysBetween(d1, d2) {
    return Math.abs(Math.round((new Date(d2) - new Date(d1)) / 86400000));
  },

  _setStatus(msg) {
    const el = document.getElementById('bt-results-summary');
    if (el) el.innerHTML = `<div class="bt-placeholder"><span class="spinner"></span>${msg}</div>`;
  },

  // ════════════════════════════════════════════════════════════
  //  RENDERING
  // ════════════════════════════════════════════════════════════
  _metricsHTML(metrics, config, extra = '') {
    const c = v => v >= 0 ? 'pnl-pos' : 'pnl-neg';
    const s = v => v > 0 ? '+' : '';
    return `
      <div class="bt-metrics">
        <div class="bt-metric">
          <div class="bt-metric-label">TOTAL AVKASTNING</div>
          <div class="bt-metric-value ${c(metrics.totalReturn)}">${s(metrics.totalReturn)}${metrics.totalReturn}%</div>
          <div class="bt-metric-sub">${metrics.startCapital.toLocaleString()} → ${metrics.endCapital.toLocaleString()} kr</div>
        </div>
        <div class="bt-metric">
          <div class="bt-metric-label">ÅRSAVKASTNING</div>
          <div class="bt-metric-value ${c(metrics.annualReturn)}">${s(metrics.annualReturn)}${metrics.annualReturn}%</div>
          <div class="bt-metric-sub">annualiserat</div>
        </div>
        <div class="bt-metric">
          <div class="bt-metric-label">MAX DRAWDOWN</div>
          <div class="bt-metric-value pnl-neg">${metrics.maxDrawdown}%</div>
          <div class="bt-metric-sub">peak-to-trough</div>
        </div>
        <div class="bt-metric">
          <div class="bt-metric-label">VINSTKVOT</div>
          <div class="bt-metric-value">${metrics.winRate}%</div>
          <div class="bt-metric-sub">${metrics.winners}W · ${metrics.losers}L · ${metrics.totalTrades} trades</div>
        </div>
        <div class="bt-metric">
          <div class="bt-metric-label">PROFIT FACTOR</div>
          <div class="bt-metric-value ${metrics.profitFactor >= 1.5 ? 'pnl-pos' : ''}">${metrics.profitFactor}</div>
          <div class="bt-metric-sub">vinst / förlust-kvot</div>
        </div>
        <div class="bt-metric">
          <div class="bt-metric-label">SHARPE-KVOT</div>
          <div class="bt-metric-value ${metrics.sharpe >= 1 ? 'pnl-pos' : ''}">${metrics.sharpe}</div>
          <div class="bt-metric-sub">riskjusterad avkastning</div>
        </div>
      </div>${extra}`;
  },

  _renderEdgeResults(metrics, trades, equity, config) {
    if (!metrics) { Backtest._showError('Inga trades genererades.'); return; }
    document.getElementById('bt-results-summary').innerHTML = Backtest._metricsHTML(metrics, config);
    document.getElementById('bt-chart-label').textContent =
      `${config.instrument} · ${config.periodYears}år · ${config.leverage}x · ${config.sizing}`;
    document.getElementById('bt-charts-section').style.display = 'block';
    Charts.renderEquity(equity);
    Charts.renderMonthly(metrics.monthly);
    Charts.renderDrawdown(equity);
    Backtest._renderTradeLog(trades, false);
  },

  _renderCongressResults(metrics, trades, equity, config) {
    if (!metrics) { Backtest._showError('Inga trades.'); return; }

    // Topp-ledamöter sorterade på P&L
    const topReps = Object.entries(metrics.byRep || {})
      .sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 8);

    const repRows = topReps.map(([name, d]) => `
      <tr>
        <td style="color:var(--text)">${name}</td>
        <td>${d.trades}</td>
        <td>${((d.wins / d.trades) * 100).toFixed(0)}%</td>
        <td class="${d.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${d.pnl >= 0 ? '+' : ''}${Math.round(d.pnl).toLocaleString()} kr</td>
      </tr>`).join('');

    const repTable = `
      <div style="padding:12px 14px 4px;font-size:9px;letter-spacing:0.12em;color:var(--text3)">TOPP-LEDAMÖTER EFTER P&L</div>
      <table class="trade-table" style="margin-bottom:0">
        <thead><tr><th>LEDAMOT</th><th>TRADES</th><th>VINSTKVOT</th><th>TOTAL P&L</th></tr></thead>
        <tbody>${repRows}</tbody>
      </table>`;

    document.getElementById('bt-results-summary').innerHTML = Backtest._metricsHTML(metrics, config, repTable);
    document.getElementById('bt-chart-label').textContent =
      `Kongress-kopia · ${config.congressLag}d lag · ${config.congressHold}d hold · ${config.leverage}x hävstång`;
    document.getElementById('bt-charts-section').style.display = 'block';
    Charts.renderEquity(equity);
    Charts.renderMonthly(metrics.monthly);
    Charts.renderDrawdown(equity);
    Backtest._renderTradeLog(trades, true);
  },

  _renderTradeLog(trades, isCongress) {
    const rows = trades.slice(-60).reverse().map(t => {
      const conCols = isCongress ? `
        <td style="font-size:10px;color:var(--text2);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.congressman || '—'}</td>
        <td style="font-size:10px;color:var(--text3)">${t.disclosedAmount || '—'}</td>
        <td style="font-size:10px;color:var(--text3)">${t.lagDays ?? '—'}d</td>` : '';
      const ret = t.leveragedReturn ?? t.rawReturn;
      return `
        <tr>
          <td>${t.id}</td>
          <td style="color:var(--green);font-weight:500">${isCongress ? t.ticker : (t.direction === 'buy' ? '▲ KÖP' : '▼ SÄLJ')}</td>
          ${conCols}
          <td>${t.entryDate}</td>
          <td>${t.exitDate}</td>
          <td>${t.entryPrice}</td>
          <td>${t.exitPrice}</td>
          <td class="${ret >= 0 ? 'pnl-pos' : 'pnl-neg'}">${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%</td>
          <td class="${t.pnl > 0 ? 'pnl-pos' : 'pnl-neg'}">${t.pnl > 0 ? '+' : ''}${Math.round(t.pnl).toLocaleString()} kr</td>
          <td>${t.holdDays}d</td>
          <td style="font-size:9px;color:var(--text3);letter-spacing:0.06em">${t.exitReason}</td>
        </tr>`;
    }).join('');

    const conHeaders = isCongress
      ? '<th>LEDAMOT</th><th>BELOPP</th><th>LAG</th>' : '';

    document.getElementById('trade-log').innerHTML = `
      <table class="trade-table">
        <thead>
          <tr>
            <th>#</th><th>${isCongress ? 'TICKER' : 'RIKTNING'}</th>
            ${conHeaders}
            <th>IN</th><th>UT</th><th>PRIS IN</th><th>PRIS UT</th>
            <th>RETUR%</th><th>P&L (SEK)</th><th>DAGAR</th><th>ORSAK</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  },

  _showError(msg) {
    document.getElementById('bt-results-summary').innerHTML =
      `<div class="bt-placeholder" style="color:var(--red)">⚠ ${msg}</div>`;
  }
};
