# AGT-STATARB-001

Statistical arbitrage / mean reversion agent package for Potato Chips AI.

This package is designed to work in two modes:

- Local cycle mode: fetches daily history from the configured provider chain
  (`alpaca`, `alpha_vantage`, then optional `yfinance` fallback), scans the configured
  universe for cointegrated pairs, writes state to SQLite, and emits a CIO
  dashboard payload for the cycle.
- HR sandbox mode: reads a JSON scenario from stdin and emits a compatible JSON
  trading signal to stdout. When the sandbox only provides a single symbol bar
  stream, the package degrades honestly into a single-symbol mean-reversion
  fallback instead of pretending it had full pair context.

## Interface

The core agent class lives at `statarb_agent.agent.StatisticalArbitrageAgent`
and exposes:

- `generate_signals()`
- `size_positions()`
- `execute_trades()`
- `report_status()`
- `run_cycle()`

## Local usage

```bash
cd /Users/grantcho/Documents_Local/GPTCapital/agents/agt_statarb_001
python3 -m pip install -e .[dev]
python3 main.py
```

To run tests:

```bash
python3 -m pytest
```

## Config

The default config is in `config/default.yaml` and controls:

- universe
- lookback windows
- entry / exit / stop thresholds
- pair count limits
- NAV assumptions
- SQLite path
