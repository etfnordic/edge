// ============================================================
//  EdgeTrader — Huvudkontroller
// ============================================================

const App = {
  _currentTab: 'dashboard',
  _currentRegion: 'cornbelt',
  _refreshTimer: null,
  _weatherChart: null,

  async init() {
    await App._bootSequence();
    await App.refreshAll();
    App._startClock();
    App._startAutoRefresh();
    Portfolio.init();
  },

  // ── BOOT-SEKVENS ────────────────────────────────────────────
  async _bootSequence() {
    const lines = [
      '> EDGE TRADER v1.0 initialiserar...',
      '> Laddar väderdata [Open-Meteo ECMWF]',
      '> Ansluter till Alpha Vantage API',
      '> Kalibrerar edge-detektionsmotorn',
      '> Läser ENSO-index [NOAA]',
      '> Förbereder backtesting-motor',
      '> Alla system redo.',
      '',
      '> VARNING: Ej investeringsrådgivning.',
      '> Handla med eget ansvar.',
      '',
      '> Startar gränssnitt...'
    ];

    const el = document.getElementById('boot-text');
    for (const line of lines) {
      await new Promise(r => setTimeout(r, 120));
      el.textContent += line + '\n';
    }
    await new Promise(r => setTimeout(r, 400));

    const boot = document.getElementById('boot-screen');
    boot.style.opacity = '0';
    await new Promise(r => setTimeout(r, 400));
    boot.style.display = 'none';
    document.getElementById('app').style.display = 'block';
  },

  // ── KLOCK ────────────────────────────────────────────────────
  _startClock() {
    const update = () => {
      const now = new Date();
      document.getElementById('clock').textContent =
        now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        ' · ' + now.toLocaleDateString('sv-SE');
      App._updateMarketStatus(now);
    };
    update();
    setInterval(update, 1000);
  },

  _updateMarketStatus(now) {
    const h = now.getUTCHours();
    const isOpen = h >= 8 && h < 18 && now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
    const dot = document.querySelector('.status-dot');
    const label = document.getElementById('market-label');
    dot.className = 'status-dot' + (isOpen ? '' : ' closed');
    label.textContent = isOpen ? 'MARKNADEN ÖPPEN' : 'MARKNADEN STÄNGD';
  },

  _startAutoRefresh() {
    App._refreshTimer = setInterval(() => App.refreshAll(), CONFIG.REFRESH_INTERVAL);
  },

  // ── MAIN DATA REFRESH ────────────────────────────────────────
  async refreshAll() {
    document.getElementById('kpi-updated').textContent = 'UPPDATERAR...';

    try {
      // Kör alla edge-beräkningar parallellt
      const signals = await Edges.computeAll();
      const stats = Edges.getSummaryStats();

      // Uppdatera KPI-kort
      document.getElementById('kpi-accuracy').textContent = (stats.avgAccuracy * 100).toFixed(0) + '%';
      document.getElementById('kpi-signals').textContent =
        `${stats.activeSignals} AKTIVA`;
      document.getElementById('active-signals').textContent = stats.activeSignals;
      document.getElementById('kpi-anomalies').textContent = stats.weatherAnomalies;
      document.getElementById('kpi-updated').textContent =
        new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

      // Rendera alla sektioner
      App._renderTopSignals(signals);
      App._renderWeatherAnomalies(signals);
      App._renderCorrelationMatrix();
      App._renderAllSignals(signals);

      // Uppdatera väderflik om aktiv
      if (App._currentTab === 'weather') {
        await App._loadWeatherRegion(App._currentRegion);
      }

    } catch (e) {
      console.error('Refresh error:', e);
      document.getElementById('kpi-updated').textContent = 'FEL — försök igen';
    }
  },

  // ── DASHBOARD RENDERING ──────────────────────────────────────
  _renderTopSignals(signals) {
    const active = signals
      .filter(s => s.isActive)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6);

    document.getElementById('top-signals-list').innerHTML = active.length
      ? active.map(s => App._signalRow(s)).join('')
      : '<div class="loading-row" style="color:var(--text3)">Inga aktiva signaler just nu.</div>';
  },

  _signalRow(s) {
    const dots = Array.from({ length: 5 }, (_, i) =>
      `<div class="sdot ${i < s.strength ? (s.direction === 'buy' ? 'on' : 'danger') : ''}"></div>`
    ).join('');
    const badge = s.direction === 'buy' ? 'buy' : s.direction === 'sell' ? 'sell' : 'neutral';
    const badgeText = s.direction === 'buy' ? 'KÖP' : s.direction === 'sell' ? 'SÄLJ' : 'NEUTRAL';
    const catColors = { weather: '#0ea5e9', macro: '#a78bfa', calendar: '#f0a500', alternative: '#34d399' };
    const catColor = catColors[s.category] || '#6a8090';

    return `
      <div class="signal-row">
        <div>
          <div class="signal-name">${s.name}</div>
          <div class="signal-meta" style="color:${catColor}">[${s.category.toUpperCase()}]</div>
          <div class="signal-meta">${s.rationale.substring(0, 80)}${s.rationale.length > 80 ? '…' : ''}</div>
        </div>
        <div class="signal-right">
          <div class="signal-strength">${dots}</div>
          <div class="sig-score">${(s.confidence * 100).toFixed(0)}%</div>
          <div class="sig-badge ${badge}">${badgeText}</div>
        </div>
      </div>
    `;
  },

  _renderWeatherAnomalies(signals) {
    const weatherSigs = signals.filter(s => s.category === 'weather' && s.zScore !== undefined);
    const icons = { cornbelt_drought: '🌽', polar_vortex: '❄', ukraine_wheat: '🌾', nordic_hydro: '💧' };

    document.getElementById('weather-anomalies-list').innerHTML = weatherSigs.map(s => {
      const z = s.zScore || 0;
      const zClass = Math.abs(z) > 2 ? 'z-extreme' : Math.abs(z) > 1.5 ? 'z-high' : 'z-normal';
      return `
        <div class="anomaly-row">
          <div class="anomaly-icon">${icons[s.id] || '🌡'}</div>
          <div>
            <div class="anomaly-title">${s.name}</div>
            <div class="anomaly-detail">${s.instrument}</div>
          </div>
          <div class="anomaly-zscore ${zClass}">z=${z > 0 ? '+' : ''}${z}</div>
        </div>
      `;
    }).join('') || '<div class="loading-row" style="color:var(--text3)">Laddar väderdata...</div>';
  },

  _renderCorrelationMatrix() {
    const corrs = Edges.getCorrelationMatrix();
    const rows = corrs.map(c => {
      const r2 = c.r2;
      const color = r2 > 0.65 ? '#00c878' : r2 > 0.5 ? '#f0a500' : '#6a8090';
      const bg = r2 > 0.65 ? 'rgba(0,200,120,0.12)' : r2 > 0.5 ? 'rgba(240,165,0,0.1)' : 'transparent';
      const dir = c.direction === 'Positiv' ? '↑' : '↓';
      return `
        <tr>
          <td>${c.weather}</td>
          <td style="color:#c8d8e8">${c.commodity}</td>
          <td><span class="corr-val" style="color:${color};background:${bg}">${dir} ${c.r2}</span></td>
          <td style="color:var(--text3)">${c.lag}</td>
        </tr>
      `;
    }).join('');

    document.getElementById('correlation-matrix').innerHTML = `
      <div class="corr-matrix">
        <table class="corr-table">
          <thead><tr><th>VÄDER-FAKTOR</th><th>RÅVARA</th><th>R² KORRELATION</th><th>SIGNAL-LAG</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },

  // ── SIGNALS TAB ──────────────────────────────────────────────
  _renderAllSignals(signals, filter = 'all') {
    let filtered = signals;
    if (filter === 'buy') filtered = signals.filter(s => s.direction === 'buy');
    else if (filter === 'sell') filtered = signals.filter(s => s.direction === 'sell');
    else if (filter === 'weather') filtered = signals.filter(s => s.category === 'weather');
    else if (filter === 'seasonal') filtered = signals.filter(s => s.category === 'calendar');

    document.getElementById('all-signals-list').innerHTML = filtered.map(s => {
      const accPct = (s.historicalAccuracy * 100).toFixed(0);
      const expRet = (s.expectedReturn * 100).toFixed(1);
      return `
        ${App._signalRow(s)}
        <div style="padding:6px 14px 10px;font-size:10px;color:var(--text3);border-bottom:1px solid var(--border);display:flex;gap:24px">
          <span>TRÄFF: <span style="color:var(--green)">${accPct}%</span></span>
          <span>FÖRV. RETUR: <span style="color:var(--amber)">+${expRet}%</span></span>
          <span>HOLD: ${s.holdDays}d</span>
          <span>INSTRUMENT: <span style="color:#c8d8e8">${s.instrument}</span></span>
        </div>
      `;
    }).join('') || '<div class="loading-row" style="color:var(--text3)">Inga signaler med detta filter.</div>';
  },

  filterSignals(type) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    App._renderAllSignals(Edges.getAll(), type);
  },

  // ── WEATHER TAB ──────────────────────────────────────────────
  async selectRegion(regionKey) {
    document.querySelectorAll('.region-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    App._currentRegion = regionKey;
    await App._loadWeatherRegion(regionKey);
  },

  async _loadWeatherRegion(regionKey) {
    const region = CONFIG.REGIONS[regionKey];
    if (!region) return;

    const coord = region.coords[0];
    document.getElementById('weather-coords').textContent =
      `${coord.name} · ${coord.lat}°N ${Math.abs(coord.lon)}°${coord.lon < 0 ? 'W' : 'E'}`;

    // Live väderdata
    const current = await API.getCurrentWeather(coord.lat, coord.lon);
    const z = await API.getWeatherZScore(coord.lat, coord.lon);
    const forecast = await API.getWeatherForecast(coord.lat, coord.lon, 14);

    const wCode = { 0: 'Klart', 1: 'Mestadels klart', 2: 'Delvis molnigt', 3: 'Mulet', 51: 'Duggregn', 61: 'Regn', 71: 'Snö', 95: 'Åska' };
    const condition = wCode[current?.weather_code] || 'Okänt';

    document.getElementById('weather-detail').innerHTML = `
      <div class="weather-grid">
        <div class="weather-cell">
          <div class="weather-cell-label">RÅVAROR</div>
          <div style="font-size:12px;color:var(--text);line-height:1.8">${region.commodities.join('<br>')}</div>
        </div>
        <div class="weather-cell">
          <div class="weather-cell-label">BESKRIVNING</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.6">${region.description}</div>
        </div>
        <div class="weather-cell">
          <div class="weather-cell-label">VÄDER-ANOMALI (Z-SCORE)</div>
          <div class="weather-cell-value" style="color:${Math.abs(z?.zScore||0) > 1.5 ? 'var(--amber)' : 'var(--text)'}">
            ${z ? (z.zScore > 0 ? '+' : '') + z.zScore : '—'}
          </div>
          <div class="weather-cell-delta" style="color:var(--text3)">
            ${z ? `${z.recentAvg}°C vs norm ${z.climateMean}°C` : ''}
          </div>
        </div>
        <div class="weather-cell">
          <div class="weather-cell-label">INSTRUMENT (AVANZA)</div>
          <div style="font-size:11px;color:var(--green);line-height:1.8">${region.instruments.join('<br>')}</div>
        </div>
      </div>
    `;

    document.getElementById('weather-live-data').innerHTML = `
      <div class="weather-grid">
        <div class="weather-cell">
          <div class="weather-cell-label">TEMPERATUR</div>
          <div class="weather-cell-value">${current?.temperature_2m ?? '—'}<span class="weather-cell-unit"> °C</span></div>
        </div>
        <div class="weather-cell">
          <div class="weather-cell-label">NEDERBÖRD</div>
          <div class="weather-cell-value">${current?.precipitation ?? '—'}<span class="weather-cell-unit"> mm</span></div>
        </div>
        <div class="weather-cell">
          <div class="weather-cell-label">VIND</div>
          <div class="weather-cell-value">${current?.wind_speed_10m ?? '—'}<span class="weather-cell-unit"> m/s</span></div>
        </div>
        <div class="weather-cell">
          <div class="weather-cell-label">LUFTFUKTIGHET</div>
          <div class="weather-cell-value">${current?.relative_humidity_2m ?? '—'}<span class="weather-cell-unit"> %</span></div>
        </div>
        <div class="weather-cell" style="grid-column:1/-1">
          <div class="weather-cell-label">VÄDERFÖRHÅLLANDEN</div>
          <div style="font-size:14px;color:var(--text2)">${condition}</div>
        </div>
      </div>
    `;

    // ENSO-panel
    App._renderENSOPanel();

    // Rita väderprognosgraf
    Charts.renderWeatherForecast(forecast, region.name);
  },

  _renderENSOPanel() {
    const phases = [
      { label: 'ENSO-FASE', value: 'La Niña', note: 'Simulerad signal', color: 'var(--blue)' },
      { label: 'ONI INDEX', value: '-0.7', note: 'Oceanic Niño Index', color: 'var(--amber)' },
      { label: 'PÅVERKAN KAFFE', value: '+BULLISH', note: 'Torka Brasilien', color: 'var(--green)' },
      { label: 'PÅVERKAN SOCKER', value: '+BULLISH', note: 'Svag monsun', color: 'var(--green)' }
    ];
    document.getElementById('enso-panel').innerHTML = `
      <div class="enso-grid">
        ${phases.map(p => `
          <div class="enso-cell">
            <div class="enso-label">${p.label}</div>
            <div class="enso-value" style="color:${p.color}">${p.value}</div>
            <div class="enso-impact">${p.note}</div>
          </div>
        `).join('')}
      </div>
      <div style="padding:10px 14px;font-size:10px;color:var(--text3)">
        Källa: NOAA Climate Prediction Center · ONI uppdateras månadsvis · 
        <a href="https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php" 
           target="_blank" style="color:var(--green)">NOAA CPC →</a>
      </div>
    `;
  },

  // ── TAB-HANTERING ────────────────────────────────────────────
  switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    App._currentTab = tab;

    if (tab === 'weather' && App._currentRegion) {
      App._loadWeatherRegion(App._currentRegion);
    }
  }
};

// ── STARTPUNKT ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
