# AGT-TREND-001

Systematic trend-following / crisis-alpha agent package for Potato Chips AI.

This package supports two operating modes:

- Local cycle mode: downloads daily ETF history from the configured provider chain
  (`alpaca`, `alpha_vantage`, then optional `yfinance` fallback), evaluates
  momentum and breakout signals, stores state in SQLite, and emits a CIO
  dashboard payload.
- HR sandbox mode: reads a scenario JSON payload from stdin and emits a single
  JSON trend signal to stdout using the provided bar history.

## Core interface

`trend_agent.agent.TrendFollowingAgent` exposes:

- `generate_signals()`
- `size_positions()`
- `execute_trades()`
- `report_status()`
- `run_cycle()`

## Local usage

```bash
cd /Users/grantcho/Documents_Local/GPTCapital/agents/agt_trend_001
python3 -m pip install .[dev]
python3 main.py
python3 backtest.py
```

## Config

The default config is in `config/default.yaml` and controls:

- asset universe
- moving-average / breakout lookbacks
- volatility targets
- max drawdown breaker
- trailing stop multiple
- SQLite path
