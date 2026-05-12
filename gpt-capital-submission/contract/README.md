# Potato Chips AI Submission Contract

`gpt-capital-submission` is the pre-acceptance validation layer for external
autonomous trading agents submitted to Potato Chips AI.

Submitters package their strategy as a Docker container that exposes an
HTTP/JSON RPC interface. The validator launches that container, drives it only
through the contract below, and decides two separate questions:

1. Viability: can this submission be packaged into a platform agent at all?
2. Packaging success: when packaged, does it yield coherent and faithful agent
   commentary on the CIO dashboard?

Those questions stay separate throughout the system. A submission can be
viable but package poorly, or vice versa.

## What the platform sees

The platform is black-box by default.

It does see:

- the container's HTTP responses on the RPC surface defined here
- declared metadata returned by `/metadata`
- snapshots returned by `/snapshot`
- timing and liveness characteristics while the container is running

It does not see:

- your source code
- your model weights
- your prompts
- your internal filesystems, unless you choose to serialize state into
  `/snapshot`
- any private implementation detail that is not returned over the RPC surface

The validator is measuring capability, packaging fit, and replay determinism.
Runtime sandboxing and IP protection are separate concerns and are explicitly
out of scope here.

## State Model Decision

This contract is **stateful**.

Rationale:

- Most quant strategies are easier to reason about as stateful systems with
  rolling indicators, latent regime state, signal memory, and cooldown logic.
- A stateless contract would force the platform to resend the full historical
  context on every call, which is awkward for submitters and error-prone for
  deterministic replay.
- Explicit statefulness plus `/snapshot` and `/restore` gives us deterministic
  replay checkpoints, reproducible packaging evaluations, and clean pause /
  resume behavior without leaking implementation internals.

### Determinism requirement

All mutable decision state must be captured by `/snapshot` and restored by
`/restore`. Given the same restored snapshot and the same subsequent event
stream, the submission must produce the same outputs.

Because transport is JSON-only, raw bytes are wrapped as base64 text:

- `POST /snapshot` returns `{"snapshot_b64": "...", "checksum_sha256": "..."}`
- `POST /restore` accepts `{"snapshot_b64": "..."}` and must restore that state
  exactly

## Container Runtime Expectations

The validator:

1. starts the submission as a Docker container
2. injects a `PORT` environment variable
3. polls `GET /healthz`
4. drives the remaining RPC surface over HTTP

The container must:

- bind an HTTP server to `0.0.0.0:$PORT`
- speak JSON for all request and response bodies except `GET /healthz`, which
  may be a trivial JSON status response
- respond within the liveness and latency limits enforced by the validator

## RPC Surface

### Lifecycle endpoints

#### `GET /healthz`

Used only for boot/liveness checks.

Example response:

```json
{
  "status": "ok",
  "ready": true,
  "version": "1.0.0"
}
```

#### `GET /metadata`

Declares what the submission claims to be.

Example response:

```json
{
  "name": "Sector Momentum Core",
  "version": "1.0.0",
  "declared_strategy_class": "momentum",
  "author": "Example Submitter",
  "supports_news": true,
  "supports_stress_scenarios": true,
  "description": "5-day cross-sectional momentum with event-aware risk throttles."
}
```

#### `POST /snapshot`

Captures the complete internal state needed for deterministic replay.

Example response:

```json
{
  "snapshot_b64": "eyJzdGF0ZSI6ICJleGFtcGxlIn0=",
  "checksum_sha256": "35c6a5c1c70f9c1778c1c3d55f4eb1a485c7a79c44fa5f7a8c802f6d0f4631b6"
}
```

#### `POST /restore`

Restores a prior snapshot.

Example request:

```json
{
  "snapshot_b64": "eyJzdGF0ZSI6ICJleGFtcGxlIn0="
}
```

Example response:

```json
{
  "restored": true,
  "checksum_sha256": "35c6a5c1c70f9c1778c1c3d55f4eb1a485c7a79c44fa5f7a8c802f6d0f4631b6"
}
```

### Action surface

The action surface is what the platform executes against. It should be
deterministic and implementation-faithful.

#### `POST /on_market_update`

Consumes a batch of market data ticks or bars and may emit zero or more
trade signals.

Example request:

```json
{
  "batch_id": "mkt-2026-04-13T14:30:00Z",
  "timestamp": "2026-04-13T14:30:00Z",
  "ticks": [
    {
      "symbol": "NVDA",
      "last": 903.12,
      "open": 896.5,
      "high": 905.0,
      "low": 892.2,
      "volume": 29100123,
      "vwap": 900.44,
      "spread_bps": 4.1,
      "sector": "semiconductors",
      "features": {
        "return_5m": 0.0074,
        "return_1d": 0.023,
        "volatility_20d": 0.34
      }
    }
  ]
}
```

Example response:

```json
{
  "signals": [
    {
      "signal_id": "sig-nvda-breakout-001",
      "timestamp": "2026-04-13T14:30:00Z",
      "symbol": "NVDA",
      "intent": "increase_long",
      "strength": 0.74,
      "confidence": 0.81,
      "horizon_minutes": 240,
      "thesis": "Positive intraday continuation with sector confirmation.",
      "origin": "market_update",
      "tags": ["momentum", "sector_confirmation"]
    }
  ]
}
```

#### `POST /on_news`

Consumes a news event. The response may legitimately be empty.

Example request:

```json
{
  "event_id": "news-fed-001",
  "timestamp": "2026-04-15T18:00:00Z",
  "headline": "Federal Reserve surprises markets with an unexpected 50bp cut",
  "summary": "Risk assets rally immediately while bank stocks underperform.",
  "symbols": ["SPY", "QQQ", "JPM", "KRE"],
  "category": "macro",
  "relevance": 0.96,
  "sentiment": "positive"
}
```

Example response:

```json
{
  "signals": [
    {
      "signal_id": "sig-kre-risk-cut-002",
      "timestamp": "2026-04-15T18:00:00Z",
      "symbol": "KRE",
      "intent": "reduce_long",
      "strength": 0.63,
      "confidence": 0.78,
      "horizon_minutes": 90,
      "thesis": "Unexpected easing steepens uncertainty around regional bank margin pressure.",
      "origin": "news",
      "tags": ["macro_surprise", "risk_adjustment"]
    }
  ]
}
```

#### `POST /propose_positions`

Translates the submission's current beliefs into desired portfolio changes.

Example request:

```json
{
  "timestamp": "2026-04-15T18:05:00Z",
  "portfolio": {
    "cash_usd": 250000.0,
    "gross_exposure_usd": 740000.0,
    "net_exposure_usd": 180000.0,
    "positions": [
      {
        "symbol": "NVDA",
        "quantity": 1200.0,
        "avg_price": 881.12,
        "market_price": 904.41,
        "side": "long"
      }
    ]
  },
  "risk_limits": {
    "max_gross_exposure_usd": 1000000.0,
    "max_single_name_exposure_usd": 125000.0,
    "max_turnover_bps": 180.0
  }
}
```

Example response:

```json
{
  "proposals": [
    {
      "proposal_id": "prop-nvda-add-001",
      "symbol": "NVDA",
      "target_delta_quantity": 150.0,
      "reason": "Momentum signal remains active and risk budget is available.",
      "linked_signal_ids": ["sig-nvda-breakout-001"]
    }
  ]
}
```

### Introspection surface

The introspection surface is what Potato Chips AI's packaging layer reads to
generate human-facing commentary. Submitters provide structured state. The
platform owns the prose.

The validator rewards introspection that is:

- materially tied to the model's actual internal state
- specific enough to narrate
- stable when state is unchanged
- responsive when state changes

#### `GET /current_positioning`

Returns the current, structured strategy view.

Example response:

```json
{
  "timestamp": "2026-04-15T18:06:00Z",
  "directional_bias": "risk_on",
  "conviction": 0.76,
  "regime_view": "Macro easing surprise with elevated dispersion across financials.",
  "time_horizon": "intraday_to_swing",
  "liquidity_posture": "normal",
  "risk_budget_usage": 0.68,
  "active_factors": [
    {
      "name": "price_momentum",
      "weight": 0.62,
      "direction": "pro",
      "evidence": "Semiconductor leaders are breaking to fresh 5-day highs on rising volume."
    },
    {
      "name": "policy_shock_dispersion",
      "weight": 0.21,
      "direction": "pro",
      "evidence": "Fed surprise is widening dispersion between duration-sensitive winners and banks."
    }
  ],
  "watchlist": ["NVDA", "AMD", "KRE"],
  "key_risks": [
    "Regional bank reversal could spill into broad index risk appetite.",
    "Semiconductor breakout could fail if liquidity shock persists into the close."
  ]
}
```

#### `POST /explain_decision`

Returns a structured explanation for a specific signal.

Example request:

```json
{
  "signal_id": "sig-nvda-breakout-001"
}
```

Example response:

```json
{
  "signal_id": "sig-nvda-breakout-001",
  "trigger": "NVDA outperformed the semiconductor basket while spread remained contained.",
  "magnitude": 0.74,
  "confidence": 0.81,
  "expected_horizon_minutes": 240,
  "references": [
    {
      "kind": "market_feature",
      "value": "return_1d=0.023"
    },
    {
      "kind": "factor",
      "value": "price_momentum"
    }
  ]
}
```

#### `POST /stress_response`

Shows how the strategy would change its positioning under a hypothetical
scenario.

Example request:

```json
{
  "scenario_id": "stress-vol-spike",
  "description": "Implied volatility jumps 25% while spreads widen 3x over 15 minutes.",
  "shock": {
    "vol_multiplier": 1.25,
    "spread_multiplier": 3.0,
    "price_gap_pct": -0.018
  }
}
```

Example response:

```json
{
  "scenario_id": "stress-vol-spike",
  "positioning_delta": {
    "directional_bias_before": "risk_on",
    "directional_bias_after": "neutral",
    "conviction_before": 0.76,
    "conviction_after": 0.41,
    "factor_changes": [
      {
        "name": "price_momentum",
        "before": 0.62,
        "after": 0.21
      }
    ]
  },
  "summary": "The strategy would cut gross exposure and stop adding to momentum longs until spreads normalize."
}
```

## Good Introspection vs Flagged Introspection

### Example 1: Good, state-linked introspection

Good:

```json
{
  "directional_bias": "risk_on",
  "conviction": 0.76,
  "regime_view": "Fed surprise lifted duration-sensitive leaders while regional banks lagged.",
  "active_factors": [
    {
      "name": "price_momentum",
      "weight": 0.62,
      "direction": "pro",
      "evidence": "NVDA and AMD both moved above 5-day highs on rising volume."
    }
  ]
}
```

Why it is good:

- it names the actual factor driving behavior
- it gives evidence tied to current state
- it should change when the strategy's inputs or latent state change

### Example 2: Flagged as static theater

Flagged:

```json
{
  "directional_bias": "neutral",
  "conviction": 0.5,
  "regime_view": "Balanced market conditions.",
  "active_factors": [
    {
      "name": "macro",
      "weight": 0.5,
      "direction": "pro",
      "evidence": "Watching conditions closely."
    }
  ]
}
```

Why it gets flagged:

- the values are generic and likely default
- nothing indicates what changed across a macro surprise or regime transition
- if this response is byte-identical before and after an anchor event, the
  validator's responsiveness gate will fail it

### Example 3: Flagged as packaging-risky hallucination bait

Flagged:

```json
{
  "directional_bias": "risk_on",
  "conviction": 0.9,
  "regime_view": "Credit spreads are the dominant driver today.",
  "active_factors": [
    {
      "name": "credit_spreads",
      "weight": 0.85,
      "direction": "pro",
      "evidence": "Credit is driving risk appetite."
    }
  ]
}
```

Why it gets flagged:

- if the strategy is actually trading on price momentum and not credit spread
  inputs, the introspection surface is misrepresenting the model
- the packaging layer may generate plausible prose from this, but the
  faithfulness check will fail any generated claims that are not grounded in the
  structured state and decision trace

## Design Guidance for Submitters

- Make introspection rich, but keep it honest.
- Do not expose prose meant to be shown directly to end users. Return
  structured fields that the platform can narrate safely.
- Keep `/current_positioning` stable when nothing changed.
- Make `/current_positioning` responsive when the strategy's internal state
  changes.
- Ensure `/explain_decision` references concrete drivers for a specific signal.
- Treat `/snapshot` and `/restore` as first-class API surface. If they do not
  round-trip cleanly, deterministic replay will fail.

## Validator Consequences

Hard-gate failures cause immediate rejection:

- schema conformance
- liveness
- responsiveness
- faithfulness
- stability

Scored-but-nonfatal checks are still reported and may lead to a `review`
verdict instead of `accept`:

- activity rate
- introspection coverage
- differentiation
- informativeness

See `contract/openapi.yaml` for the canonical machine-readable schema.
