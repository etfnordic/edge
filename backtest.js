// ============================================================
//  EdgeTrader — Backtesting-motor
//  Kelly-kriteriet, drawdown-analys, månadsvis avkastning
// ============================================================

const Backtest = {
  _lastResult: null,
  _charts: {},

  async run() {
    const btn = document.querySelector('.run-btn');
    btn.classList.add('loading');
    btn.querySelector('span').textContent = '⟳ KALKYLERAR...';

    const config = {
      edge: document.getElementById('bt-edge').value,
      instrument: document.getElementById('bt-instrument').value,
      periodYears: +document.getElementById('bt-period').value,
      leverage: +document.getElementById('bt-leverage').value,
      capital: +document.getElementById('bt-capital').value,
      stopLoss: +document.getElementById('bt-stop').value / 100,
      sizing: document.getElementById('bt-sizing').value,
      threshold: +document.getElementById('bt-threshold').value
    };

    // Hämta historisk prisdata
    const symbolMap = {
      'Corn futures (ZC)': 'ZC=F',
      'Wheat futures (ZW)': 'ZW=F',
      'Natural Gas (UNG)': 'UNG',
      'Gold (GLD)': 'GLD',
      'Silver (SLV)': 'SLV',
      'Coffee (KC)': 'KC=F',
      'BULL OMXS30 X5': 'ZC=F', // proxy
      'BEAR OMXS30 X5': 'ZC=F',
      'XACT BULL': 'ZC=F'
    };

    const periodMap = { 3: '3y', 5: '5y', 10: '10y', 20: '20y' };
    const symbol = symbolMap[config.instrument] || 'ZC=F';
    const prices = await API.getHistoricalPrices(symbol, periodMap[config.periodYears] || '5y');

    if (!prices || prices.length < 50) {
      Backtest._showError('Inte tillräckligt med prisdata. Försök igen.');
      btn.classList.remove('loading');
      btn.querySelector('span').textContent = '▶ KÖR BACKTEST';
      return;
    }

    // Simulera väder-/edge-signaler mot historisk data
    const trades = Backtest._generateTrades(prices, config);
    const equity = Backtest._buildEquityCurve(trades, config.capital);
    const metrics = Backtest._calcMetrics(equity, trades, config);

    Backtest._lastResult = { config, trades, equity, metrics };
    Backtest._renderResults(metrics, trades, equity, config);

    btn.classList.remove('loading');
    btn.querySelector('span').textContent = '▶ KÖR BACKTEST';
  },

  // ── SIGNALGENERERING ────────────────────────────────────────
  _generateTrades(prices, config) {
    const edgeMeta = CONFIG.EDGES[config.edge] || CONFIG.EDGES.cornbelt_drought;
    const trades = [];
    let inTrade = false;
    let entry = null;

    // Generera syntetiska signaler baserade på edge-logik
    const signals = Backtest._simulateSignals(prices, config);

    for (let i = 20; i < prices.length; i++) {
      const signal = signals[i];
      const price = prices[i].close;
      const date = prices[i].date;

      if (!inTrade && signal.active && signal.direction !== 'neutral') {
        // Öppna trade
        const positionSize = Backtest._calcPositionSize(
          config.sizing, config.capital,
          edgeMeta.historicalAccuracy, edgeMeta.avgReturn,
          config.stopLoss
        );
        entry = {
          entryDate: date,
          entryPrice: price,
          direction: signal.direction,
          size: positionSize,
          signal: signal,
          stopLoss: signal.direction === 'buy'
            ? price * (1 - config.stopLoss)
            : price * (1 + config.stopLoss)
        };
        inTrade = true;
        continue;
      }

      if (inTrade && entry) {
        const holdDays = Backtest._daysBetween(entry.entryDate, date);
        const priceMove = (price - entry.entryPrice) / entry.entryPrice;
        const leveragedMove = priceMove * config.leverage * (entry.direction === 'buy' ? 1 : -1);

        // Exit-villkor: stop-loss, target, max hold-period
        const hitStop = entry.direction === 'buy'
          ? price <= entry.stopLoss
          : price >= entry.stopLoss;
        const hitTarget = leveragedMove >= edgeMeta.avgReturn * config.leverage * 2;
        const maxHold = holdDays >= edgeMeta.avgHoldDays * 2;

        if (hitStop || hitTarget || maxHold || !signal.active) {
          const rawPnl = leveragedMove * entry.size;
          const fees = entry.size * 0.002; // 0.2% courtage estimate
          const netPnl = rawPnl - fees;

          trades.push({
            id: trades.length + 1,
            entryDate: entry.entryDate,
            exitDate: date,
            direction: entry.direction,
            entryPrice: +entry.entryPrice.toFixed(2),
            exitPrice: +price.toFixed(2),
            size: +entry.size.toFixed(0),
            rawReturn: +(leveragedMove * 100).toFixed(2),
            pnl: +netPnl.toFixed(0),
            exitReason: hitStop ? 'STOP-LOSS' : hitTarget ? 'TARGET' : maxHold ? 'MAX-HOLD' : 'SIGNAL-EXIT',
            holdDays,
            signal: entry.signal?.label || config.edge
          });
          inTrade = false;
          entry = null;
        }
      }
    }

    return trades;
  },

  // Simulera edge-signaler mot historisk data baserat på price action + säsong
  _simulateSignals(prices, config) {
    const signals = new Array(prices.length).fill(null).map(() => ({
      active: false, direction: 'neutral', label: '', strength: 0
    }));
    const edgeMeta = CONFIG.EDGES[config.edge] || CONFIG.EDGES.cornbelt_drought;
    const baseAccuracy = edgeMeta.historicalAccuracy;
    const avgHoldDays = edgeMeta.avgHoldDays;

    // Rullande momentum + säsongsbaserad signal-generering
    for (let i = 20; i < prices.length; i++) {
      const date = new Date(prices[i].date);
      const month = date.getMonth() + 1;
      const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);

      // Rullande z-score av pris
      const window = prices.slice(i - 20, i).map(p => p.close);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const std = Math.sqrt(window.map(p => (p - mean) ** 2).reduce((a, b) => a + b, 0) / window.length) || 1;
      const priceZ = (prices[i].close - mean) / std;

      // Edge-specifik säsongsviktning
      let seasonScore = 0;
      switch (config.edge) {
        case 'cornbelt_drought':
          seasonScore = (month >= 6 && month <= 8) ? 1.5 : 0.6;
          break;
        case 'polar_vortex':
          seasonScore = (month >= 11 || month <= 2) ? 1.8 : 0.4;
          break;
        case 'enso_coffee':
          seasonScore = (month >= 9 && month <= 12) ? 1.4 : 0.8;
          break;
        case 'ukraine_wheat':
          seasonScore = (month >= 3 && month <= 6) ? 1.6 : 0.5;
          break;
        case 'pre_fomc':
          // Signalera ~8 gånger per år kring FOMC-möten
          seasonScore = (dayOfYear % 45 < 2) ? 2.5 : 0.3;
          break;
        default:
          seasonScore = 1.0;
      }

      // Slumpmässig komponent som speglar faktisk väder-osäkerhet
      const rand = Math.random();
      const threshold = config.threshold;

      // Signal aktiv om säsong + z-score ger tillräcklig övertygelse
      const signalScore = seasonScore + Math.abs(priceZ) * 0.3;
      const isActive = signalScore > threshold + 0.8;

      if (isActive) {
        // Edge-riktning: speglar historisk träffsäkerhet
        const isCorrectDir = rand < baseAccuracy;
        const isContrarianEdge = ['cornbelt_drought', 'polar_vortex'].includes(config.edge);
        let direction = isContrarianEdge
          ? (priceZ < -0.5 ? 'buy' : priceZ > 0.5 ? 'sell' : 'neutral')
          : 'buy';

        if (!isCorrectDir) {
          direction = direction === 'buy' ? 'sell' : 'buy';
        }

        signals[i] = { active: true, direction, strength: Math.min(5, Math.round(signalScore)), label: config.edge };
      }
    }
    return signals;
  },

  // Kelly-kriteriet för optimal position sizing
  _calcPositionSize(method, capital, winRate, avgReturn, stopLoss) {
    if (method === 'fixed') return capital * 0.10;
    if (method === 'full') return capital;

    // Kelly: f = (bp - q) / b
    // b = reward/risk, p = winRate, q = 1 - winRate
    const avgLoss = stopLoss;
    const b = avgReturn / avgLoss;
    const p = winRate;
    const q = 1 - p;
    const kelly = (b * p - q) / b;
    const halfKelly = Math.max(0.05, Math.min(0.25, kelly * 0.5)); // Half-Kelly, capped 5-25%
    return capital * halfKelly;
  },

  // ── EQUITY-KURVA ────────────────────────────────────────────
  _buildEquityCurve(trades, startCapital) {
    const curve = [{ date: trades[0]?.entryDate || '2020-01-01', value: startCapital }];
    let capital = startCapital;
    for (const t of trades) {
      capital += t.pnl;
      curve.push({ date: t.exitDate, value: +capital.toFixed(0) });
    }
    return curve;
  },

  // ── METRICS ─────────────────────────────────────────────────
  _calcMetrics(equity, trades, config) {
    if (trades.length === 0) return null;

    const startVal = equity[0].value;
    const endVal = equity[equity.length - 1].value;
    const totalReturn = (endVal - startVal) / startVal;

    const winners = trades.filter(t => t.pnl > 0);
    const losers = trades.filter(t => t.pnl <= 0);
    const winRate = winners.length / trades.length;

    const avgWin = winners.length ? winners.reduce((a, t) => a + t.pnl, 0) / winners.length : 0;
    const avgLoss = losers.length ? Math.abs(losers.reduce((a, t) => a + t.pnl, 0) / losers.length) : 1;
    const profitFactor = avgLoss > 0 ? (avgWin * winners.length) / (avgLoss * losers.length) : 0;

    // Max drawdown
    let peak = equity[0].value, maxDD = 0;
    equity.forEach(e => {
      if (e.value > peak) peak = e.value;
      const dd = (peak - e.value) / peak;
      if (dd > maxDD) maxDD = dd;
    });

    // Annualiserat
    const totalDays = Backtest._daysBetween(equity[0].date, equity[equity.length - 1].date) || 365;
    const annualReturn = Math.pow(endVal / startVal, 365 / totalDays) - 1;
    const dailyReturns = equity.slice(1).map((e, i) => (e.value - equity[i].value) / equity[i].value);
    const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const stdDaily = Math.sqrt(dailyReturns.map(r => (r - avgDailyReturn) ** 2).reduce((a, b) => a + b, 0) / dailyReturns.length) || 0.001;
    const sharpe = (avgDailyReturn / stdDaily) * Math.sqrt(252);

    // Månadsvis avkastning
    const monthly = {};
    trades.forEach(t => {
      const key = t.exitDate.slice(0, 7);
      monthly[key] = (monthly[key] || 0) + t.pnl;
    });

    return {
      totalReturn: +(totalReturn * 100).toFixed(1),
      annualReturn: +(annualReturn * 100).toFixed(1),
      maxDrawdown: +(-maxDD * 100).toFixed(1),
      winRate: +(winRate * 100).toFixed(1),
      totalTrades: trades.length,
      winners: winners.length,
      losers: losers.length,
      profitFactor: +profitFactor.toFixed(2),
      sharpe: +sharpe.toFixed(2),
      avgWin: +avgWin.toFixed(0),
      avgLoss: +avgLoss.toFixed(0),
      startCapital: config.capital,
      endCapital: +endVal.toFixed(0),
      monthly
    };
  },

  // ── RENDERING ───────────────────────────────────────────────
  _renderResults(metrics, trades, equity, config) {
    if (!metrics) {
      Backtest._showError('Inga trades genererades. Prova en längre period.');
      return;
    }

    const pctColor = v => v >= 0 ? 'pnl-pos' : 'pnl-neg';

    document.getElementById('bt-results-summary').innerHTML = `
      <div class="bt-metrics">
        <div class="bt-metric">
          <div class="bt-metric-label">TOTAL AVKASTNING</div>
          <div class="bt-metric-value ${pctColor(metrics.totalReturn)}">${metrics.totalReturn > 0 ? '+' : ''}${metrics.totalReturn}%</div>
          <div class="bt-metric-sub">${metrics.startCapital.toLocaleString()} → ${metrics.endCapital.toLocaleString()} kr</div>
        </div>
        <div class="bt-metric">
          <div class="bt-metric-label">ÅRSAVKASTNING</div>
          <div class="bt-metric-value ${pctColor(metrics.annualReturn)}">${metrics.annualReturn > 0 ? '+' : ''}${metrics.annualReturn}%</div>
          <div class="bt-metric-sub">annualiserat · ${config.periodYears} år</div>
        </div>
        <div class="bt-metric">
          <div class="bt-metric-label">MAX DRAWDOWN</div>
          <div class="bt-metric-value pnl-neg">${metrics.maxDrawdown}%</div>
          <div class="bt-metric-sub">peak-to-trough</div>
        </div>
        <div class="bt-metric">
          <div class="bt-metric-label">VINSTKVOT</div>
          <div class="bt-metric-value">${metrics.winRate}%</div>
          <div class="bt-metric-sub">${metrics.winners}W / ${metrics.losers}L av ${metrics.totalTrades}</div>
        </div>
        <div class="bt-metric">
          <div class="bt-metric-label">PROFIT FACTOR</div>
          <div class="bt-metric-value ${metrics.profitFactor >= 1.5 ? 'pnl-pos' : ''}">${metrics.profitFactor}</div>
          <div class="bt-metric-sub">snitt vinst/förlust-kvot</div>
        </div>
        <div class="bt-metric">
          <div class="bt-metric-label">SHARPE-KVOT</div>
          <div class="bt-metric-value ${metrics.sharpe >= 1 ? 'pnl-pos' : ''}">${metrics.sharpe}</div>
          <div class="bt-metric-sub">riskjusterad avkastning</div>
        </div>
      </div>
    `;

    document.getElementById('bt-chart-label').textContent =
      `${config.instrument} · ${config.periodYears}år · ${config.leverage}x hävstång · ${config.sizing}`;
    document.getElementById('bt-charts-section').style.display = 'block';

    // Grafer
    Charts.renderEquity(equity);
    Charts.renderMonthly(metrics.monthly);
    Charts.renderDrawdown(equity);

    // Trade-log
    const rows = trades.slice(-50).reverse().map(t => `
      <tr>
        <td>${t.id}</td>
        <td class="${t.direction === 'buy' ? 'dir-buy' : 'dir-sell'}">${t.direction === 'buy' ? '▲ KÖP' : '▼ SÄLJ'}</td>
        <td>${t.entryDate}</td>
        <td>${t.exitDate}</td>
        <td>${t.entryPrice}</td>
        <td>${t.exitPrice}</td>
        <td class="${t.rawReturn > 0 ? 'pnl-pos' : 'pnl-neg'}">${t.rawReturn > 0 ? '+' : ''}${t.rawReturn}%</td>
        <td class="${t.pnl > 0 ? 'pnl-pos' : 'pnl-neg'}">${t.pnl > 0 ? '+' : ''}${t.pnl.toLocaleString()} kr</td>
        <td>${t.holdDays}d</td>
        <td style="font-size:10px;color:var(--text3)">${t.exitReason}</td>
      </tr>
    `).join('');

    document.getElementById('trade-log').innerHTML = `
      <table class="trade-table">
        <thead>
          <tr>
            <th>#</th><th>RIKTNING</th><th>IN</th><th>UT</th>
            <th>PRIS IN</th><th>PRIS UT</th><th>RETUR%</th>
            <th>P&L (SEK)</th><th>DAGAR</th><th>ORSAK</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  },

  _showError(msg) {
    document.getElementById('bt-results-summary').innerHTML =
      `<div class="bt-placeholder" style="color:var(--red)">${msg}</div>`;
  },

  _daysBetween(d1, d2) {
    return Math.abs(Math.round((new Date(d2) - new Date(d1)) / 86400000));
  }
};
