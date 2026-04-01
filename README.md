# EdgeTrader — Väderdriven råvaruhandelsplattform

> Hitta statistiska edges i råvarumarknaden via väderdata, ENSO-index och marknadsmönster. Backtesta och handla via Avanza.

## Funktioner

- **Live väderdata** via Open-Meteo (gratis, ingen API-nyckel)
- **8 edge-strategier** inkl. Polar Vortex, Corn Belt-torka, ENSO, guld/silver-ratio
- **Backtesting-motor** med Kelly-kriteriet, drawdown-analys och trade-log
- **Portföljhantering** med P&L-tracking
- **Korrelationsmatris** väder → råvara med historisk r²

## Snabbstart

```bash
git clone https://github.com/DITT-ANVÄNDARNAMN/edge-trader.git
cd edge-trader
# Öppna index.html i webbläsaren — inga beroenden att installera!
open index.html
```

## GitHub Pages

1. Gå till Settings → Pages → Source: Deploy from branch → main
2. Sidan är nu live på `https://DITT-ANVÄNDARNAMN.github.io/edge-trader`

## API-nycklar (valfritt — fungerar med demo-data utan nycklar)

Kopiera `config.example.js` till `js/config.js` och lägg till:

| API | Registrering | Pris |
|-----|-------------|------|
| Alpha Vantage | alphavantage.co | Gratis |
| Finnhub | finnhub.io | Gratis |
| Open-Meteo | open-meteo.com | Helt gratis, ingen nyckel |

**OBS:** `js/config.js` med riktiga nycklar ska ALDRIG committas. Se `.gitignore`.

## Edge-strategier

| Edge | Råvara | Historisk träff | Lead-time |
|------|--------|----------------|-----------|
| Corn Belt torka | Majs (ZC) | 71% | 2–10 dagar |
| Polar Vortex | Natural Gas | 74% | 1–5 dagar |
| ENSO La Niña | Kaffe (KC) | 67% | 4–8 veckor |
| Ukraina torka | Vete (ZW) | 69% | 1–3 veckor |
| Nordisk hydro | El-pris | 72% | 1–4 veckor |
| Guld/silver-ratio | Silver (SLV) | 73% | 2–4 veckor |
| Pre-FOMC drift | S&P500/OMXS30 | 76% | 2 dagar |
| Kongress-köp | US-aktier | 68% | 1–3 dagar |

## Ansvarsfriskrivning

Detta är ett utbildningsverktyg. Ingen investeringsrådgivning. Handla med eget ansvar och kapital du har råd att förlora.
