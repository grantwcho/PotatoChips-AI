# AGT-VOL-001

Volatility-trading / crisis-hedging agent package for Potato Chips AI.

This package supports two operating modes:

- Local cycle mode: downloads daily VIX, VIX3M, SVXY, UVXY, and SPY history
  from the configured provider chain (`alpaca`, `alpha_vantage`, then optional
  `yfinance` fallback), classifies the term-structure regime, sizes positions,
  persists state in SQLite, and emits a CIO dashboard payload.
- HR sandbox mode: reads a scenario JSON payload from stdin and emits a single
  JSON volatility signal to stdout using the provided bar history.

## Core interface

`vol_agent.agent.VolatilityTraderAgent` exposes:

- `generate_signals()`
- `size_positions()`
- `execute_trades()`
- `report_status()`
- `run_cycle()`

## Local usage

```bash
cd /Users/grantcho/Documents_Local/GPTCapital/agents/agt_vol_001
python3 -m pip install .[dev]
python3 main.py
python3 backtest.py
```

## Config

The default config is in `config/default.yaml` and controls:

- VIX term-structure thresholds
- mean-reversion and tail-hedge overlays
- position and Greeks caps
- delta hedge sizing
- SQLite path
- backtest forward-accuracy window
