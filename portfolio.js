// ============================================================
//  EdgeTrader — Portföljhantering
// ============================================================

const Portfolio = {
  _positions: [],

  init() {
    try {
      const saved = localStorage.getItem('et_positions');
      if (saved) Portfolio._positions = JSON.parse(saved);
    } catch (e) { Portfolio._positions = []; }
    Portfolio.render();
  },

  _save() {
    try { localStorage.setItem('et_positions', JSON.stringify(Portfolio._positions)); } catch (e) {}
  },

  addPosition() {
    const instrument = document.getElementById('pos-instrument').value.trim();
    const price = +document.getElementById('pos-price').value;
    const qty = +document.getElementById('pos-qty').value;
    const edge = document.getElementById('pos-edge').value;

    if (!instrument || !price || !qty) {
      alert('Fyll i alla fält.'); return;
    }

    Portfolio._positions.push({
      id: Date.now(),
      instrument,
      entryPrice: price,
      qty,
      edge,
      entryDate: new Date().toISOString().split('T')[0],
      currentPrice: price * (1 + (Math.random() - 0.48) * 0.05),
      value: price * qty
    });

    Portfolio._save();
    Portfolio.render();
    ['pos-instrument', 'pos-price', 'pos-qty'].forEach(id => document.getElementById(id).value = '');
  },

  closePosition(id) {
    Portfolio._positions = Portfolio._positions.filter(p => p.id !== id);
    Portfolio._save();
    Portfolio.render();
  },

  async render() {
    // Uppdatera priser
    for (const pos of Portfolio._positions) {
      pos.currentPrice = pos.entryPrice * (1 + (Math.random() - 0.48) * 0.03);
      pos.value = pos.currentPrice * pos.qty;
    }

    const totalValue = Portfolio._positions.reduce((a, p) => a + p.value, 0) || 100000;
    const totalCost = Portfolio._positions.reduce((a, p) => a + p.entryPrice * p.qty, 0) || 100000;
    const totalPnl = totalValue - totalCost;
    const pnlPct = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0;

    document.getElementById('port-value').textContent = Math.round(totalValue).toLocaleString('sv-SE') + ' kr';
    const dailyEl = document.getElementById('port-daily');
    const dailyPnl = totalPnl;
    dailyEl.textContent = (dailyPnl >= 0 ? '+' : '') + Math.round(dailyPnl).toLocaleString('sv-SE') + ' kr';
    dailyEl.className = 'metric-value ' + (dailyPnl >= 0 ? 'pnl-pos' : 'pnl-neg');

    const ytdEl = document.getElementById('port-ytd');
    ytdEl.textContent = (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%';
    ytdEl.className = 'metric-value ' + (pnlPct >= 0 ? 'pnl-pos' : 'pnl-neg');

    // Positions-tabell
    const rows = Portfolio._positions.map(p => {
      const pnl = (p.currentPrice - p.entryPrice) * p.qty;
      const pnlPct = ((p.currentPrice - p.entryPrice) / p.entryPrice * 100);
      return `
        <tr>
          <td>${p.instrument}</td>
          <td style="font-size:10px;color:var(--text3)">${p.edge}</td>
          <td>${p.entryDate}</td>
          <td>${p.entryPrice.toFixed(2)}</td>
          <td>${p.currentPrice.toFixed(2)}</td>
          <td>${p.qty}</td>
          <td class="${pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()} kr</td>
          <td class="${pnlPct >= 0 ? 'pnl-pos' : 'pnl-neg'}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</td>
          <td><button class="close-btn" onclick="Portfolio.closePosition(${p.id})">STÄNG</button></td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--text3)">Inga öppna positioner. Lägg till nedan.</td></tr>`;

    document.getElementById('positions-table').innerHTML = `
      <table class="pos-table">
        <thead>
          <tr>
            <th>INSTRUMENT</th><th>EDGE</th><th>ÖPPNAD</th>
            <th>KÖPKURS</th><th>NUV. KURS</th><th>ANTAL</th>
            <th>P&L (SEK)</th><th>P&L%</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    Charts.renderRisk(Portfolio._positions.length ? Portfolio._positions : [
      { instrument: 'Cash', value: 100000 }
    ]);
  }
};
