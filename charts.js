// ============================================================
//  EdgeTrader — Charts
// ============================================================

const Charts = {
  _instances: {},

  _destroy(id) {
    if (Charts._instances[id]) {
      Charts._instances[id].destroy();
      delete Charts._instances[id];
    }
  },

  _green: '#00c878', _red: '#ff4757', _amber: '#f0a500',
  _text2: '#6a8090', _border: 'rgba(0,200,120,0.12)',
  _bg: 'rgba(0,200,120,0.07)',

  _baseOpts() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#111820',
        borderColor: 'rgba(0,200,120,0.3)', borderWidth: 1,
        titleColor: '#c8d8e8', bodyColor: '#6a8090',
        titleFont: { family: 'IBM Plex Mono', size: 11 },
        bodyFont: { family: 'IBM Plex Mono', size: 11 }
      }},
      scales: {
        x: {
          grid: { color: 'rgba(0,200,120,0.06)' },
          ticks: { color: '#3d5060', font: { family: 'IBM Plex Mono', size: 10 }, maxTicksLimit: 8 }
        },
        y: {
          grid: { color: 'rgba(0,200,120,0.06)' },
          ticks: { color: '#3d5060', font: { family: 'IBM Plex Mono', size: 10 } }
        }
      }
    };
  },

  renderEquity(equity) {
    Charts._destroy('equity');
    const ctx = document.getElementById('equity-chart').getContext('2d');
    const labels = equity.map(e => e.date);
    const values = equity.map(e => e.value);
    const startVal = values[0];
    const endVal = values[values.length - 1];
    const lineColor = endVal >= startVal ? Charts._green : Charts._red;

    const opts = Charts._baseOpts();
    opts.scales.y.ticks.callback = v => v.toLocaleString('sv-SE') + ' kr';
    opts.plugins.tooltip.callbacks = {
      label: ctx => `${ctx.parsed.y.toLocaleString('sv-SE')} kr`
    };

    Charts._instances['equity'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: lineColor, borderWidth: 1.5, pointRadius: 0,
          tension: 0.3,
          fill: { target: 'origin', above: lineColor + '15', below: Charts._red + '15' }
        }]
      },
      options: opts
    });
  },

  renderMonthly(monthly) {
    Charts._destroy('monthly');
    const ctx = document.getElementById('monthly-chart').getContext('2d');
    const sorted = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).slice(-24);
    const labels = sorted.map(([k]) => k);
    const values = sorted.map(([, v]) => +v.toFixed(0));
    const colors = values.map(v => v >= 0 ? Charts._green + 'cc' : Charts._red + 'cc');
    const borders = values.map(v => v >= 0 ? Charts._green : Charts._red);

    const opts = Charts._baseOpts();
    opts.scales.y.ticks.callback = v => v.toLocaleString() + ' kr';
    Charts._instances['monthly'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderColor: borders, borderWidth: 1 }]
      },
      options: opts
    });
  },

  renderDrawdown(equity) {
    Charts._destroy('drawdown');
    const ctx = document.getElementById('drawdown-chart').getContext('2d');
    let peak = equity[0].value;
    const dd = equity.map(e => {
      if (e.value > peak) peak = e.value;
      return +(-((peak - e.value) / peak) * 100).toFixed(2);
    });

    const opts = Charts._baseOpts();
    opts.scales.y.ticks.callback = v => v + '%';
    opts.scales.y.max = 0;
    Charts._instances['drawdown'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: equity.map(e => e.date),
        datasets: [{
          data: dd,
          borderColor: Charts._red, borderWidth: 1, pointRadius: 0,
          tension: 0.3,
          fill: { target: 'origin', below: Charts._red + '20' }
        }]
      },
      options: opts
    });
  },

  renderWeatherForecast(forecast, regionName) {
    Charts._destroy('weather');
    const ctx = document.getElementById('weather-forecast-chart').getContext('2d');
    if (!forecast || !forecast.time) return;

    const labels = forecast.time.slice(0, 14);
    const temps = forecast.temperature_2m_max?.slice(0, 14) || [];
    const precips = forecast.precipitation_sum?.slice(0, 14) || [];

    // Beräkna klimatnormal (approximation)
    const tempMean = temps.reduce((a, b) => a + b, 0) / temps.length;
    const normalLine = new Array(14).fill(+tempMean.toFixed(1));

    const opts = Charts._baseOpts();
    opts.plugins.legend = {
      display: true,
      labels: { color: Charts._text2, font: { family: 'IBM Plex Mono', size: 10 }, boxWidth: 12, padding: 12 }
    };
    opts.scales.y1 = {
      type: 'linear', position: 'right',
      grid: { drawOnChartArea: false },
      ticks: { color: '#3d5060', font: { family: 'IBM Plex Mono', size: 10 }, callback: v => v + 'mm' }
    };

    Charts._instances['weather'] = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          {
            type: 'line', label: 'Max temp (°C)',
            data: temps, borderColor: Charts._amber, borderWidth: 2,
            pointRadius: 3, pointBackgroundColor: Charts._amber, tension: 0.4,
            fill: false
          },
          {
            type: 'line', label: 'Klimatnormal (°C)',
            data: normalLine, borderColor: Charts._text2, borderWidth: 1,
            borderDash: [4, 4], pointRadius: 0, fill: false
          },
          {
            type: 'bar', label: 'Nederbörd (mm)',
            data: precips, backgroundColor: Charts._blue + '80',
            borderColor: Charts._blue, borderWidth: 1,
            yAxisID: 'y1'
          }
        ]
      },
      options: opts
    });
  },

  renderRisk(positions) {
    Charts._destroy('risk');
    const ctx = document.getElementById('risk-chart')?.getContext('2d');
    if (!ctx || !positions.length) return;

    const labels = positions.map(p => p.instrument);
    const values = positions.map(p => Math.abs(p.value));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const pcts = values.map(v => +((v / total) * 100).toFixed(1));

    const colors = [Charts._green, Charts._amber, Charts._red, Charts._blue, '#c084fc', '#38bdf8'];

    Charts._instances['risk'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: pcts,
          backgroundColor: colors.slice(0, positions.length).map(c => c + 'cc'),
          borderColor: colors.slice(0, positions.length),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: Charts._text2, font: { family: 'IBM Plex Mono', size: 10 }, boxWidth: 10, padding: 10 }
          },
          tooltip: {
            backgroundColor: '#111820',
            borderColor: 'rgba(0,200,120,0.3)', borderWidth: 1,
            bodyColor: '#c8d8e8',
            bodyFont: { family: 'IBM Plex Mono', size: 11 },
            callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed}%` }
          }
        }
      }
    });
  }
};

// Färgkonstant för blue (saknas i scope above)
Charts._blue = '#3b82f6';
